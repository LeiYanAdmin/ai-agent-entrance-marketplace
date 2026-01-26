#!/usr/bin/env node
/**
 * Smart Install Script for AI Agent Entrance
 *
 * Ensures dependencies are installed and handles version updates.
 * Only runs when version changes to avoid blocking every session.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';

const ROOT = join(homedir(), '.claude', 'plugins', 'marketplaces', 'ai-agent-entrance');
const MARKER = join(ROOT, '.install-version');
const IS_WINDOWS = process.platform === 'win32';
const DATA_DIR = join(homedir(), '.ai-agent-entrance');

/**
 * Check if Node.js is available
 */
function isNodeAvailable() {
  try {
    const result = spawnSync('node', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get Node.js version
 */
function getNodeVersion() {
  try {
    const result = spawnSync('node', ['--version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: IS_WINDOWS,
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Check if dependencies need to be installed
 */
function needsInstall() {
  // Always need install if no node_modules
  if (!existsSync(join(ROOT, 'node_modules'))) {
    return true;
  }

  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const marker = JSON.parse(readFileSync(MARKER, 'utf-8'));
    return pkg.version !== marker.version;
  } catch {
    return true;
  }
}

/**
 * Install dependencies
 */
function installDeps() {
  console.error('📦 Installing dependencies...');

  try {
    execSync('npm install', {
      cwd: ROOT,
      stdio: 'inherit',
      shell: IS_WINDOWS,
    });
  } catch (error) {
    throw new Error('npm install failed: ' + error.message);
  }

  // Write version marker
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    writeFileSync(
      MARKER,
      JSON.stringify({
        version: pkg.version,
        node: getNodeVersion(),
        installedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore marker write errors
  }
}

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    console.error(`✅ Created data directory: ${DATA_DIR}`);
  }
}

/**
 * Restart worker if version changed
 */
async function restartWorkerIfNeeded() {
  const port = process.env.AI_ENTRANCE_WORKER_PORT || 37778;

  try {
    // Try graceful shutdown via HTTP
    execSync(`curl -s -X POST http://127.0.0.1:${port}/api/admin/shutdown`, {
      stdio: 'ignore',
      shell: IS_WINDOWS,
      timeout: 5000,
    });

    // Brief wait for port to free
    if (IS_WINDOWS) {
      execSync('timeout /t 1 /nobreak >nul', { stdio: 'ignore', shell: true });
    } else {
      execSync('sleep 0.5', { stdio: 'ignore', shell: true });
    }

    console.error('✅ Worker restarted for version update');
  } catch {
    // Worker wasn't running or already stopped - that's fine
  }
}

// Main execution
try {
  // Step 1: Check Node.js
  if (!isNodeAvailable()) {
    console.error('❌ Node.js is required but not found in PATH');
    process.exit(1);
  }

  // Step 2: Ensure data directory
  ensureDataDir();

  // Step 3: Install dependencies if needed
  if (needsInstall()) {
    const pkgPath = join(ROOT, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      console.error(`[ai-agent-entrance] Installing v${pkg.version}...`);
    }

    installDeps();
    console.error('✅ Dependencies installed');

    // Restart worker to pick up new code
    await restartWorkerIfNeeded();
  }
} catch (e) {
  console.error('❌ Installation failed:', e.message);
  // Exit 0 to not block Claude
  process.exit(0);
}
