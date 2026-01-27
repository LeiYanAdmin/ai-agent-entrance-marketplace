/**
 * Index generator for L2 knowledge repository
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { MarkdownParser } from './markdown-parser.js';
import { GitOperations } from './git-operations.js';
import type { L2Index, L2IndexEntry } from '../../shared/types.js';
import { logger } from '../../utils/logger.js';

export class IndexGenerator {
  /**
   * Generate index by walking L2 repo and parsing frontmatter
   */
  static generate(git: GitOperations): L2Index {
    const files = git.listMarkdownFiles('knowledge');
    const entries: L2IndexEntry[] = [];
    const byType: Record<string, number> = {};
    const byProductLine: Record<string, number> = {};

    for (const filePath of files) {
      const content = git.readFile(filePath);
      if (!content) continue;

      const { frontmatter } = MarkdownParser.parse(content);
      if (!frontmatter || !frontmatter.type || !frontmatter.name) continue;

      const entry: L2IndexEntry = {
        path: filePath,
        type: frontmatter.type,
        name: frontmatter.name,
        product_line: frontmatter.product_line || 'general',
        title: frontmatter.title || frontmatter.name,
        tags: frontmatter.tags || [],
        updated: frontmatter.updated || '',
      };

      entries.push(entry);
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byProductLine[entry.product_line] = (byProductLine[entry.product_line] || 0) + 1;
    }

    return {
      version: '2.1.0',
      generated_at: new Date().toISOString(),
      total: entries.length,
      by_type: byType,
      by_product_line: byProductLine,
      entries,
    };
  }

  /**
   * Write index to L2 repo
   */
  static writeIndex(git: GitOperations, index: L2Index): void {
    const indexPath = 'knowledge/_index.json';
    git.writeFile(indexPath, JSON.stringify(index, null, 2));
    logger.info('INDEX', `Written index with ${index.total} entries`);
  }

  /**
   * Read existing index from L2 repo
   */
  static readIndex(git: GitOperations): L2Index | null {
    const content = git.readFile('knowledge/_index.json');
    if (!content) return null;

    try {
      return JSON.parse(content) as L2Index;
    } catch {
      return null;
    }
  }

  /**
   * Format index as a human-readable summary for context injection
   */
  static formatSummary(index: L2Index): string {
    const lines: string[] = [];
    lines.push(`知识库共 ${index.total} 条资产`);

    if (Object.keys(index.by_product_line).length > 0) {
      const plParts = Object.entries(index.by_product_line)
        .map(([pl, count]) => `${pl}(${count})`)
        .join(', ');
      lines.push(`产品线: ${plParts}`);
    }

    if (Object.keys(index.by_type).length > 0) {
      const typeParts = Object.entries(index.by_type)
        .map(([type, count]) => `${type}(${count})`)
        .join(', ');
      lines.push(`类型: ${typeParts}`);
    }

    return lines.join('。');
  }
}
