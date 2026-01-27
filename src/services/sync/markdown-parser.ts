/**
 * Markdown parser for L2 knowledge files with YAML frontmatter
 */

import type {
  MarkdownFrontmatter,
  KnowledgeAssetInput,
  KnowledgeAssetType,
} from '../../shared/types.js';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export class MarkdownParser {
  /**
   * Parse a markdown file with YAML frontmatter
   */
  static parse(content: string): { frontmatter: MarkdownFrontmatter | null; body: string } {
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) {
      return { frontmatter: null, body: content };
    }

    const yamlStr = match[1];
    const body = match[2].trim();

    try {
      const frontmatter = MarkdownParser.parseYamlSimple(yamlStr);
      return { frontmatter: frontmatter as MarkdownFrontmatter, body };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  /**
   * Serialize frontmatter + body back to markdown
   */
  static serialize(frontmatter: MarkdownFrontmatter, body: string): string {
    const yamlLines: string[] = [];
    yamlLines.push(`type: ${frontmatter.type}`);
    yamlLines.push(`name: ${frontmatter.name}`);
    yamlLines.push(`product_line: ${frontmatter.product_line}`);
    yamlLines.push(`title: "${frontmatter.title.replace(/"/g, '\\"')}"`);
    if (frontmatter.tags && frontmatter.tags.length > 0) {
      yamlLines.push(`tags: [${frontmatter.tags.map(t => `"${t}"`).join(', ')}]`);
    }
    yamlLines.push(`created: ${frontmatter.created}`);
    yamlLines.push(`updated: ${frontmatter.updated}`);
    if (frontmatter.source_project) {
      yamlLines.push(`source_project: ${frontmatter.source_project}`);
    }

    return `---\n${yamlLines.join('\n')}\n---\n\n${body}\n`;
  }

  /**
   * Convert L2 markdown file to KnowledgeAssetInput
   */
  static toAssetInput(path: string, content: string): KnowledgeAssetInput | null {
    const { frontmatter, body } = MarkdownParser.parse(content);
    if (!frontmatter || !frontmatter.type || !frontmatter.name) {
      return null;
    }

    return {
      type: frontmatter.type as KnowledgeAssetType,
      name: frontmatter.name,
      product_line: frontmatter.product_line || 'general',
      tags: frontmatter.tags || [],
      title: frontmatter.title || frontmatter.name,
      content: body,
      source_project: frontmatter.source_project,
      l2_path: path,
    };
  }

  /**
   * Convert KnowledgeAssetInput to L2 markdown content
   */
  static fromAssetInput(asset: KnowledgeAssetInput, author?: string): string {
    const now = new Date().toISOString();
    const frontmatter: MarkdownFrontmatter = {
      type: asset.type,
      name: asset.name,
      product_line: asset.product_line,
      title: asset.title,
      tags: asset.tags || [],
      created: now,
      updated: now,
      source_project: asset.source_project,
    };
    return MarkdownParser.serialize(frontmatter, asset.content);
  }

  /**
   * Determine L2 file path for an asset based on its type and product_line
   */
  static getL2Path(asset: KnowledgeAssetInput): string {
    const productDir = asset.product_line.replace(/\./g, '/');
    return `knowledge/${productDir}/${asset.name}.md`;
  }

  /**
   * Simple YAML parser for frontmatter (handles flat key-value + arrays)
   */
  private static parseYamlSimple(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      let value: string | string[] = trimmed.slice(colonIdx + 1).trim();

      // Handle quoted strings
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Handle inline arrays [a, b, c]
      else if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1);
        value = inner.split(',').map(s => {
          s = s.trim();
          if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            return s.slice(1, -1);
          }
          return s;
        }).filter(s => s.length > 0);
      }

      result[key] = value;
    }

    return result;
  }
}
