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

// --- Platform detection ---
const plat = os.platform();
const arch = os.arch();

let target, binaryName, archivePattern;
if (plat === 'darwin' && arch === 'arm64') {
  target = 'aarch64-apple-darwin';
  binaryName = 'julie-server';
  archivePattern = { prefix: 'julie-v', suffix: `-${target}.tar.gz` };
} else if (plat === 'linux' && arch === 'x64') {
  target = 'x86_64-unknown-linux-gnu';
  binaryName = 'julie-server';
  archivePattern = { prefix: 'julie-v', suffix: `-${target}.tar.gz` };
} else if (plat === 'win32' && arch === 'x64') {
  target = 'x86_64-pc-windows-msvc';
  binaryName = 'julie-server.exe';
  archivePattern = { prefix: 'julie-v', suffix: `-${target}.zip` };
} else {
  process.stderr.write(`Julie: unsupported platform: ${plat}-${arch}\n`);
  process.exit(1);
}

const binaryPath = path.join(pluginRoot, 'bin', target, binaryName);
const archiveDir = path.join(pluginRoot, 'bin', 'archives');

// --- Find matching archive ---
let archive = null;
try {
  for (const f of fs.readdirSync(archiveDir)) {
    if (f.startsWith(archivePattern.prefix) && f.endsWith(archivePattern.suffix)) {
      archive = path.join(archiveDir, f);
      break;
    }
  }
} catch (_) {
  // archiveDir missing
}

// --- Decide whether extraction is needed ---
let needsExtract = !fs.existsSync(binaryPath);
if (!needsExtract && archive) {
  const archiveMtime = fs.statSync(archive).mtimeMs;
  const binaryMtime = fs.statSync(binaryPath).mtimeMs;
  if (archiveMtime > binaryMtime) {
    process.stderr.write('Julie: archive newer than binary, re-extracting...\n');
    needsExtract = true;
  }
}

if (needsExtract) {
  if (!archive) {
    process.stderr.write(
      `Julie: archive not found matching: ${archivePattern.prefix}*${archivePattern.suffix}\n` +
      `Looked in: ${archiveDir}\n`
    );
    process.exit(1);
  }

  process.stderr.write(`Julie: extracting binary for ${target}...\n`);
  const destDir = path.join(pluginRoot, 'bin', target);
  fs.mkdirSync(destDir, { recursive: true });

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
    execFileSync(tarBin, tarArgs, { stdio: 'pipe' });
    // Touch the binary so its mtime is newer than the archive.
    // Zip/tar extraction preserves the internal timestamp, which is the
    // original build time and always older than the archive file on disk.
    // Without this, the staleness check re-triggers on every launch.
    const now = new Date();
    fs.utimesSync(binaryPath, now, now);
    process.stderr.write('Julie: ready.\n');
  } catch (e) {
    // On Windows the daemon may hold an exclusive lock on the binary.
    // If extraction fails but the binary already exists, just use it.
    if (fs.existsSync(binaryPath)) {
      process.stderr.write('Julie: extraction skipped (binary in use), using existing binary.\n');
    } else {
      process.stderr.write(`Julie: extraction failed: ${e.stderr || e.message}\n`);
      process.exit(1);
    }
  }
}

// --- Spawn the server, inheriting stdio for MCP JSON-RPC ---
function launchServer(retries) {
  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: true,
  });

  child.on('error', (err) => {
    process.stderr.write(`Julie: failed to spawn binary: ${err.message}\n`);
    if (retries > 0) {
      process.stderr.write(`Julie: retrying (${retries} left)...\n`);
      setTimeout(() => launchServer(retries - 1), 500);
    } else {
      process.exit(1);
    }
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else if (code !== 0 && retries > 0) {
      process.stderr.write(`Julie: server exited with code ${code}, retrying (${retries} left)...\n`);
      setTimeout(() => launchServer(retries - 1), 500);
    } else {
      process.exit(code ?? 0);
    }
  });

  // Forward termination signals to child
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    try {
      process.on(sig, () => child.kill(sig));
    } catch (_) {
      // SIGHUP not available on Windows, that's fine
    }
  }
}

launchServer(2);
