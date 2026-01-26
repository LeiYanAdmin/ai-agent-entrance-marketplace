/**
 * Process management for the worker service
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { getDataDir, getPidFile, getLogsDir, getWorkerPort, getPluginRoot } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

const IS_WINDOWS = process.platform === 'win32';

interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;
  version?: string;
}

export class ProcessManager {
  // ============================================================================
  // Start/Stop/Restart
  // ============================================================================

  static async start(port?: number): Promise<{ success: boolean; pid?: number; error?: string }> {
    const targetPort = port || getWorkerPort();

    // Validate port
    if (isNaN(targetPort) || targetPort < 1024 || targetPort > 65535) {
      return { success: false, error: `Invalid port ${targetPort}` };
    }

    // Check if already running
    if (await this.isRunning()) {
      const info = this.getPidInfo();
      return { success: true, pid: info?.pid };
    }

    // Ensure logs directory exists
    const logsDir = getLogsDir();
    mkdirSync(logsDir, { recursive: true });

    // Get worker script path
    const workerScript = join(getPluginRoot(), 'scripts', 'worker-service.cjs');
    if (!existsSync(workerScript)) {
      return { success: false, error: `Worker script not found at ${workerScript}` };
    }

    // Get log file path
    const logFile = this.getLogFilePath();

    return this.spawnWorker(workerScript, logFile, targetPort);
  }

  private static async spawnWorker(
    script: string,
    logFile: string,
    port: number
  ): Promise<{ success: boolean; pid?: number; error?: string }> {
    try {
      if (IS_WINDOWS) {
        // Windows: Use PowerShell to spawn detached
        const cmd = `Start-Process -FilePath 'node' -ArgumentList '"${script}"' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id`;

        const result = spawnSync('powershell', ['-Command', cmd], {
          stdio: 'pipe',
          timeout: 10000,
          windowsHide: true,
          env: { ...process.env, AI_ENTRANCE_WORKER_PORT: String(port) },
        });

        if (result.status !== 0) {
          return { success: false, error: `PowerShell spawn failed: ${result.stderr?.toString()}` };
        }

        const pid = parseInt(result.stdout.toString().trim(), 10);
        if (isNaN(pid)) {
          return { success: false, error: 'Failed to get PID from PowerShell' };
        }

        this.writePidFile({ pid, port, startedAt: new Date().toISOString() });
        return this.waitForHealth(pid, port);
      } else {
        // Unix: Use detached spawn with pipe, then redirect to log file
        const child = spawn('node', [script], {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, AI_ENTRANCE_WORKER_PORT: String(port) },
          cwd: getPluginRoot(),
        });

        // Pipe output to log file
        const logStream = createWriteStream(logFile, { flags: 'a' });
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);

        child.unref();

        if (!child.pid) {
          return { success: false, error: 'Failed to get PID from spawned process' };
        }

        this.writePidFile({ pid: child.pid, port, startedAt: new Date().toISOString() });
        return this.waitForHealth(child.pid, port);
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  static async stop(timeout: number = 5000): Promise<boolean> {
    const info = this.getPidInfo();

    // Try HTTP shutdown first
    const port = info?.port || getWorkerPort();
    if (await this.tryHttpShutdown(port)) {
      this.removePidFile();
      return true;
    }

    // No PID info, assume stopped
    if (!info) {
      return true;
    }

    // Kill process
    try {
      if (IS_WINDOWS) {
        spawnSync('taskkill', ['/PID', String(info.pid), '/T', '/F'], {
          timeout: 10000,
          stdio: 'ignore',
        });
      } else {
        process.kill(info.pid, 'SIGTERM');
        await this.waitForExit(info.pid, timeout);
      }
    } catch {
      // Process may already be dead
    }

    this.removePidFile();
    return true;
  }

  static async restart(port?: number): Promise<{ success: boolean; pid?: number; error?: string }> {
    await this.stop();
    return this.start(port);
  }

  // ============================================================================
  // Status
  // ============================================================================

  static async status(): Promise<{
    running: boolean;
    pid?: number;
    port?: number;
    uptime?: string;
  }> {
    const info = this.getPidInfo();
    if (!info) {
      return { running: false };
    }

    const alive = this.isProcessAlive(info.pid);
    if (!alive) {
      this.removePidFile();
      return { running: false };
    }

    return {
      running: true,
      pid: info.pid,
      port: info.port,
      uptime: this.formatUptime(info.startedAt),
    };
  }

  static async isRunning(): Promise<boolean> {
    const info = this.getPidInfo();
    if (!info) return false;

    const alive = this.isProcessAlive(info.pid);
    if (!alive) {
      this.removePidFile();
    }
    return alive;
  }

  // ============================================================================
  // PID File
  // ============================================================================

  static getPidInfo(): PidInfo | null {
    try {
      const pidFile = getPidFile();
      if (!existsSync(pidFile)) return null;

      const content = readFileSync(pidFile, 'utf-8');
      const info = JSON.parse(content) as PidInfo;

      if (typeof info.pid !== 'number' || typeof info.port !== 'number') {
        return null;
      }

      return info;
    } catch {
      return null;
    }
  }

  static writePidFile(info: PidInfo): void {
    const dataDir = getDataDir();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(getPidFile(), JSON.stringify(info, null, 2));
  }

  static removePidFile(): void {
    try {
      const pidFile = getPidFile();
      if (existsSync(pidFile)) {
        unlinkSync(pidFile);
      }
    } catch {
      // Ignore errors
    }
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  private static async waitForHealth(
    pid: number,
    port: number,
    timeout: number = 10000
  ): Promise<{ success: boolean; pid?: number; error?: string }> {
    const start = Date.now();
    const adjustedTimeout = IS_WINDOWS ? timeout * 2 : timeout;

    while (Date.now() - start < adjustedTimeout) {
      // Check if process is still alive
      if (!this.isProcessAlive(pid)) {
        return { success: false, error: 'Process died during startup' };
      }

      // Try health check
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          return { success: true, pid };
        }
      } catch {
        // Not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return { success: false, error: `Health check timed out after ${adjustedTimeout}ms` };
  }

  private static async tryHttpShutdown(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/shutdown`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        await this.waitForPortFree(port, 5000);
        return true;
      }
    } catch {
      // Server not responding
    }
    return false;
  }

  private static async waitForPortFree(port: number, timeout: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(500),
        });
        // Still responding, wait
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch {
        // Port is free
        return true;
      }
    }
    return false;
  }

  private static async waitForExit(pid: number, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!this.isProcessAlive(pid)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Process did not exit within timeout');
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private static getLogFilePath(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(getLogsDir(), `worker-${date}.log`);
  }

  private static formatUptime(startedAt: string): string {
    const start = new Date(startedAt).getTime();
    const ms = Date.now() - start;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);

    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }
}
