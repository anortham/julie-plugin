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
    const matches = fsImpl
      .readdirSync(archiveDir)
      .filter((file) => file.startsWith(archivePattern.prefix) && file.endsWith(archivePattern.suffix))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (matches.length > 0) {
      return path.join(archiveDir, matches[matches.length - 1]);
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

function isMaintainerOverride(serverPath, sidecarPath, fsImpl = fs) {
  return [serverPath, sidecarPath].every((candidate) => {
    try {
      return fsImpl.lstatSync(candidate).isSymbolicLink() && fsImpl.statSync(candidate).isFile();
    } catch (_) {
      return false;
    }
  });
}

function safeRelativePath(candidate) {
  return typeof candidate === 'string'
    && candidate.length > 0
    && !path.posix.isAbsolute(candidate)
    && !path.win32.isAbsolute(candidate)
    && !candidate.split(/[\\/]/).includes('..');
}

function manifestFiles(manifest) {
  return Array.isArray(manifest.files)
    ? manifest.files.map((file) => typeof file === 'string' ? file : file.path)
    : [];
}

function validateVersion(versionDir, target, archiveName, serverName, sidecarName, fsImpl = fs) {
  const marker = path.join(versionDir, '.ready');
  const manifestPath = path.join(versionDir, 'package-manifest.json');
  try {
    if (!fsImpl.lstatSync(marker).isFile()) throw new Error('readiness marker is not a regular file');
    if (fsImpl.readFileSync(marker, 'utf8').trim() !== archiveName) throw new Error('readiness marker does not match the selected archive');
    let manifestStat;
    try {
      manifestStat = fsImpl.lstatSync(manifestPath);
    } catch (_) {
      throw new Error('package manifest is missing');
    }
    if (!manifestStat.isFile()) throw new Error('package manifest is not a regular file');
    let manifest;
    try {
      manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`package manifest is malformed: ${error.message}`);
    }
    if (manifest.schema_version !== 2) throw new Error(`package manifest schema_version must be 2, got ${manifest.schema_version}`);
    if (manifest.rust_target !== target) throw new Error(`package manifest rust_target ${manifest.rust_target} does not match ${target}`);
    const files = manifestFiles(manifest);
    if (files.length === 0) throw new Error('package manifest files must be nonempty');
    if (!files.includes(sidecarName)) throw new Error(`package manifest does not list ${sidecarName}`);
    for (const entry of [serverName, ...files]) {
      if (!safeRelativePath(entry)) throw new Error(`package manifest has unsafe path: ${entry}`);
      if (!fsImpl.lstatSync(path.join(versionDir, entry)).isFile()) throw new Error(`package file is missing or not regular: ${entry}`);
    }
    return true;
  } catch (error) {
    throw new Error(`Julie: invalid extracted version: ${error.message}; remove the incomplete version directory and restart the harness`);
  }
}

function validateArchive(archive, plat, execFileSyncImpl = execFileSync) {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const tarBin = plat === 'win32' ? path.join(sysRoot, 'System32', 'tar.exe') : 'tar';
  let entries;
  try {
    entries = execFileSyncImpl(tarBin, ['-tf', archive], { stdio: 'pipe', windowsHide: true }).toString().split(/\r?\n/).filter(Boolean);
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString().trim() : error.message;
    throw new Error(`Julie: cannot inspect ${path.basename(archive)}: ${detail}; replace the archive and restart the harness`);
  }
  if (!entries.every(safeRelativePath)) throw new Error(`Julie: archive contains an unsafe path; replace ${path.basename(archive)} and restart the harness`);
}

function containsSymlink(root, fsImpl = fs) {
  return fsImpl.readdirSync(root, { withFileTypes: true }).some((entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isSymbolicLink() || (entry.isDirectory() && containsSymlink(candidate, fsImpl));
  });
}

function versionDirectory(pluginRootPath, target, archive) {
  return path.join(pluginRootPath, 'bin', target, 'versions', path.basename(archive));
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
    const detail = error.stderr ? error.stderr.toString() : error.message;
    throw new Error(`Julie: extraction failed: ${detail}; remove the incomplete version directory and restart the harness`);
  }
}

function prepareBinaryForLaunch({
  pluginRootPath = pluginRoot,
  target,
  archivePattern,
  binaryPath,
  sidecarPath,
  legacyDaemonBinaryPath,
  archiveDir,
  plat,
  fsImpl = fs,
  stderr = process.stderr,
  extractBinaryImpl = extractBinary,
  maybeStopLegacyDaemonImpl = maybeStopLegacyDaemon,
  validateArchiveImpl = validateArchive,
}) {
  const archive = findArchive(archiveDir, archivePattern, fsImpl);
  if (sidecarPath && isMaintainerOverride(binaryPath, sidecarPath, fsImpl)) {
    return binaryPath;
  }
  if (sidecarPath && !archive) {
    throw new Error(`archive not found matching: ${archivePattern.prefix}*${archivePattern.suffix}`);
  }
  if (sidecarPath) {
    const finalDir = versionDirectory(pluginRootPath, target, archive);
    const serverPath = path.join(finalDir, path.basename(binaryPath));
    if (fsImpl.existsSync(finalDir)) {
      validateVersion(finalDir, target, path.basename(archive), path.basename(binaryPath), path.basename(sidecarPath), fsImpl);
      return serverPath;
    }
    const stagingDir = `${finalDir}.staging-${process.pid}`;
    fsImpl.mkdirSync(path.dirname(stagingDir), { recursive: true });
    const uniqueStagingDir = fsImpl.mkdtempSync(`${stagingDir}-`);
    try {
      validateArchiveImpl(archive, plat);
      extractBinaryImpl({ archive, binaryPath: path.join(uniqueStagingDir, path.basename(binaryPath)), destDir: uniqueStagingDir, plat, touchPaths: [], stderr, fsImpl });
      if (containsSymlink(uniqueStagingDir, fsImpl)) {
        throw new Error(`Julie: extracted version contains a symlink; remove it and restart the harness`);
      }
      fsImpl.writeFileSync(path.join(uniqueStagingDir, '.ready'), `${path.basename(archive)}\n`);
      validateVersion(uniqueStagingDir, target, path.basename(archive), path.basename(binaryPath), path.basename(sidecarPath), fsImpl);
      fsImpl.renameSync(uniqueStagingDir, finalDir);
      return serverPath;
    } catch (error) {
      fsImpl.rmSync(uniqueStagingDir, { recursive: true, force: true });
      if (error.message.includes('restart the harness')) throw error;
      throw new Error(`${error.message}; replace ${path.basename(archive)} and restart the harness`);
    }
  }
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
  const sidecarPath = path.join(pluginRoot, 'bin', target, process.platform === 'win32' ? 'julie-semantic-sidecar.exe' : 'julie-semantic-sidecar');
  const legacyDaemonBinaryPath = legacyDaemonBinaryName
    ? path.join(pluginRoot, 'bin', target, legacyDaemonBinaryName)
    : null;
  const archiveDir = path.join(pluginRoot, 'bin', 'archives');
  const launchBinaryPath = prepareBinaryForLaunch({
    pluginRootPath: pluginRoot,
    target,
    archivePattern,
    binaryPath,
    sidecarPath,
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
  validateArchive,
};

if (require.main === module) {
  main();
}
