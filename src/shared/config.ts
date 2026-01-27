/**
 * Configuration management for AI Agent Entrance
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULTS = {
  // Worker settings
  WORKER_PORT: '37778',
  WORKER_HOST: '127.0.0.1',

  // AI settings
  AI_MODEL: 'claude-sonnet-4-5',
  AI_PROVIDER: 'anthropic',

  // Database settings
  DATA_DIR: join(homedir(), '.ai-agent-entrance'),
  DB_NAME: 'knowledge.db',

  // Logging
  LOG_LEVEL: 'INFO',

  // Context injection
  CONTEXT_OBSERVATIONS: '20',
  CONTEXT_SHOW_ROUTING: 'true',

  // Knowledge sinking
  GLOBAL_KNOWLEDGE_REPO: join(homedir(), 'compound-knowledge'),
  AUTO_SINK_ON_STOP: 'true',

  // Skip tools (don't capture observations for these)
  SKIP_TOOLS: 'ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion,TaskList,TaskGet',

  // L2 Sync settings
  L2_REPO_URL: '',
  AUTO_SYNC_ON_SESSION_START: 'false',
  SYNC_CONFLICT_STRATEGY: 'remote-wins',
};

export type ConfigKey = keyof typeof DEFAULTS;

// ============================================================================
// Paths
// ============================================================================

export function getDataDir(): string {
  return process.env.AI_ENTRANCE_DATA_DIR || DEFAULTS.DATA_DIR;
}

export function getDbPath(): string {
  return join(getDataDir(), DEFAULTS.DB_NAME);
}

export function getLogsDir(): string {
  return join(getDataDir(), 'logs');
}

export function getPidFile(): string {
  return join(getDataDir(), 'worker.pid');
}

export function getSettingsPath(): string {
  return join(getDataDir(), 'settings.json');
}

export function getPluginRoot(): string {
  // CLAUDE_PLUGIN_ROOT is set by Claude Code hooks
  // Fallback: resolve from __dirname (scripts/) up one level to plugin root
  return process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..');
}

export function getGlobalKnowledgeRepo(): string {
  return process.env.AI_ENTRANCE_KNOWLEDGE_REPO || DEFAULTS.GLOBAL_KNOWLEDGE_REPO;
}

export function getL2RepoPath(): string {
  return process.env.AI_ENTRANCE_L2_REPO || join(getGlobalKnowledgeRepo());
}

export function getL2IndexPath(): string {
  return join(getL2RepoPath(), 'knowledge', '_index.json');
}

// ============================================================================
// Settings Manager
// ============================================================================

export interface Settings {
  WORKER_PORT: string;
  WORKER_HOST: string;
  AI_MODEL: string;
  AI_PROVIDER: string;
  LOG_LEVEL: string;
  CONTEXT_OBSERVATIONS: string;
  CONTEXT_SHOW_ROUTING: string;
  AUTO_SINK_ON_STOP: string;
  SKIP_TOOLS: string;
}

export function loadSettings(): Settings {
  const settingsPath = getSettingsPath();

  try {
    if (!existsSync(settingsPath)) {
      // Create default settings
      ensureDataDir();
      const defaultSettings: Settings = {
        WORKER_PORT: DEFAULTS.WORKER_PORT,
        WORKER_HOST: DEFAULTS.WORKER_HOST,
        AI_MODEL: DEFAULTS.AI_MODEL,
        AI_PROVIDER: DEFAULTS.AI_PROVIDER,
        LOG_LEVEL: DEFAULTS.LOG_LEVEL,
        CONTEXT_OBSERVATIONS: DEFAULTS.CONTEXT_OBSERVATIONS,
        CONTEXT_SHOW_ROUTING: DEFAULTS.CONTEXT_SHOW_ROUTING,
        AUTO_SINK_ON_STOP: DEFAULTS.AUTO_SINK_ON_STOP,
        SKIP_TOOLS: DEFAULTS.SKIP_TOOLS,
      };
      writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    }

    const content = readFileSync(settingsPath, 'utf-8');
    const loaded = JSON.parse(content);

    // Merge with defaults
    return {
      WORKER_PORT: loaded.WORKER_PORT || DEFAULTS.WORKER_PORT,
      WORKER_HOST: loaded.WORKER_HOST || DEFAULTS.WORKER_HOST,
      AI_MODEL: loaded.AI_MODEL || DEFAULTS.AI_MODEL,
      AI_PROVIDER: loaded.AI_PROVIDER || DEFAULTS.AI_PROVIDER,
      LOG_LEVEL: loaded.LOG_LEVEL || DEFAULTS.LOG_LEVEL,
      CONTEXT_OBSERVATIONS: loaded.CONTEXT_OBSERVATIONS || DEFAULTS.CONTEXT_OBSERVATIONS,
      CONTEXT_SHOW_ROUTING: loaded.CONTEXT_SHOW_ROUTING || DEFAULTS.CONTEXT_SHOW_ROUTING,
      AUTO_SINK_ON_STOP: loaded.AUTO_SINK_ON_STOP || DEFAULTS.AUTO_SINK_ON_STOP,
      SKIP_TOOLS: loaded.SKIP_TOOLS || DEFAULTS.SKIP_TOOLS,
    };
  } catch {
    return {
      WORKER_PORT: DEFAULTS.WORKER_PORT,
      WORKER_HOST: DEFAULTS.WORKER_HOST,
      AI_MODEL: DEFAULTS.AI_MODEL,
      AI_PROVIDER: DEFAULTS.AI_PROVIDER,
      LOG_LEVEL: DEFAULTS.LOG_LEVEL,
      CONTEXT_OBSERVATIONS: DEFAULTS.CONTEXT_OBSERVATIONS,
      CONTEXT_SHOW_ROUTING: DEFAULTS.CONTEXT_SHOW_ROUTING,
      AUTO_SINK_ON_STOP: DEFAULTS.AUTO_SINK_ON_STOP,
      SKIP_TOOLS: DEFAULTS.SKIP_TOOLS,
    };
  }
}

export function saveSettings(settings: Partial<Settings>): void {
  const current = loadSettings();
  const updated = { ...current, ...settings };
  ensureDataDir();
  writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2));
}

export function getSetting(key: ConfigKey): string {
  const settings = loadSettings();
  return (settings as Record<string, string>)[key] || DEFAULTS[key];
}

export function getSettingInt(key: ConfigKey): number {
  return parseInt(getSetting(key), 10);
}

export function getSettingBool(key: ConfigKey): boolean {
  return getSetting(key).toLowerCase() === 'true';
}

// ============================================================================
// Utilities
// ============================================================================

export function ensureDataDir(): void {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const logsDir = getLogsDir();
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

export function getWorkerPort(): number {
  return parseInt(process.env.AI_ENTRANCE_WORKER_PORT || getSetting('WORKER_PORT'), 10);
}

export function getWorkerHost(): string {
  return process.env.AI_ENTRANCE_WORKER_HOST || getSetting('WORKER_HOST');
}

export function getSkipTools(): string[] {
  return getSetting('SKIP_TOOLS').split(',').map(s => s.trim());
}
