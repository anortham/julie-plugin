#!/usr/bin/env node
// MCP server launcher for Julie.
// Handles platform detection, archive extraction, and binary exec
// entirely in Node.js so there is no dependency on bash (which may
// not be on PATH when Claude Code spawns this as a native process
// on Windows).
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const pluginRoot = path.resolve(__dirname, '..');
const PRELAUNCH_MARKER = '.legacy-daemon-stop-preflight-done';
const EXTRACTION_MARKER = '.extracted-archive';

function detectPlatform(plat = os.platform(), arch = os.arch()) {
  if (plat === 'darwin' && arch === 'arm64') {
    return {
      target: 'aarch64-apple-darwin',
      binaryName: 'julie-server',
      legacyDaemonBinaryName: 'julie-daemon',
      archivePattern: { prefix: 'julie-v', suffix: '-aarch64-apple-darwin.tar.gz' },
    };
  }

  if (plat === 'darwin' && arch === 'x64') {
    return {
      target: 'x86_64-apple-darwin',
      binaryName: 'julie-server',
      legacyDaemonBinaryName: 'julie-daemon',
      archivePattern: { prefix: 'julie-v', suffix: '-x86_64-apple-darwin.tar.gz' },
    };
  }

  if (plat === 'linux' && arch === 'x64') {
    return {
      target: 'x86_64-unknown-linux-gnu',
      binaryName: 'julie-server',
      legacyDaemonBinaryName: 'julie-daemon',
      archivePattern: { prefix: 'julie-v', suffix: '-x86_64-unknown-linux-gnu.tar.gz' },
    };
  }

  if (plat === 'win32' && arch === 'x64') {
    return {
      target: 'x86_64-pc-windows-msvc',
      binaryName: 'julie-server.exe',
      legacyDaemonBinaryName: 'julie-daemon.exe',
      archivePattern: { prefix: 'julie-v', suffix: '-x86_64-pc-windows-msvc.zip' },
    };
  }

  return null;
}

function findArchive(archiveDir, archivePattern, fsImpl = fs) {
  try {
    for (const file of fsImpl.readdirSync(archiveDir)) {
      if (file.startsWith(archivePattern.prefix) && file.endsWith(archivePattern.suffix)) {
        return path.join(archiveDir, file);
      }
    }
  } catch (_) {
    // archiveDir missing
  }

  return null;
}

function getPreflightMarkerPath(root, target) {
  return path.join(root, 'bin', target, PRELAUNCH_MARKER);
}

function getExtractionMarkerPath(root, target) {
  return path.join(root, 'bin', target, EXTRACTION_MARKER);
}

function extractedArchiveMatches(markerPath, markerKey, fsImpl = fs) {
  try {
    return fsImpl.readFileSync(markerPath, 'utf8').trim() === markerKey;
  } catch (_) {
    return false;
  }
}

function writeExtractionMarker(markerPath, markerKey, fsImpl = fs, stderr = process.stderr) {
  try {
    fsImpl.mkdirSync(path.dirname(markerPath), { recursive: true });
    fsImpl.writeFileSync(markerPath, `${markerKey}\n`);
  } catch (error) {
    stderr.write(`Julie: failed to persist extraction marker: ${error.message}\n`);
  }
}

function resolveLaunchBinary({
  binaryPath,
  fsImpl = fs,
  required = false,
}) {
  if (fsImpl.existsSync(binaryPath)) {
    return binaryPath;
  }

  if (required) {
    throw new Error(`missing required Julie binary after extraction: ${binaryPath}`);
  }
  return null;
}

function maybeStopLegacyDaemon({
  needsExtract,
  legacyDaemonBinaryPath,
  markerPath,
  markerKey = 'ok',
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
  stderr = process.stderr,
}) {
  if (!needsExtract) {
    return false;
  }
  if (!legacyDaemonBinaryPath || !fsImpl.existsSync(legacyDaemonBinaryPath)) {
    return false;
  }
  if (fsImpl.existsSync(markerPath)) {
    try {
      if (fsImpl.readFileSync(markerPath, 'utf8').trim() === markerKey) {
        return false;
      }
    } catch (_) {
      // Unreadable marker: rerun the stop preflight and replace it.
    }
  }

  stderr.write('Julie: stopping legacy daemon before first launch of this version...\n');

  try {
    execFileSyncImpl(legacyDaemonBinaryPath, ['stop'], {
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString() : error.message;
    stderr.write(`Julie: preflight stop failed, continuing: ${detail}\n`);
    return false;
  }

  try {
    fsImpl.mkdirSync(path.dirname(markerPath), { recursive: true });
    fsImpl.writeFileSync(markerPath, `${markerKey}\n`);
  } catch (error) {
    stderr.write(`Julie: failed to persist preflight marker: ${error.message}\n`);
  }

  return true;
}

function extractBinary({
  archive,
  binaryPath,
  destDir,
  plat,
  touchPaths = [binaryPath],
  stderr = process.stderr,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
}) {
  stderr.write(`Julie: extracting binary for ${path.basename(destDir)}...\n`);
  fsImpl.mkdirSync(destDir, { recursive: true });

  // On Windows, use the system bsdtar (ships with Win10+) by full path.
  // MSYS2/Git Bash's GNU tar shadows it on PATH and can't handle .zip.
  // bsdtar is Windows-native so it handles drive letter colons correctly
  // (no --force-local needed, that's a GNU tar flag).
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const tarBin = plat === 'win32'
    ? path.join(sysRoot, 'System32', 'tar.exe')
    : 'tar';
  const tarArgs = archive.endsWith('.tar.gz')
    ? ['-xzf', archive, '-C', destDir]
    : ['-xf', archive, '-C', destDir];

  try {
    execFileSyncImpl(tarBin, tarArgs, { stdio: 'pipe', windowsHide: true });
    // Touch the binary so its mtime is newer than the archive.
    // Zip/tar extraction preserves the internal timestamp, which is the
    // original build time and always older than the archive file on disk.
    // Without this, the staleness check re-triggers on every launch.
    const now = new Date();
    for (const candidate of touchPaths) {
      if (candidate && fsImpl.existsSync(candidate)) {
        fsImpl.utimesSync(candidate, now, now);
      }
    }
    stderr.write('Julie: ready.\n');
    return true;
  } catch (error) {
    // On Windows the daemon may hold an exclusive lock on the binary.
    // If extraction fails but the binary already exists, just use it.
    if (fsImpl.existsSync(binaryPath)) {
      stderr.write('Julie: extraction skipped (binary in use), using existing binary.\n');
      return false;
    } else {
      const detail = error.stderr ? error.stderr.toString() : error.message;
      stderr.write(`Julie: extraction failed: ${detail}\nSee https://github.com/anortham/julie/issues for help.\n`);
      process.exit(1);
    }
  }
}

function prepareBinaryForLaunch({
  pluginRootPath = pluginRoot,
  target,
  archivePattern,
  binaryPath,
  legacyDaemonBinaryPath,
  archiveDir,
  plat,
  fsImpl = fs,
  stderr = process.stderr,
  extractBinaryImpl = extractBinary,
  maybeStopLegacyDaemonImpl = maybeStopLegacyDaemon,
}) {
  const archive = findArchive(archiveDir, archivePattern, fsImpl);
  const markerPath = getPreflightMarkerPath(pluginRootPath, target);
  const markerKey = archive ? path.basename(archive) : 'no-archive';
  const extractionMarkerPath = getExtractionMarkerPath(pluginRootPath, target);

  let launchPath = resolveLaunchBinary({
    binaryPath,
    fsImpl,
  });
  let needsExtract = !launchPath;
  if (!needsExtract && archive) {
    const archiveMtime = fsImpl.statSync(archive).mtimeMs;
    const launchMtime = fsImpl.statSync(launchPath).mtimeMs;
    if (!extractedArchiveMatches(extractionMarkerPath, markerKey, fsImpl)) {
      stderr.write('Julie: archive version changed, re-extracting...\n');
      needsExtract = true;
    } else if (archiveMtime > launchMtime) {
      stderr.write('Julie: archive newer than binary, re-extracting...\n');
      needsExtract = true;
    }
  }

  if (needsExtract) {
    maybeStopLegacyDaemonImpl({
      needsExtract,
      legacyDaemonBinaryPath,
      markerPath,
      markerKey,
      fsImpl,
      stderr,
    });
  }

  if (needsExtract) {
    if (!archive) {
      process.stderr.write(
        `Julie: archive not found matching: ${archivePattern.prefix}*${archivePattern.suffix}\n` +
        `Looked in: ${archiveDir}\n`
      );
      process.exit(1);
    }

    const extracted = extractBinaryImpl({
      archive,
      binaryPath,
      destDir: path.join(pluginRootPath, 'bin', target),
      plat,
      touchPaths: [binaryPath].filter(Boolean),
      stderr,
      fsImpl,
    });

    launchPath = resolveLaunchBinary({
      binaryPath,
      fsImpl,
      required: true,
    });
    if (extracted !== false) {
      writeExtractionMarker(extractionMarkerPath, markerKey, fsImpl, stderr);
    }
  }

  return launchPath;
}

function launchServer(binaryPath, retries) {
  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (err) => {
    process.stderr.write(`Julie: failed to spawn binary: ${err.message}\n`);
    if (retries > 0) {
      process.stderr.write(`Julie: retrying (${retries} left)...\n`);
      setTimeout(() => launchServer(binaryPath, retries - 1), 500);
    } else {
      process.exit(1);
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else if (code !== 0 && retries > 0) {
      process.stderr.write(`Julie: server exited with code ${code}, retrying (${retries} left)...\n`);
      setTimeout(() => launchServer(binaryPath, retries - 1), 500);
    } else {
      process.exit(code ?? 0);
    }
  });

  // Forward termination signals to child.
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try {
      process.on(sig, () => child.kill(sig));
    } catch (_) {
      // SIGHUP not available on Windows, that's fine.
    }
  }
}

function main() {
  const runtime = detectPlatform();
  if (!runtime) {
    process.stderr.write(`Julie: unsupported platform: ${os.platform()}-${os.arch()}\nSee https://github.com/anortham/julie/issues to request support or report a bug.\n`);
    process.exit(1);
  }

  const { target, binaryName, legacyDaemonBinaryName, archivePattern } = runtime;
  const binaryPath = path.join(pluginRoot, 'bin', target, binaryName);
  const legacyDaemonBinaryPath = legacyDaemonBinaryName
    ? path.join(pluginRoot, 'bin', target, legacyDaemonBinaryName)
    : null;
  const archiveDir = path.join(pluginRoot, 'bin', 'archives');
  const launchBinaryPath = prepareBinaryForLaunch({
    pluginRootPath: pluginRoot,
    target,
    archivePattern,
    binaryPath,
    legacyDaemonBinaryPath,
    archiveDir,
    plat: os.platform(),
  });

  launchServer(launchBinaryPath, 2);
}

module.exports = {
  detectPlatform,
  findArchive,
  getPreflightMarkerPath,
  maybeStopLegacyDaemon,
  prepareBinaryForLaunch,
};

if (require.main === module) {
  main();
}
