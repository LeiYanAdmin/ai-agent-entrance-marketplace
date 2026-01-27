/**
 * Database schema and migrations for AI Agent Entrance
 */

export const SCHEMA_VERSION = 2;

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    // Sessions table
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      user_prompt TEXT,
      detected_keywords TEXT,
      recommended_workflow TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      completed_at TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed'))
    )`,

    // Index for sessions
    `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at_epoch DESC)`,

    // Observations table
    `CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'pitfall', 'change')),
      title TEXT NOT NULL,
      subtitle TEXT,
      facts TEXT,
      narrative TEXT,
      concepts TEXT,
      files_read TEXT,
      files_modified TEXT,
      tool_name TEXT,
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      should_sink INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    )`,

    // Indexes for observations
    `CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project)`,
    `CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type)`,
    `CREATE INDEX IF NOT EXISTS idx_observations_should_sink ON observations(should_sink)`,
    `CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at_epoch DESC)`,

    // FTS5 virtual table for observations full-text search
    `CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      title,
      subtitle,
      facts,
      narrative,
      concepts,
      content='observations',
      content_rowid='id'
    )`,

    // Triggers to keep FTS in sync
    `CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, subtitle, facts, narrative, concepts)
      VALUES (new.id, new.title, new.subtitle, new.facts, new.narrative, new.concepts);
    END`,

    `CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, facts, narrative, concepts)
      VALUES ('delete', old.id, old.title, old.subtitle, old.facts, old.narrative, old.concepts);
    END`,

    `CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, facts, narrative, concepts)
      VALUES ('delete', old.id, old.title, old.subtitle, old.facts, old.narrative, old.concepts);
      INSERT INTO observations_fts(rowid, title, subtitle, facts, narrative, concepts)
      VALUES (new.id, new.title, new.subtitle, new.facts, new.narrative, new.concepts);
    END`,

    // Knowledge table (sunk knowledge)
    `CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      observation_id INTEGER,
      project TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('pitfall', 'adr', 'glossary', 'best-practice', 'pattern', 'discovery')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      file_path TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id),
      FOREIGN KEY (observation_id) REFERENCES observations(id)
    )`,

    // Indexes for knowledge
    `CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge(project)`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type)`,
    `CREATE INDEX IF NOT EXISTS idx_knowledge_synced ON knowledge(synced_at)`,

    // FTS5 for knowledge
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      title,
      content,
      tags,
      content='knowledge',
      content_rowid='id'
    )`,

    // Knowledge FTS triggers
    `CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(rowid, title, content, tags)
      VALUES (new.id, new.title, new.content, new.tags);
    END`,

    `CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
      VALUES ('delete', old.id, old.title, old.content, old.tags);
    END`,

    `CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, title, content, tags)
      VALUES ('delete', old.id, old.title, old.content, old.tags);
      INSERT INTO knowledge_fts(rowid, title, content, tags)
      VALUES (new.id, new.title, new.content, new.tags);
    END`,

    // Session summaries table
    `CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      request TEXT,
      investigated TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      files_read TEXT,
      files_edited TEXT,
      sinkable_knowledge TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    )`,

    // Schema version table
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )`,

    `INSERT OR REPLACE INTO schema_version (version) VALUES (1)`,
  ],

  2: [
    // Knowledge Assets table (L1 cache)
    `CREATE TABLE IF NOT EXISTS knowledge_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('pitfall', 'adr', 'glossary', 'best-practice', 'pattern', 'discovery', 'skill', 'reference')),
      name TEXT NOT NULL,
      product_line TEXT NOT NULL DEFAULT 'general',
      tags TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_project TEXT,
      l2_path TEXT,
      promoted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_at_epoch INTEGER NOT NULL,
      UNIQUE(name, product_line)
    )`,

    // Indexes for knowledge_assets
    `CREATE INDEX IF NOT EXISTS idx_ka_type ON knowledge_assets(type)`,
    `CREATE INDEX IF NOT EXISTS idx_ka_product_line ON knowledge_assets(product_line)`,
    `CREATE INDEX IF NOT EXISTS idx_ka_promoted ON knowledge_assets(promoted)`,
    `CREATE INDEX IF NOT EXISTS idx_ka_name ON knowledge_assets(name)`,
    `CREATE INDEX IF NOT EXISTS idx_ka_l2_path ON knowledge_assets(l2_path)`,
    `CREATE INDEX IF NOT EXISTS idx_ka_updated ON knowledge_assets(updated_at_epoch DESC)`,

    // FTS5 for knowledge_assets
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_assets_fts USING fts5(
      name,
      title,
      content,
      tags,
      product_line,
      content='knowledge_assets',
      content_rowid='id'
    )`,

    // Knowledge Assets FTS triggers
    `CREATE TRIGGER IF NOT EXISTS ka_fts_ai AFTER INSERT ON knowledge_assets BEGIN
      INSERT INTO knowledge_assets_fts(rowid, name, title, content, tags, product_line)
      VALUES (new.id, new.name, new.title, new.content, new.tags, new.product_line);
    END`,

    `CREATE TRIGGER IF NOT EXISTS ka_fts_ad AFTER DELETE ON knowledge_assets BEGIN
      INSERT INTO knowledge_assets_fts(knowledge_assets_fts, rowid, name, title, content, tags, product_line)
      VALUES ('delete', old.id, old.name, old.title, old.content, old.tags, old.product_line);
    END`,

    `CREATE TRIGGER IF NOT EXISTS ka_fts_au AFTER UPDATE ON knowledge_assets BEGIN
      INSERT INTO knowledge_assets_fts(knowledge_assets_fts, rowid, name, title, content, tags, product_line)
      VALUES ('delete', old.id, old.name, old.title, old.content, old.tags, old.product_line);
      INSERT INTO knowledge_assets_fts(rowid, name, title, content, tags, product_line)
      VALUES (new.id, new.name, new.title, new.content, new.tags, new.product_line);
    END`,

    // Sync log table
    `CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL CHECK(direction IN ('pull', 'push', 'both')),
      file_path TEXT,
      git_commit_sha TEXT,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'skipped')),
      message TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_sync_log_direction ON sync_log(direction)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status)`,
    `CREATE INDEX IF NOT EXISTS idx_sync_log_created ON sync_log(created_at_epoch DESC)`,

    // Config key-value table
    `CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,

    // Migrate existing knowledge rows → knowledge_assets
    `INSERT OR IGNORE INTO knowledge_assets (type, name, product_line, tags, title, content, source_project, l2_path, promoted, created_at, created_at_epoch, updated_at, updated_at_epoch)
     SELECT
       type,
       'legacy-' || id,
       COALESCE(project, 'general'),
       tags,
       title,
       content,
       project,
       file_path,
       CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END,
       created_at,
       created_at_epoch,
       COALESCE(synced_at, created_at),
       created_at_epoch
     FROM knowledge`,

    // Update schema version
    `UPDATE schema_version SET version = 2`,
  ],
};

export function getMigrationSQL(fromVersion: number, toVersion: number): string[] {
  const statements: string[] = [];
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    if (MIGRATIONS[v]) {
      statements.push(...MIGRATIONS[v]);
    }
  }
  return statements;
}
