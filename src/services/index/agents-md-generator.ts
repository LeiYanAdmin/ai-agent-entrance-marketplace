/**
 * AGENTS.md Index Generator
 *
 * Generates compressed knowledge index for passive context injection.
 * Follows Vercel's agents.md approach: 80% compression, 100% retrieval performance.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import type { DatabaseStore } from '../database/store.js';
import type { KnowledgeAssetRow } from '../../shared/types.js';
import { getDataDir } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';

export class AgentsMdGenerator {
  constructor(private store: DatabaseStore) {}

  /**
   * Generate compressed index in pipe-delimited format
   *
   * Format: name|type|product_line|title|tags|promoted
   * Target: ~100 bytes per asset, ~10KB for 100 assets
   */
  generateIndex(): string {
    const assets = this.store.getAllKnowledgeAssets();

    const l1Count = assets.filter(a => !a.promoted).length;
    const l2Count = assets.filter(a => a.promoted).length;
    const timestamp = new Date().toISOString();

    const header = [
      '# AI Agent Entrance - Knowledge Index',
      '',
      `Last updated: ${timestamp}`,
      `Total assets: ${assets.length} (L1: ${l1Count}, L2: ${l2Count})`,
      '',
      '## Quick Reference',
      '',
      'Use `get_asset(name, product_line)` MCP tool to retrieve full content.',
      '',
      '## Three-Layer Retrieval Strategy',
      '',
      '**L0 (Index Scan) - ALWAYS FIRST:**',
      'Scan this index for matching name/title/tags.',
      '',
      '**Decision Point:** Evaluate L0 results',
      '- ✅ **1-2 exact matches** → Skip to L2 (get full content)',
      '- ⚠️ **3+ matches OR uncertain** → Use L1 for cross-validation',
      '- ❌ **0 matches** → Answer from general knowledge (note the gap)',
      '',
      '**L1 (Full-text Search) - ON-DEMAND VALIDATION:**',
      'When L0 returns multiple candidates, use `search_knowledge()` to:',
      '- Search full content (not just title/tags)',
      '- Get relevance scores + snippets',
      '- Validate which asset best matches the query',
      '',
      '**L2 (Detail Retrieval) - FINAL STEP:**',
      'Use `get_asset()` to retrieve full markdown content.',
      '- If L1 was used: prioritize by relevance score',
      '- If L1 was skipped: retrieve the exact match from L0',
      '',
      '## Index',
      '',
      'Format: `name|type|product_line|title|tags|promoted`',
      '',
      '<!-- INDEX_START -->',
    ];

    const indexLines = assets.map(asset => this.formatAssetLine(asset));

    const footer = [
      '<!-- INDEX_END -->',
      '',
      '## Usage Examples',
      '',
      '**Example 1: Exact match (skip L1)**',
      '```',
      'User: "Redis Sentinel 怎么配置？"',
      'L0 Scan → 1 match: redis-sentinel-setup',
      'Decision: Exact match, skip L1',
      'L2: get_asset("redis-sentinel-setup", "exchange/infra")',
      '```',
      '',
      '**Example 2: Multiple matches (use L1)**',
      '```',
      'User: "消息队列重试策略？"',
      'L0 Scan → 5 matches (kafka-*, rabbitmq-*, redis-*)',
      'Decision: Multiple matches, need validation',
      'L1: search_knowledge({query: "消息队列 重试"}) → rank by score',
      'L2: get_asset(top_result)',
      '```',
      '',
      '## Asset Types',
      '',
      '- **pitfall**: 踩坑记录 - 避免重复问题',
      '- **reference**: 参考文档 - 技术指南、API 规范',
      '- **pattern**: 设计模式 - 可复用解决方案',
      '- **best-practice**: 最佳实践 - 团队规范、代码风格',
      '- **glossary**: 术语定义 - 统一语言、业务概念',
      '- **adr**: 架构决策记录 - 设计历史、权衡分析',
      '- **discovery**: 发现笔记 - 临时记录，可转化为其他类型',
      '- **skill**: 工作流技能 - 纵向流程（由 Skills 显式调用）',
    ];

    return [...header, ...indexLines, ...footer].join('\n');
  }

  /**
   * Format a single asset as pipe-delimited line
   */
  private formatAssetLine(asset: KnowledgeAssetRow): string {
    const tags = asset.tags ? JSON.parse(asset.tags).join(',') : '';
    return `${asset.name}|${asset.type}|${asset.product_line}|${asset.title}|${tags}|${asset.promoted}`;
  }

  /**
   * Write index to ~/.ai-agent-entrance/AGENTS-INDEX.md
   */
  writeAgentsMd(): void {
    try {
      const content = this.generateIndex();
      const agentsMdPath = join(getDataDir(), 'AGENTS-INDEX.md');

      writeFileSync(agentsMdPath, content, 'utf-8');

      const sizeKB = (content.length / 1024).toFixed(2);
      logger.info('INDEX', `Updated AGENTS-INDEX.md at ${agentsMdPath} (${sizeKB} KB)`);
    } catch (error) {
      logger.error('INDEX', 'Failed to write AGENTS-INDEX.md', {}, error as Error);
      throw error;
    }
  }

  /**
   * Get index file path
   */
  getIndexPath(): string {
    return join(getDataDir(), 'AGENTS-INDEX.md');
  }

  /**
   * Get index stats
   */
  getIndexStats(): { totalAssets: number; l1Count: number; l2Count: number; sizeKB: number } {
    const assets = this.store.getAllKnowledgeAssets();
    const content = this.generateIndex();

    return {
      totalAssets: assets.length,
      l1Count: assets.filter(a => !a.promoted).length,
      l2Count: assets.filter(a => a.promoted).length,
      sizeKB: parseFloat((content.length / 1024).toFixed(2)),
    };
  }
}
