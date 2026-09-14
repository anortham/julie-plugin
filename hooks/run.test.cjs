const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectPlatform,
  findArchive,
  getPreflightMarkerPath,
  maybeStopLegacyDaemon,
  prepareBinaryForLaunch,
  validateArchive,
} = require('./run.cjs');

function writeServerBinary(binaryPath) {
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, 'server');
}

function writeManifest(dir, target, files = ['julie-semantic-sidecar']) {
  fs.writeFileSync(path.join(dir, 'package-manifest.json'), JSON.stringify({ schema_version: 2, rust_target: target, files }));
}

test('detectPlatform returns aarch64-apple-darwin config for darwin arm64', () => {
  const result = detectPlatform('darwin', 'arm64');
  assert.equal(result.target, 'aarch64-apple-darwin');
  assert.equal(result.binaryName, 'julie-server');
  assert.equal(result.legacyDaemonBinaryName, 'julie-daemon');
  assert.equal(result.archivePattern.suffix, '-aarch64-apple-darwin.tar.gz');
});

test('detectPlatform returns x86_64-apple-darwin config for darwin x64', () => {
  const result = detectPlatform('darwin', 'x64');
  assert.equal(result.target, 'x86_64-apple-darwin');
  assert.equal(result.binaryName, 'julie-server');
  assert.equal(result.legacyDaemonBinaryName, 'julie-daemon');
  assert.equal(result.archivePattern.suffix, '-x86_64-apple-darwin.tar.gz');
});

test('detectPlatform returns linux-gnu config for linux x64', () => {
  const result = detectPlatform('linux', 'x64');
  assert.equal(result.target, 'x86_64-unknown-linux-gnu');
  assert.equal(result.binaryName, 'julie-server');
  assert.equal(result.legacyDaemonBinaryName, 'julie-daemon');
  assert.equal(result.archivePattern.suffix, '-x86_64-unknown-linux-gnu.tar.gz');
});

test('detectPlatform returns windows-msvc config for win32 x64', () => {
  const result = detectPlatform('win32', 'x64');
  assert.equal(result.target, 'x86_64-pc-windows-msvc');
  assert.equal(result.binaryName, 'julie-server.exe');
  assert.equal(result.legacyDaemonBinaryName, 'julie-daemon.exe');
  assert.equal(result.archivePattern.suffix, '-x86_64-pc-windows-msvc.zip');
});

test('detectPlatform returns null for unsupported platform/arch combos', () => {
  assert.equal(detectPlatform('linux', 'arm64'), null);
  assert.equal(detectPlatform('win32', 'arm64'), null);
  assert.equal(detectPlatform('freebsd', 'x64'), null);
});

test('findArchive picks the highest version when several archives match', () => {
  const archiveDir = path.join('plugin', 'bin', 'archives');
  const archivePattern = { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' };
  const fsImpl = {
    readdirSync() {
      return [
        'julie-v7.18.0-x86_64-unknown-linux-gnu.tar.gz',
        'julie-v11.0.0-aarch64-apple-darwin.tar.gz',
        'julie-v10.0.0-x86_64-unknown-linux-gnu.tar.gz',
        'julie-v8.0.0-x86_64-unknown-linux-gnu.tar.gz',
      ];
    },
  };

  assert.equal(
    findArchive(archiveDir, archivePattern, fsImpl),
    path.join(archiveDir, 'julie-v10.0.0-x86_64-unknown-linux-gnu.tar.gz')
  );
});

test('maybeStopLegacyDaemon stops legacy julie-daemon when present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const legacyDaemonBinaryPath = path.join(tmp, 'julie-daemon');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');
  const calls = [];

  fs.writeFileSync(legacyDaemonBinaryPath, '');

  const firstRun = maybeStopLegacyDaemon({
    needsExtract: true,
    legacyDaemonBinaryPath,
    markerPath,
    execFileSyncImpl(binary, args) {
      calls.push({ binary, args });
    },
    fsImpl: fs,
    stderr: { write() {} },
  });

  const secondRun = maybeStopLegacyDaemon({
    needsExtract: true,
    legacyDaemonBinaryPath,
    markerPath,
    execFileSyncImpl(binary, args) {
      calls.push({ binary, args });
    },
    fsImpl: fs,
    stderr: { write() {} },
  });

  assert.equal(firstRun, true);
  assert.equal(secondRun, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { binary: legacyDaemonBinaryPath, args: ['stop'] });
  assert.equal(fs.existsSync(markerPath), true);
});

test('maybeStopLegacyDaemon skips when legacy julie-daemon is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const legacyDaemonBinaryPath = path.join(tmp, 'julie-daemon');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');
  const calls = [];

  const firstRun = maybeStopLegacyDaemon({
    needsExtract: true,
    legacyDaemonBinaryPath,
    markerPath,
    execFileSyncImpl(binary, args) {
      calls.push({ binary, args });
    },
    fsImpl: fs,
    stderr: { write() {} },
  });

  assert.equal(firstRun, false);
  assert.deepEqual(calls, []);
});

test('maybeStopLegacyDaemon leaves the marker absent when stop fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const legacyDaemonBinaryPath = path.join(tmp, 'julie-daemon');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');

  fs.writeFileSync(legacyDaemonBinaryPath, '');

  const ran = maybeStopLegacyDaemon({
    needsExtract: true,
    legacyDaemonBinaryPath,
    markerPath,
    execFileSyncImpl() {
      throw new Error('boom');
    },
    fsImpl: fs,
    stderr: { write() {} },
  });

  assert.equal(ran, false);
  assert.equal(fs.existsSync(markerPath), false);
});

test('prepareBinaryForLaunch extracts current server when no binary exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server.exe');
  const legacyDaemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.13.2-x86_64-pc-windows-msvc.zip');
  const calls = [];

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, 'archive');

  const launchPath = prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopLegacyDaemonImpl(args) {
      calls.push({
        step: 'legacy-stop',
        legacyDaemonBinaryPath: args.legacyDaemonBinaryPath,
      });
      return false;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeServerBinary(binaryPath);
    },
  });

  assert.equal(launchPath, binaryPath);
  assert.deepEqual(calls, [
    { step: 'legacy-stop', legacyDaemonBinaryPath },
    { step: 'extract' },
  ]);
});

test('prepareBinaryForLaunch re-extracts newer archive without daemon stop when no legacy daemon exists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'aarch64-apple-darwin';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server');
  const legacyDaemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.13.2-aarch64-apple-darwin.tar.gz');
  const calls = [];

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(binaryPath, 'old-server');
  fs.writeFileSync(archivePath, 'archive');

  const oldTime = new Date('2026-04-10T00:00:00Z');
  const newTime = new Date('2026-04-10T00:00:10Z');
  fs.utimesSync(binaryPath, oldTime, oldTime);
  fs.utimesSync(archivePath, newTime, newTime);

  const launchPath = prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-aarch64-apple-darwin.tar.gz' },
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: 'darwin',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopLegacyDaemonImpl(args) {
      calls.push({
        step: 'legacy-stop',
        legacyDaemonBinaryPath: args.legacyDaemonBinaryPath,
      });
      return false;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeServerBinary(binaryPath);
    },
  });

  assert.equal(launchPath, binaryPath);
  assert.deepEqual(calls, [
    { step: 'legacy-stop', legacyDaemonBinaryPath },
    { step: 'extract' },
  ]);
});

test('prepareBinaryForLaunch re-extracts when archive version changes even if cached binary is newer', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'aarch64-apple-darwin';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server');
  const legacyDaemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.13.3-aarch64-apple-darwin.tar.gz');
  const calls = [];

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(binaryPath, 'old-server');
  fs.writeFileSync(archivePath, 'archive');

  const archiveTime = new Date('2026-06-07T02:00:00Z');
  const cachedBinaryTime = new Date('2026-06-07T03:00:00Z');
  fs.utimesSync(archivePath, archiveTime, archiveTime);
  fs.utimesSync(binaryPath, cachedBinaryTime, cachedBinaryTime);

  const launchPath = prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-aarch64-apple-darwin.tar.gz' },
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: 'darwin',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopLegacyDaemonImpl(args) {
      calls.push({
        step: 'legacy-stop',
        legacyDaemonBinaryPath: args.legacyDaemonBinaryPath,
      });
      return false;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeServerBinary(binaryPath);
    },
  });

  assert.equal(launchPath, binaryPath);
  assert.deepEqual(calls, [
    { step: 'legacy-stop', legacyDaemonBinaryPath },
    { step: 'extract' },
  ]);
});

test('prepareBinaryForLaunch stops old split daemon before extracting current server', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server.exe');
  const legacyDaemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.13.2-x86_64-pc-windows-msvc.zip');
  const calls = [];

  fs.mkdirSync(path.dirname(legacyDaemonBinaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(legacyDaemonBinaryPath, 'old-daemon');
  fs.writeFileSync(archivePath, 'archive');

  prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopLegacyDaemonImpl(args) {
      calls.push({
        step: 'legacy-stop',
        legacyDaemonBinaryPath: args.legacyDaemonBinaryPath,
        markerKey: args.markerKey,
      });
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeServerBinary(binaryPath);
    },
  });

  assert.deepEqual(calls, [
    {
      step: 'legacy-stop',
      legacyDaemonBinaryPath,
      markerKey: 'julie-v7.13.2-x86_64-pc-windows-msvc.zip',
    },
    { step: 'extract' },
  ]);
});

test('prepareBinaryForLaunch reruns legacy daemon stop when archive version changes despite old marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server.exe');
  const legacyDaemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.13.2-x86_64-pc-windows-msvc.zip');
  const markerPath = getPreflightMarkerPath(tmp, target);
  const calls = [];

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(binaryPath, 'old-server');
  fs.writeFileSync(legacyDaemonBinaryPath, 'old-daemon');
  fs.writeFileSync(archivePath, 'archive');
  fs.writeFileSync(markerPath, 'julie-v7.12.0-x86_64-pc-windows-msvc.zip\n');

  const oldTime = new Date('2026-04-10T00:00:00Z');
  const newTime = new Date('2026-04-10T00:00:10Z');
  fs.utimesSync(binaryPath, oldTime, oldTime);
  fs.utimesSync(archivePath, newTime, newTime);

  prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopLegacyDaemonImpl(args) {
      calls.push({
        step: 'legacy-stop',
        legacyDaemonBinaryPath: args.legacyDaemonBinaryPath,
        markerKey: args.markerKey,
      });
      fs.writeFileSync(args.markerPath, `${args.markerKey}\n`);
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeServerBinary(binaryPath);
    },
  });

  assert.deepEqual(calls, [
    {
      step: 'legacy-stop',
      legacyDaemonBinaryPath,
      markerKey: 'julie-v7.13.2-x86_64-pc-windows-msvc.zip',
    },
    { step: 'extract' },
  ]);
});

test('prepareBinaryForLaunch fails after extraction if current server binary is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server.exe');
  const legacyDaemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.13.2-x86_64-pc-windows-msvc.zip');

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, 'archive');

  assert.throws(() => prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopLegacyDaemonImpl() {
      return false;
    },
    extractBinaryImpl() {
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(binaryPath), 'julie-adapter.exe'), 'adapter-only');
    },
  }), /missing required Julie binary/);
});

test('new archive extracts without overwriting running version', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-unknown-linux-gnu';
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const oldDir = path.join(tmp, 'bin', target, 'versions', 'julie-v1-x86_64-unknown-linux-gnu.tar.gz');
  const archive = path.join(archiveDir, 'julie-v2-x86_64-unknown-linux-gnu.tar.gz');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'julie-server'), 'old');
  fs.writeFileSync(archive, 'archive');
  let extractionCalls = 0;
  let archiveValidationCalls = 0;
  const options = {
    pluginRootPath: tmp, target, archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' },
    binaryPath: path.join(tmp, 'bin', target, 'julie-server'), sidecarPath: path.join(tmp, 'bin', target, 'julie-semantic-sidecar'), archiveDir, plat: 'linux', stderr: { write() {} },
    validateArchiveImpl() { archiveValidationCalls += 1; },
    extractBinaryImpl({ destDir }) { extractionCalls += 1; writeServerBinary(path.join(destDir, 'julie-server')); fs.writeFileSync(path.join(destDir, 'julie-semantic-sidecar'), 'sidecar'); writeManifest(destDir, target); },
  };
  const launched = prepareBinaryForLaunch(options);
  const reused = prepareBinaryForLaunch(options);
  assert.equal(fs.readFileSync(path.join(oldDir, 'julie-server'), 'utf8'), 'old');
  assert.match(launched, /julie-v2-x86_64-unknown-linux-gnu\.tar\.gz/);
  assert.equal(reused, launched);
  assert.equal(extractionCalls, 1);
  assert.equal(archiveValidationCalls, 1);
});

test('failed extraction never launches another archive version', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-unknown-linux-gnu';
  const archiveDir = path.join(tmp, 'bin', 'archives');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'julie-v2-x86_64-unknown-linux-gnu.tar.gz'), 'archive');
  const previous = path.join(tmp, 'bin', target, 'versions', 'julie-v1-x86_64-unknown-linux-gnu.tar.gz');
  fs.mkdirSync(previous, { recursive: true });
  writeServerBinary(path.join(previous, 'julie-server'));
  fs.writeFileSync(path.join(previous, 'julie-semantic-sidecar'), 'sidecar');
  writeManifest(previous, target);
  fs.writeFileSync(path.join(previous, '.ready'), 'julie-v1-x86_64-unknown-linux-gnu.tar.gz\n');
  assert.throws(() => prepareBinaryForLaunch({ pluginRootPath: tmp, target, archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' }, binaryPath: path.join(tmp, 'bin', target, 'julie-server'), sidecarPath: path.join(tmp, 'bin', target, 'julie-semantic-sidecar'), archiveDir, plat: 'linux', stderr: { write() {} }, validateArchiveImpl() {}, extractBinaryImpl() { throw new Error('bad archive; remove the incomplete version directory and restart the harness'); } }), /bad archive; remove the incomplete version directory and restart the harness/);
  assert.equal(fs.existsSync(previous), true);
});

test('partial extraction is never marked ready', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-unknown-linux-gnu';
  const archiveDir = path.join(tmp, 'bin', 'archives');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'julie-v2-x86_64-unknown-linux-gnu.tar.gz'), 'archive');
  const finalDir = path.join(tmp, 'bin', target, 'versions', 'julie-v2-x86_64-unknown-linux-gnu.tar.gz');
  assert.throws(() => prepareBinaryForLaunch({ pluginRootPath: tmp, target, archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' }, binaryPath: path.join(tmp, 'bin', target, 'julie-server'), sidecarPath: path.join(tmp, 'bin', target, 'julie-semantic-sidecar'), archiveDir, plat: 'linux', stderr: { write() {} }, validateArchiveImpl() {}, extractBinaryImpl({ destDir }) { writeServerBinary(path.join(destDir, 'julie-server')); fs.writeFileSync(path.join(destDir, 'julie-semantic-sidecar'), 'sidecar'); } }), /package manifest is missing; remove the incomplete version directory and restart the harness/);
  assert.equal(fs.existsSync(finalDir), false);
  assert.equal(fs.readdirSync(path.dirname(finalDir)).some((name) => name.includes('.staging-')), false);
});

test('required sidecar is validated before launch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-unknown-linux-gnu';
  const archiveDir = path.join(tmp, 'bin', 'archives');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'julie-v2-x86_64-unknown-linux-gnu.tar.gz'), 'archive');
  assert.throws(() => prepareBinaryForLaunch({ pluginRootPath: tmp, target, archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' }, binaryPath: path.join(tmp, 'bin', target, 'julie-server'), sidecarPath: path.join(tmp, 'bin', target, 'julie-semantic-sidecar'), archiveDir, plat: 'linux', stderr: { write() {} }, validateArchiveImpl() {}, extractBinaryImpl({ destDir }) { writeServerBinary(path.join(destDir, 'julie-server')); writeManifest(destDir, target); } }), /julie-semantic-sidecar/);
});

test('archive traversal is rejected before extraction', () => {
  assert.throws(
    () => validateArchive('bad.tar.gz', 'linux', () => Buffer.from('../escape\njulie-server\n')),
    /unsafe path/
  );
});

test('symlink package entries are rejected before ready', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-unknown-linux-gnu';
  const archiveDir = path.join(tmp, 'bin', 'archives');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, 'julie-v2-x86_64-unknown-linux-gnu.tar.gz'), 'archive');
  assert.throws(() => prepareBinaryForLaunch({
    pluginRootPath: tmp, target, archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' },
    binaryPath: path.join(tmp, 'bin', target, 'julie-server'), sidecarPath: path.join(tmp, 'bin', target, 'julie-semantic-sidecar'),
    archiveDir, plat: 'linux', stderr: { write() {} }, validateArchiveImpl() {},
    extractBinaryImpl({ destDir }) {
      writeServerBinary(path.join(destDir, 'julie-server'));
      fs.writeFileSync(path.join(destDir, 'actual-sidecar'), 'sidecar');
      fs.symlinkSync('actual-sidecar', path.join(destDir, 'julie-semantic-sidecar'));
      writeManifest(destDir, target);
    },
  }), /symlink/);
});

test('maintainer override rejects directory symlink targets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-unknown-linux-gnu';
  const binDir = path.join(tmp, 'bin', target);
  const server = path.join(binDir, 'julie-server');
  const sidecar = path.join(binDir, 'julie-semantic-sidecar');
  const directory = path.join(tmp, 'not-a-binary');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(directory);
  fs.symlinkSync(directory, server);
  fs.symlinkSync(directory, sidecar);
  assert.throws(() => prepareBinaryForLaunch({
    pluginRootPath: tmp, target, archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' },
    binaryPath: server, sidecarPath: sidecar, archiveDir: path.join(tmp, 'bin', 'archives'), plat: 'linux', stderr: { write() {} },
  }), /archive not found/);
});
