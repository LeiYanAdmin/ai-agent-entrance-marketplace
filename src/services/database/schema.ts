/**
 * Database schema and migrations for AI Agent Entrance
 */

export const SCHEMA_VERSION = 1;

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

    `INSERT OR REPLACE INTO schema_version (version) VALUES (${SCHEMA_VERSION})`,
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
