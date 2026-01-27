/**
 * Full-text search service for AI Agent Entrance
 */

import Database from 'better-sqlite3';
import { getDbPath } from '../../shared/config.js';
import type {
  ObservationRow,
  KnowledgeRow,
  KnowledgeAssetRow,
  KnowledgeAssetType,
  SearchOptions,
  SearchResult,
} from '../../shared/types.js';

export class SearchService {
  private db: Database.Database | null = null;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || getDbPath(), { readonly: true });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('Search service not initialized');
    }
    return this.db;
  }

  // ============================================================================
  // Observation Search
  // ============================================================================

  searchObservations(
    query: string,
    options: SearchOptions = {}
  ): SearchResult<ObservationRow & { rank?: number }> {
    const db = this.getDb();
    const { project, type, limit = 20, offset = 0, orderBy = 'relevance' } = options;

    // Build WHERE clauses
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (project) {
      whereClauses.push('o.project = ?');
      params.push(project);
    }

    if (type) {
      if (Array.isArray(type)) {
        whereClauses.push(`o.type IN (${type.map(() => '?').join(', ')})`);
        params.push(...type);
      } else {
        whereClauses.push('o.type = ?');
        params.push(type);
      }
    }

    // FTS5 search
    const whereSQL = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

    const orderSQL =
      orderBy === 'relevance'
        ? 'ORDER BY rank'
        : orderBy === 'date_desc'
        ? 'ORDER BY o.created_at_epoch DESC'
        : 'ORDER BY o.created_at_epoch ASC';

    const sql = `
      SELECT o.*, fts.rank
      FROM observations o
      JOIN observations_fts fts ON o.id = fts.rowid
      WHERE observations_fts MATCH ?
      ${whereSQL}
      ${orderSQL}
      LIMIT ? OFFSET ?
    `;

    params.unshift(query);
    params.push(limit + 1, offset);

    const rows = db.prepare(sql).all(...params) as (ObservationRow & { rank: number })[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // Get total count
    const countSQL = `
      SELECT COUNT(*) as total
      FROM observations o
      JOIN observations_fts fts ON o.id = fts.rowid
      WHERE observations_fts MATCH ?
      ${whereSQL}
    `;

    const countParams = [query, ...params.slice(1, -2)];
    const { total } = db.prepare(countSQL).get(...countParams) as { total: number };

    return { items, total, hasMore };
  }

  // ============================================================================
  // Knowledge Search
  // ============================================================================

  searchKnowledge(
    query: string,
    options: SearchOptions = {}
  ): SearchResult<KnowledgeRow & { rank?: number }> {
    const db = this.getDb();
    const { project, limit = 20, offset = 0, orderBy = 'relevance' } = options;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (project) {
      whereClauses.push('k.project = ?');
      params.push(project);
    }

    const whereSQL = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

    const orderSQL =
      orderBy === 'relevance'
        ? 'ORDER BY rank'
        : orderBy === 'date_desc'
        ? 'ORDER BY k.created_at_epoch DESC'
        : 'ORDER BY k.created_at_epoch ASC';

    const sql = `
      SELECT k.*, fts.rank
      FROM knowledge k
      JOIN knowledge_fts fts ON k.id = fts.rowid
      WHERE knowledge_fts MATCH ?
      ${whereSQL}
      ${orderSQL}
      LIMIT ? OFFSET ?
    `;

    params.unshift(query);
    params.push(limit + 1, offset);

    const rows = db.prepare(sql).all(...params) as (KnowledgeRow & { rank: number })[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const countSQL = `
      SELECT COUNT(*) as total
      FROM knowledge k
      JOIN knowledge_fts fts ON k.id = fts.rowid
      WHERE knowledge_fts MATCH ?
      ${whereSQL}
    `;

    const countParams = [query, ...params.slice(1, -2)];
    const { total } = db.prepare(countSQL).get(...countParams) as { total: number };

    return { items, total, hasMore };
  }

  // ============================================================================
  // Combined Search (for context injection)
  // ============================================================================

  getRelevantContext(
    project: string,
    query?: string,
    limit: number = 10
  ): { observations: ObservationRow[]; knowledge: KnowledgeRow[] } {
    const db = this.getDb();

    if (query) {
      // Search with FTS
      const obsResult = this.searchObservations(query, { project, limit });
      const knowResult = this.searchKnowledge(query, { project, limit });

      return {
        observations: obsResult.items,
        knowledge: knowResult.items,
      };
    }

    // No query - get recent items
    const observations = db
      .prepare(
        `
      SELECT * FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `
      )
      .all(project, limit) as ObservationRow[];

    const knowledge = db
      .prepare(
        `
      SELECT * FROM knowledge
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `
      )
      .all(project, limit) as KnowledgeRow[];

    return { observations, knowledge };
  }

  // ============================================================================
  // Index Stats
  // ============================================================================

  // ============================================================================
  // Knowledge Asset Search
  // ============================================================================

  searchKnowledgeAssets(
    query: string,
    options: {
      product_line?: string;
      type?: KnowledgeAssetType;
      limit?: number;
      offset?: number;
      orderBy?: 'relevance' | 'date_desc' | 'date_asc';
    } = {}
  ): SearchResult<KnowledgeAssetRow & { rank?: number }> {
    const db = this.getDb();
    const { product_line, type, limit = 20, offset = 0, orderBy = 'relevance' } = options;

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (product_line) {
      whereClauses.push('ka.product_line = ?');
      params.push(product_line);
    }
    if (type) {
      whereClauses.push('ka.type = ?');
      params.push(type);
    }

    const whereSQL = whereClauses.length > 0 ? `AND ${whereClauses.join(' AND ')}` : '';

    const orderSQL =
      orderBy === 'relevance'
        ? 'ORDER BY rank'
        : orderBy === 'date_desc'
        ? 'ORDER BY ka.updated_at_epoch DESC'
        : 'ORDER BY ka.updated_at_epoch ASC';

    const sql = `
      SELECT ka.*, fts.rank
      FROM knowledge_assets ka
      JOIN knowledge_assets_fts fts ON ka.id = fts.rowid
      WHERE knowledge_assets_fts MATCH ?
      ${whereSQL}
      ${orderSQL}
      LIMIT ? OFFSET ?
    `;

    params.unshift(query);
    params.push(limit + 1, offset);

    const rows = db.prepare(sql).all(...params) as (KnowledgeAssetRow & { rank: number })[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const countSQL = `
      SELECT COUNT(*) as total
      FROM knowledge_assets ka
      JOIN knowledge_assets_fts fts ON ka.id = fts.rowid
      WHERE knowledge_assets_fts MATCH ?
      ${whereSQL}
    `;
    const countParams = [query, ...params.slice(1, -2)];
    const { total } = db.prepare(countSQL).get(...countParams) as { total: number };

    return { items, total, hasMore };
  }

  getAssetStats(productLine?: string): {
    total: number;
    by_type: Record<string, number>;
    by_product_line: Record<string, number>;
    promoted: number;
    unpromoted: number;
  } {
    const db = this.getDb();

    const plFilter = productLine ? ' WHERE product_line = ?' : '';
    const plParams = productLine ? [productLine] : [];

    const total = (
      db.prepare(`SELECT COUNT(*) as count FROM knowledge_assets${plFilter}`).get(...plParams) as { count: number }
    ).count;

    const promoted = (
      db.prepare(`SELECT COUNT(*) as count FROM knowledge_assets WHERE promoted = 1${productLine ? ' AND product_line = ?' : ''}`).get(...plParams) as { count: number }
    ).count;

    // By type
    const typeRows = db
      .prepare(`SELECT type, COUNT(*) as count FROM knowledge_assets${plFilter} GROUP BY type`)
      .all(...plParams) as { type: string; count: number }[];
    const by_type: Record<string, number> = {};
    for (const row of typeRows) {
      by_type[row.type] = row.count;
    }

    // By product_line
    const plRows = db
      .prepare(`SELECT product_line, COUNT(*) as count FROM knowledge_assets${plFilter} GROUP BY product_line`)
      .all(...plParams) as { product_line: string; count: number }[];
    const by_product_line: Record<string, number> = {};
    for (const row of plRows) {
      by_product_line[row.product_line] = row.count;
    }

    return { total, by_type, by_product_line, promoted, unpromoted: total - promoted };
  }

  listAssets(filters?: {
    type?: KnowledgeAssetType;
    product_line?: string;
    promoted?: boolean;
    limit?: number;
    offset?: number;
  }): SearchResult<KnowledgeAssetRow> {
    const db = this.getDb();
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters?.type) {
      where.push('type = ?');
      params.push(filters.type);
    }
    if (filters?.product_line) {
      where.push('product_line = ?');
      params.push(filters.product_line);
    }
    if (filters?.promoted !== undefined) {
      where.push('promoted = ?');
      params.push(filters.promoted ? 1 : 0);
    }

    const whereSQL = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const countSQL = `SELECT COUNT(*) as total FROM knowledge_assets ${whereSQL}`;
    const { total } = db.prepare(countSQL).get(...params) as { total: number };

    const sql = `
      SELECT * FROM knowledge_assets
      ${whereSQL}
      ORDER BY updated_at_epoch DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit + 1, offset);

    const rows = db.prepare(sql).all(...params) as KnowledgeAssetRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return { items, total, hasMore };
  }

  // ============================================================================
  // Index Stats
  // ============================================================================

  getStats(project?: string): {
    observations: number;
    knowledge: number;
    sessions: number;
  } {
    const db = this.getDb();

    if (project) {
      const obs = db
        .prepare(`SELECT COUNT(*) as count FROM observations WHERE project = ?`)
        .get(project) as { count: number };
      const know = db
        .prepare(`SELECT COUNT(*) as count FROM knowledge WHERE project = ?`)
        .get(project) as { count: number };
      const sess = db
        .prepare(`SELECT COUNT(*) as count FROM sessions WHERE project = ?`)
        .get(project) as { count: number };

      return {
        observations: obs.count,
        knowledge: know.count,
        sessions: sess.count,
      };
    }

    const obs = db.prepare(`SELECT COUNT(*) as count FROM observations`).get() as { count: number };
    const know = db.prepare(`SELECT COUNT(*) as count FROM knowledge`).get() as { count: number };
    const sess = db.prepare(`SELECT COUNT(*) as count FROM sessions`).get() as { count: number };

    return {
      observations: obs.count,
      knowledge: know.count,
      sessions: sess.count,
    };
  }
}
