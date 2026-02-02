#!/usr/bin/env node
"use strict";

// src/services/infrastructure/process-manager.ts
var import_fs2 = require("fs");
var import_child_process = require("child_process");
var import_fs3 = require("fs");
var import_path2 = require("path");

// src/shared/config.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var DEFAULTS = {
  // Worker settings
  WORKER_PORT: "37778",
  WORKER_HOST: "127.0.0.1",
  // AI settings
  AI_MODEL: "claude-sonnet-4-5",
  AI_PROVIDER: "anthropic",
  AI_COMPRESSION_ENABLED: "true",
  // 设为 'false' 可禁用 AI 压缩功能
  // Database settings
  DATA_DIR: (0, import_path.join)((0, import_os.homedir)(), ".ai-agent-entrance"),
  DB_NAME: "knowledge.db",
  // Logging
  LOG_LEVEL: "INFO",
  // Context injection
  CONTEXT_OBSERVATIONS: "20",
  CONTEXT_SHOW_ROUTING: "true",
  // Knowledge sinking
  GLOBAL_KNOWLEDGE_REPO: (0, import_path.join)((0, import_os.homedir)(), "compound-knowledge"),
  AUTO_SINK_ON_STOP: "true",
  // Skip tools (don't capture observations for these)
  SKIP_TOOLS: "ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion,TaskList,TaskGet",
  // L2 Sync settings
  L2_REPO_URL: "",
  AUTO_SYNC_ON_SESSION_START: "false",
  SYNC_CONFLICT_STRATEGY: "remote-wins"
};
function getDataDir() {
  return process.env.AI_ENTRANCE_DATA_DIR || DEFAULTS.DATA_DIR;
}
function getLogsDir() {
  return (0, import_path.join)(getDataDir(), "logs");
}
function getPidFile() {
  return (0, import_path.join)(getDataDir(), "worker.pid");
}
function getSettingsPath() {
  return (0, import_path.join)(getDataDir(), "settings.json");
}
function getPluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || (0, import_path.join)(__dirname, "..");
}
function loadSettings() {
  const settingsPath = getSettingsPath();
  try {
    if (!(0, import_fs.existsSync)(settingsPath)) {
      ensureDataDir();
      const defaultSettings = {
        WORKER_PORT: DEFAULTS.WORKER_PORT,
        WORKER_HOST: DEFAULTS.WORKER_HOST,
        AI_MODEL: DEFAULTS.AI_MODEL,
        AI_PROVIDER: DEFAULTS.AI_PROVIDER,
        AI_COMPRESSION_ENABLED: DEFAULTS.AI_COMPRESSION_ENABLED,
        LOG_LEVEL: DEFAULTS.LOG_LEVEL,
        CONTEXT_OBSERVATIONS: DEFAULTS.CONTEXT_OBSERVATIONS,
        CONTEXT_SHOW_ROUTING: DEFAULTS.CONTEXT_SHOW_ROUTING,
        AUTO_SINK_ON_STOP: DEFAULTS.AUTO_SINK_ON_STOP,
        SKIP_TOOLS: DEFAULTS.SKIP_TOOLS
      };
      (0, import_fs.writeFileSync)(settingsPath, JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    }
    const content = (0, import_fs.readFileSync)(settingsPath, "utf-8");
    const loaded = JSON.parse(content);
    return {
      WORKER_PORT: loaded.WORKER_PORT || DEFAULTS.WORKER_PORT,
      WORKER_HOST: loaded.WORKER_HOST || DEFAULTS.WORKER_HOST,
      AI_MODEL: loaded.AI_MODEL || DEFAULTS.AI_MODEL,
      AI_PROVIDER: loaded.AI_PROVIDER || DEFAULTS.AI_PROVIDER,
      AI_COMPRESSION_ENABLED: loaded.AI_COMPRESSION_ENABLED ?? DEFAULTS.AI_COMPRESSION_ENABLED,
      LOG_LEVEL: loaded.LOG_LEVEL || DEFAULTS.LOG_LEVEL,
      CONTEXT_OBSERVATIONS: loaded.CONTEXT_OBSERVATIONS || DEFAULTS.CONTEXT_OBSERVATIONS,
      CONTEXT_SHOW_ROUTING: loaded.CONTEXT_SHOW_ROUTING || DEFAULTS.CONTEXT_SHOW_ROUTING,
      AUTO_SINK_ON_STOP: loaded.AUTO_SINK_ON_STOP || DEFAULTS.AUTO_SINK_ON_STOP,
      SKIP_TOOLS: loaded.SKIP_TOOLS || DEFAULTS.SKIP_TOOLS
    };
  } catch {
    return {
      WORKER_PORT: DEFAULTS.WORKER_PORT,
      WORKER_HOST: DEFAULTS.WORKER_HOST,
      AI_MODEL: DEFAULTS.AI_MODEL,
      AI_PROVIDER: DEFAULTS.AI_PROVIDER,
      AI_COMPRESSION_ENABLED: DEFAULTS.AI_COMPRESSION_ENABLED,
      LOG_LEVEL: DEFAULTS.LOG_LEVEL,
      CONTEXT_OBSERVATIONS: DEFAULTS.CONTEXT_OBSERVATIONS,
      CONTEXT_SHOW_ROUTING: DEFAULTS.CONTEXT_SHOW_ROUTING,
      AUTO_SINK_ON_STOP: DEFAULTS.AUTO_SINK_ON_STOP,
      SKIP_TOOLS: DEFAULTS.SKIP_TOOLS
    };
  }
}
function getSetting(key) {
  const settings = loadSettings();
  return settings[key] || DEFAULTS[key];
}
function ensureDataDir() {
  const dataDir = getDataDir();
  if (!(0, import_fs.existsSync)(dataDir)) {
    (0, import_fs.mkdirSync)(dataDir, { recursive: true });
  }
  const logsDir = getLogsDir();
  if (!(0, import_fs.existsSync)(logsDir)) {
    (0, import_fs.mkdirSync)(logsDir, { recursive: true });
  }
}
function getWorkerPort() {
  return parseInt(process.env.AI_ENTRANCE_WORKER_PORT || getSetting("WORKER_PORT"), 10);
}
function getWorkerHost() {
  return process.env.AI_ENTRANCE_WORKER_HOST || getSetting("WORKER_HOST");
}

// src/services/infrastructure/process-manager.ts
var IS_WINDOWS = process.platform === "win32";
var ProcessManager = class {
  // ============================================================================
  // Start/Stop/Restart
  // ============================================================================
  static async start(port) {
    const targetPort = port || getWorkerPort();
    if (isNaN(targetPort) || targetPort < 1024 || targetPort > 65535) {
      return { success: false, error: `Invalid port ${targetPort}` };
    }
    if (await this.isRunning()) {
      const info = this.getPidInfo();
      return { success: true, pid: info?.pid };
    }
    const logsDir = getLogsDir();
    (0, import_fs2.mkdirSync)(logsDir, { recursive: true });
    const workerScript = (0, import_path2.join)(getPluginRoot(), "scripts", "worker-service.cjs");
    if (!(0, import_fs2.existsSync)(workerScript)) {
      return { success: false, error: `Worker script not found at ${workerScript}` };
    }
    const logFile = this.getLogFilePath();
    return this.spawnWorker(workerScript, logFile, targetPort);
  }
  static async spawnWorker(script, logFile, port) {
    try {
      if (IS_WINDOWS) {
        const cmd = `Start-Process -FilePath 'node' -ArgumentList '"${script}"' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id`;
        const result = (0, import_child_process.spawnSync)("powershell", ["-Command", cmd], {
          stdio: "pipe",
          timeout: 1e4,
          windowsHide: true,
          env: { ...process.env, AI_ENTRANCE_WORKER_PORT: String(port) }
        });
        if (result.status !== 0) {
          return { success: false, error: `PowerShell spawn failed: ${result.stderr?.toString()}` };
        }
        const pid = parseInt(result.stdout.toString().trim(), 10);
        if (isNaN(pid)) {
          return { success: false, error: "Failed to get PID from PowerShell" };
        }
        this.writePidFile({ pid, port, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
        return this.waitForHealth(pid, port);
      } else {
        const child = (0, import_child_process.spawn)("node", [script], {
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, AI_ENTRANCE_WORKER_PORT: String(port) },
          cwd: getPluginRoot()
        });
        const logStream = (0, import_fs3.createWriteStream)(logFile, { flags: "a" });
        child.stdout?.pipe(logStream);
        child.stderr?.pipe(logStream);
        child.unref();
        if (!child.pid) {
          return { success: false, error: "Failed to get PID from spawned process" };
        }
        this.writePidFile({ pid: child.pid, port, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
        return this.waitForHealth(child.pid, port);
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  static async stop(timeout = 5e3) {
    const info = this.getPidInfo();
    const port = info?.port || getWorkerPort();
    if (await this.tryHttpShutdown(port)) {
      this.removePidFile();
      return true;
    }
    if (!info) {
      return true;
    }
    try {
      if (IS_WINDOWS) {
        (0, import_child_process.spawnSync)("taskkill", ["/PID", String(info.pid), "/T", "/F"], {
          timeout: 1e4,
          stdio: "ignore"
        });
      } else {
        process.kill(info.pid, "SIGTERM");
        await this.waitForExit(info.pid, timeout);
      }
    } catch {
    }
    this.removePidFile();
    return true;
  }
  static async restart(port) {
    await this.stop();
    return this.start(port);
  }
  // ============================================================================
  // Status
  // ============================================================================
  static async status() {
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
      uptime: this.formatUptime(info.startedAt)
    };
  }
  static async isRunning() {
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
  static getPidInfo() {
    try {
      const pidFile = getPidFile();
      if (!(0, import_fs2.existsSync)(pidFile)) return null;
      const content = (0, import_fs2.readFileSync)(pidFile, "utf-8");
      const info = JSON.parse(content);
      if (typeof info.pid !== "number" || typeof info.port !== "number") {
        return null;
      }
      return info;
    } catch {
      return null;
    }
  }
  static writePidFile(info) {
    const dataDir = getDataDir();
    (0, import_fs2.mkdirSync)(dataDir, { recursive: true });
    (0, import_fs2.writeFileSync)(getPidFile(), JSON.stringify(info, null, 2));
  }
  static removePidFile() {
    try {
      const pidFile = getPidFile();
      if ((0, import_fs2.existsSync)(pidFile)) {
        (0, import_fs2.unlinkSync)(pidFile);
      }
    } catch {
    }
  }
  // ============================================================================
  // Health Check
  // ============================================================================
  static async waitForHealth(pid, port, timeout = 1e4) {
    const start2 = Date.now();
    const adjustedTimeout = IS_WINDOWS ? timeout * 2 : timeout;
    while (Date.now() - start2 < adjustedTimeout) {
      if (!this.isProcessAlive(pid)) {
        return { success: false, error: "Process died during startup" };
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(1e3)
        });
        if (response.ok) {
          return { success: true, pid };
        }
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { success: false, error: `Health check timed out after ${adjustedTimeout}ms` };
  }
  static async tryHttpShutdown(port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(2e3)
      });
      if (response.ok) {
        await this.waitForPortFree(port, 5e3);
        return true;
      }
    } catch {
    }
    return false;
  }
  static async waitForPortFree(port, timeout) {
    const start2 = Date.now();
    while (Date.now() - start2 < timeout) {
      try {
        await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(500)
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        return true;
      }
    }
    return false;
  }
  static async waitForExit(pid, timeout) {
    const start2 = Date.now();
    while (Date.now() - start2 < timeout) {
      if (!this.isProcessAlive(pid)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Process did not exit within timeout");
  }
  // ============================================================================
  // Utilities
  // ============================================================================
  static isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  static getLogFilePath() {
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    return (0, import_path2.join)(getLogsDir(), `worker-${date}.log`);
  }
  static formatUptime(startedAt) {
    const start2 = new Date(startedAt).getTime();
    const ms = Date.now() - start2;
    const s = Math.floor(ms / 1e3);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }
};

// src/cli/worker-cli.ts
var IS_TTY = process.stdin.isTTY;
var JSON_OUTPUT = '{"continue": true, "suppressOutput": true}';
async function start() {
  const port = getWorkerPort();
  const result = await ProcessManager.start(port);
  if (result.success) {
    if (IS_TTY) {
      console.log(`Worker started (PID: ${result.pid})`);
      const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      console.log(`Logs: ~/.ai-agent-entrance/logs/worker-${date}.log`);
    } else {
      console.log(JSON_OUTPUT);
    }
    process.exit(0);
  } else {
    console.error(`Failed to start: ${result.error}`);
    process.exit(1);
  }
}
async function stop() {
  await ProcessManager.stop();
  console.log(IS_TTY ? "Worker stopped" : JSON_OUTPUT);
  process.exit(0);
}
async function restart() {
  const port = getWorkerPort();
  const result = await ProcessManager.restart(port);
  if (result.success) {
    console.log(IS_TTY ? `Worker restarted (PID: ${result.pid})` : JSON_OUTPUT);
    process.exit(0);
  } else {
    console.error(`Failed to restart: ${result.error}`);
    process.exit(1);
  }
}
async function status() {
  const info = await ProcessManager.status();
  if (IS_TTY) {
    if (info.running) {
      console.log("Worker is running");
      console.log(`  PID: ${info.pid}`);
      console.log(`  Port: ${info.port}`);
      console.log(`  Uptime: ${info.uptime}`);
    } else {
      console.log("Worker is not running");
    }
  } else {
    console.log(JSON_OUTPUT);
  }
  process.exit(0);
}
async function hook(hookType) {
  const port = getWorkerPort();
  const host = getWorkerHost();
  const running = await ProcessManager.isRunning();
  if (!running) {
    const result = await ProcessManager.start(port);
    if (!result.success) {
      console.error(JSON.stringify({ continue: true, suppressOutput: true, error: result.error }));
      process.exit(0);
    }
  }
  let input = "";
  if (!IS_TTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString("utf-8");
  }
  const endpoints = {
    "session-start": "/api/hook/session-start",
    "user-prompt": "/api/hook/user-prompt",
    "tool-use": "/api/hook/tool-use",
    "stop": "/api/hook/stop",
    "context": "/api/context/inject"
  };
  const endpoint = endpoints[hookType];
  if (!endpoint) {
    console.error(`Unknown hook type: ${hookType}`);
    console.log(JSON_OUTPUT);
    process.exit(0);
  }
  try {
    let response;
    if (hookType === "context") {
      const project = process.env.CLAUDE_PROJECT || process.cwd();
      response = await fetch(`http://${host}:${port}${endpoint}?project=${encodeURIComponent(project)}`, {
        signal: AbortSignal.timeout(3e4)
      });
    } else {
      let body = {};
      if (input) {
        try {
          body = JSON.parse(input);
        } catch {
          body = { raw: input };
        }
      }
      if (!body.project) {
        body.project = process.env.CLAUDE_PROJECT || process.cwd();
      }
      response = await fetch(`http://${host}:${port}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3e4)
      });
    }
    const result = await response.json();
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (error) {
    console.log(JSON_OUTPUT);
    process.exit(0);
  }
}
async function main() {
  const command = process.argv[2];
  switch (command) {
    case "start":
      await start();
      break;
    case "stop":
      await stop();
      break;
    case "restart":
      await restart();
      break;
    case "status":
      await status();
      break;
    case "hook":
      const hookType = process.argv[3];
      if (!hookType) {
        console.error("Usage: worker-cli.js hook <session-start|user-prompt|tool-use|stop|context>");
        process.exit(1);
      }
      await hook(hookType);
      break;
    default:
      console.log("Usage: worker-cli.js <start|stop|restart|status|hook>");
      process.exit(1);
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
