const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getPreflightMarkerPath,
  maybeStopExistingDaemon,
  prepareBinaryForLaunch,
} = require('./run.cjs');

test('maybeStopExistingDaemon stops once and writes a marker', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const binaryPath = path.join(tmp, 'julie-server');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');
  const calls = [];

  fs.writeFileSync(binaryPath, '');

  const firstRun = maybeStopExistingDaemon({
    needsExtract: true,
    binaryPath,
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
  assert.deepEqual(calls[0], { binary: binaryPath, args: ['stop'] });
  assert.equal(fs.existsSync(markerPath), true);
});

test('maybeStopExistingDaemon leaves the marker absent when stop fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const binaryPath = path.join(tmp, 'julie-server');
  const markerPath = getPreflightMarkerPath(tmp, 'x86_64-pc-windows-msvc');

  fs.writeFileSync(binaryPath, '');

  const ran = maybeStopExistingDaemon({
    needsExtract: true,
    binaryPath,
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
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server.exe');
  const archiveDir = path.join(tmp, 'bin', 'archives');
  const archivePath = path.join(archiveDir, 'julie-v6.6.11-x86_64-pc-windows-msvc.zip');
  const calls = [];

  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(binaryPath, 'old');
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
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({ step: 'stop', binaryPath: args.binaryPath });
      fs.mkdirSync(path.dirname(args.markerPath), { recursive: true });
      fs.writeFileSync(args.markerPath, 'ok\n');
      return true;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
    },
  });

  assert.deepEqual(calls, [
    { step: 'stop', binaryPath },
    { step: 'extract' },
    { step: 'stop', binaryPath },
  ]);
});

test('prepareBinaryForLaunch extracts before stop when the new binary path does not exist yet', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'julie-plugin-run-'));
  const target = 'x86_64-pc-windows-msvc';
  const binaryPath = path.join(tmp, 'bin', target, 'julie-server.exe');
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
    archiveDir,
    plat: 'win32',
    fsImpl: fs,
    stderr: { write() {} },
    maybeStopExistingDaemonImpl(args) {
      calls.push({ step: 'stop', binaryPath: args.binaryPath });
      return false;
    },
    extractBinaryImpl() {
      calls.push({ step: 'extract' });
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
      fs.writeFileSync(binaryPath, 'new');
    },
  });

  assert.deepEqual(calls, [
    { step: 'extract' },
    { step: 'stop', binaryPath },
  ]);
});
