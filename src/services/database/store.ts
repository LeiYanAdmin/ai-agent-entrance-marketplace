/**
 * Database store for AI Agent Entrance
 */

import Database from 'better-sqlite3';
import { getDbPath, ensureDataDir } from '../../shared/config.js';
import { SCHEMA_VERSION, getMigrationSQL } from './schema.js';
import { logger } from '../../utils/logger.js';
import type {
  SessionRow,
  SessionInput,
  ObservationRow,
  ObservationInput,
  KnowledgeRow,
  KnowledgeInput,
  SessionSummaryRow,
} from '../../shared/types.js';

export class DatabaseStore {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || getDbPath();
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async initialize(): Promise<void> {
    ensureDataDir();

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    const version = this.getSchemaVersion();
    if (version < SCHEMA_VERSION) {
      logger.info('DATABASE', `Migrating from v${version} to v${SCHEMA_VERSION}`);
      const statements = getMigrationSQL(version, SCHEMA_VERSION);
      const migrate = this.db.transaction(() => {
        for (const sql of statements) {
          this.db!.exec(sql);
        }
      });
      migrate();
      logger.success('DATABASE', `Migration complete`);
    }

    logger.info('DATABASE', `Initialized at ${this.dbPath}`);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db!.prepare(
        `SELECT version FROM schema_version LIMIT 1`
      ).get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  // ============================================================================
  // Sessions
  // ============================================================================

  createSession(input: SessionInput): SessionRow {
    const db = this.getDb();
    const now = new Date();

    const stmt = db.prepare(`
      INSERT INTO sessions (
        session_id, project, user_prompt, detected_keywords,
        recommended_workflow, created_at, created_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `);

    stmt.run(
      input.session_id,
      input.project,
      input.user_prompt || null,
      input.detected_keywords ? JSON.stringify(input.detected_keywords) : null,
      input.recommended_workflow || null,
      now.toISOString(),
      now.getTime()
    );

    return this.getSession(input.session_id)!;
  }

  getSession(sessionId: string): SessionRow | null {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
    return stmt.get(sessionId) as SessionRow | null;
  }

  getOrCreateSession(sessionId: string, project: string): SessionRow {
    let session = this.getSession(sessionId);
    if (!session) {
      session = this.createSession({ session_id: sessionId, project });
    }
    return session;
  }

  updateSession(
    sessionId: string,
    updates: Partial<Pick<SessionRow, 'user_prompt' | 'detected_keywords' | 'recommended_workflow' | 'status' | 'completed_at'>>
  ): void {
    const db = this.getDb();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (updates.user_prompt !== undefined) {
      sets.push('user_prompt = ?');
      values.push(updates.user_prompt);
    }
    if (updates.detected_keywords !== undefined) {
      sets.push('detected_keywords = ?');
      values.push(updates.detected_keywords);
    }
    if (updates.recommended_workflow !== undefined) {
      sets.push('recommended_workflow = ?');
      values.push(updates.recommended_workflow);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      values.push(updates.status);
    }
    if (updates.completed_at !== undefined) {
      sets.push('completed_at = ?');
      values.push(updates.completed_at);
    }

    if (sets.length === 0) return;

    values.push(sessionId);
    const stmt = db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE session_id = ?`);
    stmt.run(...values);
  }

  getRecentSessions(project: string, limit: number = 10): SessionRow[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM sessions
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `);
    return stmt.all(project, limit) as SessionRow[];
  }

  // ============================================================================
  // Observations
  // ============================================================================

  createObservation(input: ObservationInput): ObservationRow {
    const db = this.getDb();
    const now = new Date();

    const stmt = db.prepare(`
      INSERT INTO observations (
        session_id, project, type, title, subtitle, facts,
        narrative, concepts, files_read, files_modified,
        tool_name, prompt_number, discovery_tokens, should_sink,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.session_id,
      input.project,
      input.type,
      input.title,
      input.subtitle || null,
      input.facts ? JSON.stringify(input.facts) : null,
      input.narrative || null,
      input.concepts ? JSON.stringify(input.concepts) : null,
      input.files_read ? JSON.stringify(input.files_read) : null,
      input.files_modified ? JSON.stringify(input.files_modified) : null,
      input.tool_name || null,
      input.prompt_number || null,
      input.discovery_tokens || 0,
      input.should_sink ? 1 : 0,
      now.toISOString(),
      now.getTime()
    );

    return this.getObservation(result.lastInsertRowid as number)!;
  }

  getObservation(id: number): ObservationRow | null {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM observations WHERE id = ?`);
    return stmt.get(id) as ObservationRow | null;
  }

  getSessionObservations(sessionId: string): ObservationRow[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM observations
      WHERE session_id = ?
      ORDER BY created_at_epoch ASC
    `);
    return stmt.all(sessionId) as ObservationRow[];
  }

  getRecentObservations(project: string, limit: number = 20): ObservationRow[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `);
    return stmt.all(project, limit) as ObservationRow[];
  }

  getSinkableObservations(project: string): ObservationRow[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM observations
      WHERE project = ? AND should_sink = 1
      ORDER BY created_at_epoch DESC
    `);
    return stmt.all(project) as ObservationRow[];
  }

  // ============================================================================
  // Knowledge
  // ============================================================================

  createKnowledge(input: KnowledgeInput): KnowledgeRow {
    const db = this.getDb();
    const now = new Date();

    const stmt = db.prepare(`
      INSERT INTO knowledge (
        session_id, observation_id, project, type, title, content,
        tags, file_path, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.session_id || null,
      input.observation_id || null,
      input.project,
      input.type,
      input.title,
      input.content,
      input.tags ? JSON.stringify(input.tags) : null,
      input.file_path || null,
      now.toISOString(),
      now.getTime()
    );

    return this.getKnowledge(result.lastInsertRowid as number)!;
  }

  getKnowledge(id: number): KnowledgeRow | null {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM knowledge WHERE id = ?`);
    return stmt.get(id) as KnowledgeRow | null;
  }

  getProjectKnowledge(project: string, type?: string): KnowledgeRow[] {
    const db = this.getDb();

    if (type) {
      const stmt = db.prepare(`
        SELECT * FROM knowledge
        WHERE project = ? AND type = ?
        ORDER BY created_at_epoch DESC
      `);
      return stmt.all(project, type) as KnowledgeRow[];
    }

    const stmt = db.prepare(`
      SELECT * FROM knowledge
      WHERE project = ?
      ORDER BY created_at_epoch DESC
    `);
    return stmt.all(project) as KnowledgeRow[];
  }

  getUnsyncedKnowledge(project?: string): KnowledgeRow[] {
    const db = this.getDb();

    if (project) {
      const stmt = db.prepare(`
        SELECT * FROM knowledge
        WHERE project = ? AND synced_at IS NULL
        ORDER BY created_at_epoch ASC
      `);
      return stmt.all(project) as KnowledgeRow[];
    }

    const stmt = db.prepare(`
      SELECT * FROM knowledge
      WHERE synced_at IS NULL
      ORDER BY created_at_epoch ASC
    `);
    return stmt.all() as KnowledgeRow[];
  }

  markKnowledgeSynced(id: number, filePath: string): void {
    const db = this.getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE knowledge
      SET synced_at = ?, file_path = ?
      WHERE id = ?
    `);
    stmt.run(now, filePath, id);
  }

  // ============================================================================
  // Session Summaries
  // ============================================================================

  createSummary(
    sessionId: string,
    project: string,
    summary: {
      request?: string;
      investigated?: string;
      learned?: string;
      completed?: string;
      next_steps?: string;
      files_read?: string[];
      files_edited?: string[];
      sinkable_knowledge?: number[];
    }
  ): SessionSummaryRow {
    const db = this.getDb();
    const now = new Date();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO session_summaries (
        session_id, project, request, investigated, learned, completed,
        next_steps, files_read, files_edited, sinkable_knowledge,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      project,
      summary.request || null,
      summary.investigated || null,
      summary.learned || null,
      summary.completed || null,
      summary.next_steps || null,
      summary.files_read ? JSON.stringify(summary.files_read) : null,
      summary.files_edited ? JSON.stringify(summary.files_edited) : null,
      summary.sinkable_knowledge ? JSON.stringify(summary.sinkable_knowledge) : null,
      now.toISOString(),
      now.getTime()
    );

    return this.getSummary(sessionId)!;
  }

  getSummary(sessionId: string): SessionSummaryRow | null {
    const db = this.getDb();
    const stmt = db.prepare(`SELECT * FROM session_summaries WHERE session_id = ?`);
    return stmt.get(sessionId) as SessionSummaryRow | null;
  }

  getRecentSummaries(project: string, limit: number = 5): SessionSummaryRow[] {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `);
    return stmt.all(project, limit) as SessionSummaryRow[];
  }
}

// Singleton instance
let storeInstance: DatabaseStore | null = null;

export function getStore(): DatabaseStore {
  if (!storeInstance) {
    storeInstance = new DatabaseStore();
  }
  return storeInstance;
}
