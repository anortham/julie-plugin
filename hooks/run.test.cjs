const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectPlatform,
  getPreflightMarkerPath,
  maybeStopExistingDaemon,
  prepareBinaryForLaunch,
} = require('./run.cjs');

function writeDaemonSplitBinaries(binaryPath, daemonBinaryPath, plat = 'win32') {
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, 'adapter');
  fs.writeFileSync(daemonBinaryPath, 'daemon');
  const legacyName = plat === 'win32' ? 'julie-server.exe' : 'julie-server';
  fs.writeFileSync(path.join(path.dirname(binaryPath), legacyName), 'server');
}

test('detectPlatform returns aarch64-apple-darwin config for darwin arm64', () => {
  const result = detectPlatform('darwin', 'arm64');
  assert.equal(result.target, 'aarch64-apple-darwin');
  assert.equal(result.binaryName, 'julie-adapter');
  assert.equal(result.daemonBinaryName, 'julie-daemon');
  assert.equal(result.archivePattern.suffix, '-aarch64-apple-darwin.tar.gz');
});

test('detectPlatform returns x86_64-apple-darwin config for darwin x64', () => {
  const result = detectPlatform('darwin', 'x64');
  assert.equal(result.target, 'x86_64-apple-darwin');
  assert.equal(result.binaryName, 'julie-adapter');
  assert.equal(result.daemonBinaryName, 'julie-daemon');
  assert.equal(result.archivePattern.suffix, '-x86_64-apple-darwin.tar.gz');
});

test('detectPlatform returns linux-gnu config for linux x64', () => {
  const result = detectPlatform('linux', 'x64');
  assert.equal(result.target, 'x86_64-unknown-linux-gnu');
  assert.equal(result.binaryName, 'julie-adapter');
  assert.equal(result.daemonBinaryName, 'julie-daemon');
  assert.equal(result.archivePattern.suffix, '-x86_64-unknown-linux-gnu.tar.gz');
});

test('detectPlatform returns windows-msvc config for win32 x64', () => {
  const result = detectPlatform('win32', 'x64');
  assert.equal(result.target, 'x86_64-pc-windows-msvc');
  assert.equal(result.binaryName, 'julie-adapter.exe');
  assert.equal(result.daemonBinaryName, 'julie-daemon.exe');
  assert.equal(result.archivePattern.suffix, '-x86_64-pc-windows-msvc.zip');
});

test('detectPlatform returns null for unsupported platform/arch combos', () => {
  assert.equal(detectPlatform('linux', 'arm64'), null);
  assert.equal(detectPlatform('win32', 'arm64'), null);
  assert.equal(detectPlatform('freebsd', 'x64'), null);
});

test('maybeStopExistingDaemon prefers julie-daemon when present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const binaryPath = path.join(tmp, 'julie-adapter');
  const daemonBinaryPath = path.join(tmp, 'julie-daemon');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');
  const calls = [];

  fs.writeFileSync(binaryPath, '');
  fs.writeFileSync(daemonBinaryPath, '');

  const firstRun = maybeStopExistingDaemon({
    needsExtract: true,
    binaryPath,
    daemonBinaryPath,
    markerPath,
    execFileSyncImpl(binary, args) {
      calls.push({ binary, args });
    },
    fsImpl: fs,
    stderr: { write() {} },
  });

  const secondRun = maybeStopExistingDaemon({
    needsExtract: true,
    binaryPath,
    daemonBinaryPath,
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
  assert.deepEqual(calls[0], { binary: daemonBinaryPath, args: ['stop'] });
  assert.equal(fs.existsSync(markerPath), true);
});

test('maybeStopExistingDaemon falls back to legacy julie-server when julie-daemon missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  // Pre-A1.8 install: only the legacy `julie-server` binary is on disk; the
  // launcher path here represents that binary. julie-daemon path is absent.
  const legacyBinaryPath = path.join(tmp, 'julie-server');
  const daemonBinaryPath = path.join(tmp, 'julie-daemon');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');
  const calls = [];

  fs.writeFileSync(legacyBinaryPath, '');

  const firstRun = maybeStopExistingDaemon({
    needsExtract: true,
    binaryPath: legacyBinaryPath,
    daemonBinaryPath,
    markerPath,
    execFileSyncImpl(binary, args) {
      calls.push({ binary, args });
    },
    fsImpl: fs,
    stderr: { write() {} },
  });

  assert.equal(firstRun, true);
  assert.deepEqual(calls[0], { binary: legacyBinaryPath, args: ['stop'] });
});

test('maybeStopExistingDaemon leaves the marker absent when stop fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const binaryPath = path.join(tmp, 'julie-adapter');
  const daemonBinaryPath = path.join(tmp, 'julie-daemon');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');

  fs.writeFileSync(binaryPath, '');
  fs.writeFileSync(daemonBinaryPath, '');

  const ran = maybeStopExistingDaemon({
    needsExtract: true,
    binaryPath,
    daemonBinaryPath,
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

test('prepareBinaryForLaunch stops before extraction when replacing an existing binary', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-adapter.exe');
  const daemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v6.6.11-x86_64-pc-windows-msvc.zip');
  const calls = [];

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(binaryPath, 'old');
  fs.writeFileSync(daemonBinaryPath, 'old-daemon');
  fs.writeFileSync(archivePath, 'archive');

  const oldTime = new Date('2026-04-10T00:00:00Z');
  const newTime = new Date('2026-04-10T00:00:10Z');
  fs.utimesSync(binaryPath, oldTime, oldTime);
  fs.utimesSync(archivePath, newTime, newTime);

  prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    daemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({
        step: 'stop',
        binaryPath: args.binaryPath,
        daemonBinaryPath: args.daemonBinaryPath,
      });
      fs.mkdirSync(path.dirname(args.markerPath), { recursive: true });
      fs.writeFileSync(args.markerPath, 'ok\n');
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeDaemonSplitBinaries(binaryPath, daemonBinaryPath);
    },
  });

  assert.deepEqual(calls, [
    { step: 'stop', binaryPath, daemonBinaryPath },
    { step: 'extract' },
    { step: 'stop', binaryPath, daemonBinaryPath },
  ]);
});

test('prepareBinaryForLaunch extracts before stop when the new binary path does not exist yet', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-adapter.exe');
  const daemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v6.6.11-x86_64-pc-windows-msvc.zip');
  const calls = [];

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, 'archive');

  prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    daemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({
        step: 'stop',
        binaryPath: args.binaryPath,
        daemonBinaryPath: args.daemonBinaryPath,
      });
      return false;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeDaemonSplitBinaries(binaryPath, daemonBinaryPath);
    },
  });

  assert.deepEqual(calls, [
    { step: 'extract' },
    { step: 'stop', binaryPath, daemonBinaryPath },
  ]);
});

test('prepareBinaryForLaunch falls back to legacy julie-server for single-binary archives', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'aarch64-apple-darwin';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-adapter');
  const daemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon');
  const legacyServerPath = path.join(tmp, 'bin', target, 'julie-server');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.9.3-aarch64-apple-darwin.tar.gz');
  const calls = [];

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, 'archive');

  const launchPath = prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-aarch64-apple-darwin.tar.gz' },
    binaryPath,
    daemonBinaryPath,
    archiveDir,
    plat: 'darwin',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({
        step: 'stop',
        binaryPath: args.binaryPath,
        daemonBinaryPath: args.daemonBinaryPath,
      });
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      fs.mkdirSync(path.dirname(legacyServerPath), { recursive: true });
      fs.writeFileSync(legacyServerPath, 'legacy-server');
    },
  });

  assert.equal(launchPath, legacyServerPath);
  assert.deepEqual(calls, [
    { step: 'extract' },
    { step: 'stop', binaryPath: legacyServerPath, daemonBinaryPath: null },
  ]);
});

test('prepareBinaryForLaunch stops legacy julie-server before first daemon-split extraction', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-adapter.exe');
  const daemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const legacyServerPath = path.join(tmp, 'bin', target, 'julie-server.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.9.3-x86_64-pc-windows-msvc.zip');
  const calls = [];

  fs.mkdirSync(path.dirname(legacyServerPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(legacyServerPath, 'old-server');
  fs.writeFileSync(archivePath, 'archive');

  prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    daemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({
        step: 'stop',
        binaryPath: args.binaryPath,
        daemonBinaryPath: args.daemonBinaryPath,
      });
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeDaemonSplitBinaries(binaryPath, daemonBinaryPath);
    },
  });

  assert.deepEqual(calls, [
    { step: 'stop', binaryPath: legacyServerPath, daemonBinaryPath: null },
    { step: 'extract' },
    { step: 'stop', binaryPath, daemonBinaryPath },
  ]);
});

test('prepareBinaryForLaunch reruns preflight stop when archive version changes despite old marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-adapter.exe');
  const daemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.9.4-x86_64-pc-windows-msvc.zip');
  const markerPath = getPreflightMarkerPath(tmp, target);
  const calls = [];

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(binaryPath, 'old-adapter');
  fs.writeFileSync(daemonBinaryPath, 'old-daemon');
  fs.writeFileSync(archivePath, 'archive');
  fs.writeFileSync(markerPath, 'julie-v7.9.3-x86_64-pc-windows-msvc.zip\n');

  const oldTime = new Date('2026-04-10T00:00:00Z');
  const newTime = new Date('2026-04-10T00:00:10Z');
  fs.utimesSync(binaryPath, oldTime, oldTime);
  fs.utimesSync(archivePath, newTime, newTime);

  prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    daemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({
        step: 'stop',
        binaryPath: args.binaryPath,
        daemonBinaryPath: args.daemonBinaryPath,
        markerKey: args.markerKey,
      });
      fs.writeFileSync(args.markerPath, `${args.markerKey}\n`);
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      writeDaemonSplitBinaries(binaryPath, daemonBinaryPath);
    },
  });

  assert.deepEqual(calls, [
    {
      step: 'stop',
      binaryPath,
      daemonBinaryPath,
      markerKey: 'julie-v7.9.4-x86_64-pc-windows-msvc.zip',
    },
    { step: 'extract' },
    {
      step: 'stop',
      binaryPath,
      daemonBinaryPath,
      markerKey: 'julie-v7.9.4-x86_64-pc-windows-msvc.zip',
    },
  ]);
});

test('prepareBinaryForLaunch fails after extraction if daemon binary is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-adapter.exe');
  const daemonBinaryPath = path.join(tmp, 'bin', target, 'julie-daemon.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v7.9.4-x86_64-pc-windows-msvc.zip');

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(archivePath, 'archive');

  assert.throws(() => prepareBinaryForLaunch({
    pluginRootPath: tmp,
    target,
    archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    binaryPath,
    daemonBinaryPath,
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl() {
      return false;
    },
    extractBinaryImpl() {
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
      fs.writeFileSync(binaryPath, 'adapter-only');
    },
  }), /missing required Julie binary/);
});
