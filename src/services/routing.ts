/**
 * Intelligent routing service for AI Agent Entrance
 * Detects task type from user input and recommends appropriate workflow
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { getPluginRoot } from '../shared/config.js';
import type { TaskType, WorkflowType, RoutingResult, KeywordMatch } from '../shared/types.js';

// ============================================================================
// Keyword Definitions (inline defaults)
// ============================================================================

interface KeywordConfig {
  task_types: Record<string, { keywords: string[]; weight: number }>;
  product_lines: Record<string, { keywords: string[]; aliases: string[] }>;
  knowledge_triggers: {
    pitfall: string[];
    adr: string[];
    glossary: string[];
  };
}

const DEFAULT_KEYWORDS: KeywordConfig = {
  task_types: {
    'new-project': {
      keywords: ['新项目', '从零开始', '完整流程', 'new project', 'from scratch', 'greenfield'],
      weight: 3,
    },
    optimization: {
      keywords: ['优化', '重构', '改造', '迁移', 'optimize', 'refactor', 'migrate', 'legacy'],
      weight: 2,
    },
    'bug-fix': {
      keywords: ['bug', '修复', '问题', '错误', 'fix', 'error', 'issue', 'broken'],
      weight: 2,
    },
    feature: {
      keywords: ['功能', '特性', '添加', '实现', 'feature', 'add', 'implement', 'create'],
      weight: 1,
    },
    research: {
      keywords: ['调研', '分析', '评估', '了解', 'research', 'analyze', 'evaluate', 'understand'],
      weight: 1,
    },
  },
  product_lines: {
    exchange: {
      keywords: ['交易所', '撮合', '订单', '行情'],
      aliases: ['exchange', 'trading', 'matching'],
    },
    custody: {
      keywords: ['托管', '钱包', '签名', '密钥'],
      aliases: ['custody', 'wallet', 'signing'],
    },
    infra: {
      keywords: ['基础设施', '部署', 'devops', 'kubernetes'],
      aliases: ['infrastructure', 'platform'],
    },
  },
  knowledge_triggers: {
    pitfall: ['踩坑', '坑', '注意', '小心', '原来是', '居然是', '没想到'],
    adr: ['决定用', '选择', '方案', '架构', '设计', '权衡'],
    glossary: ['是什么', '什么是', '定义', '术语', '概念'],
  },
};

// ============================================================================
// Workflow Mapping
// ============================================================================

const WORKFLOW_MAPPING: Record<TaskType, WorkflowType> = {
  'new-project': 'bmad',
  optimization: 'openspec',
  refactor: 'superpowers',
  'bug-fix': 'plan',
  feature: 'superpowers',
  research: 'plan',
  unknown: 'plan',
};

const WORKFLOW_INSTALL_COMMANDS: Record<WorkflowType, string | null> = {
  superpowers: 'claude plugin install superpowers',
  bmad: 'npx bmad-method install',
  openspec: 'claude plugin install openspec',
  speckit: 'claude plugin install speckit',
  plan: null, // Built-in
  ralph: 'claude plugin install ralph',
};

// ============================================================================
// Routing Service
// ============================================================================

export class RoutingService {
  private keywords: KeywordConfig;

  constructor() {
    this.keywords = this.loadKeywords();
  }

  private loadKeywords(): KeywordConfig {
    try {
      const configPath = join(getPluginRoot(), 'config', 'biz-keywords.yaml');
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf-8');
        const loaded = parseYaml(content) as Record<string, unknown>;

        // Validate structure - must have task_types
        if (loaded.task_types && typeof loaded.task_types === 'object') {
          return loaded as KeywordConfig;
        }

        // The YAML has a different structure, use defaults
        console.error('[routing] biz-keywords.yaml has unexpected structure, using defaults');
      }
    } catch (err) {
      console.error('[routing] Failed to load biz-keywords.yaml:', err);
    }
    return DEFAULT_KEYWORDS;
  }

  /**
   * Analyze user input and determine routing
   */
  analyze(input: string, installedTools: string[] = []): RoutingResult {
    const normalizedInput = input.toLowerCase();

    // Detect keywords
    const matches = this.detectKeywords(normalizedInput);

    // Determine task type
    const taskType = this.determineTaskType(matches);

    // Get product line (optional)
    const productLine = this.detectProductLine(normalizedInput);

    // Get recommended workflow
    let workflow = WORKFLOW_MAPPING[taskType];

    // Check if superpowers is installed and should take over
    if (installedTools.includes('superpowers') && taskType !== 'research') {
      workflow = 'superpowers';
    }

    // Determine which tools are missing
    const missingTools = this.getMissingTools(workflow, installedTools);

    // Generate reason
    const reason = this.generateReason(taskType, workflow, matches);

    return {
      keywords: matches.map(m => m.keyword),
      task_type: taskType,
      product_line: productLine,
      recommended_workflow: workflow,
      reason,
      installed_tools: installedTools,
      missing_tools: missingTools,
    };
  }

  private detectKeywords(input: string): KeywordMatch[] {
    const matches: KeywordMatch[] = [];

    if (!this.keywords?.task_types) {
      console.error('[routing] task_types not found in keywords config');
      return matches;
    }

    for (const [category, config] of Object.entries(this.keywords.task_types)) {
      if (!config?.keywords || !Array.isArray(config.keywords)) {
        console.error(`[routing] Invalid config for category ${category}:`, config);
        continue;
      }

      for (const keyword of config.keywords) {
        if (input.includes(keyword.toLowerCase())) {
          matches.push({
            keyword,
            category,
            weight: config.weight || 1,
          });
        }
      }
    }

    return matches;
  }

  private determineTaskType(matches: KeywordMatch[]): TaskType {
    if (matches.length === 0) {
      return 'unknown';
    }

    // Score by weight
    const scores: Record<string, number> = {};
    for (const match of matches) {
      scores[match.category] = (scores[match.category] || 0) + match.weight;
    }

    // Get highest scoring type
    let maxScore = 0;
    let maxType: TaskType = 'unknown';
    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        maxType = type as TaskType;
      }
    }

    return maxType;
  }

  private detectProductLine(input: string): string | undefined {
    if (!this.keywords?.product_lines) {
      return undefined;
    }

    for (const [line, config] of Object.entries(this.keywords.product_lines)) {
      if (!config) continue;

      const keywords = config.keywords || [];
      const aliases = config.aliases || [];
      const allKeywords = [...keywords, ...aliases];

      for (const keyword of allKeywords) {
        if (input.includes(keyword.toLowerCase())) {
          return line;
        }
      }
    }
    return undefined;
  }

  private getMissingTools(workflow: WorkflowType, installed: string[]): string[] {
    const installCmd = WORKFLOW_INSTALL_COMMANDS[workflow];
    if (!installCmd) return [];

    // Extract tool name from install command
    const toolName = workflow;
    if (installed.includes(toolName)) return [];

    return [installCmd];
  }

  private generateReason(
    taskType: TaskType,
    workflow: WorkflowType,
    matches: KeywordMatch[]
  ): string {
    const keywordList = matches.map(m => m.keyword).join(', ');

    const reasons: Record<TaskType, string> = {
      'new-project': `检测到新项目关键字 (${keywordList})，推荐使用 BMAD 完整流程`,
      optimization: `检测到优化/重构关键字 (${keywordList})，推荐使用 OpenSpec 变更隔离模式`,
      refactor: `检测到重构关键字 (${keywordList})，推荐使用 Superpowers SDD+TDD 流程`,
      'bug-fix': `检测到 bug 修复关键字 (${keywordList})，推荐使用 Plan 模式快速定位`,
      feature: `检测到功能开发关键字 (${keywordList})，推荐使用 Superpowers SDD+TDD`,
      research: `检测到调研关键字 (${keywordList})，推荐使用 Plan 模式分析`,
      unknown: '未检测到明确的任务类型，使用默认 Plan 模式',
    };

    return reasons[taskType];
  }

  /**
   * Detect knowledge sinking triggers
   */
  detectKnowledgeTriggers(input: string): { type: string; keyword: string }[] {
    const normalizedInput = input.toLowerCase();
    const triggers: { type: string; keyword: string }[] = [];

    for (const [type, keywords] of Object.entries(this.keywords.knowledge_triggers)) {
      for (const keyword of keywords) {
        if (normalizedInput.includes(keyword.toLowerCase())) {
          triggers.push({ type, keyword });
        }
      }
    }

    return triggers;
  }

  /**
   * Get installed tools by checking common locations
   */
  static async getInstalledTools(): Promise<string[]> {
    const tools: string[] = [];
    const { execSync } = await import('child_process');

    // Check for common plugins
    const pluginsToCheck = ['superpowers', 'compound-engineering', 'openspec', 'speckit', 'bmad'];

    for (const plugin of pluginsToCheck) {
      try {
        // Try to list installed plugins
        const result = execSync('claude plugin list 2>/dev/null || echo ""', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        if (result.includes(plugin)) {
          tools.push(plugin);
        }
      } catch {
        // Plugin check failed, skip
      }
    }

    return tools;
  }
}

// Singleton
let routingInstance: RoutingService | null = null;

export function getRoutingService(): RoutingService {
  if (!routingInstance) {
    routingInstance = new RoutingService();
  }
  return routingInstance;
}
