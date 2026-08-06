const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectPlatform,
  getPreflightMarkerPath,
  maybeStopLegacyDaemon,
  prepareBinaryForLaunch,
} = require('./run.cjs');

function writeServerBinary(binaryPath) {
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, 'server');
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
