/**
 * AI-powered semantic compression for observations
 *
 * 优雅降级：当 API 不可用时（无 Key、额度不足、网络问题），
 * 自动跳过压缩功能，不影响插件其他功能。
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSetting, getSettingBool } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';
import type { CompressionResult, SummaryResult, KnowledgeInput } from '../../shared/types.js';

// API 不可用的原因
type DisabledReason =
  | 'no_api_key'           // 未设置 ANTHROPIC_API_KEY
  | 'credit_exhausted'     // API 额度耗尽
  | 'invalid_api_key'      // API Key 无效
  | 'config_disabled'      // 配置禁用
  | 'rate_limited'         // 速率限制
  | 'unknown_error';       // 其他错误

// ============================================================================
// Prompts
// ============================================================================

const COMPRESSION_PROMPT = `You are a knowledge extraction expert. Analyze the following tool call result and extract reusable knowledge.

<tool_call>
Tool: {tool_name}
Input: {tool_input}
Output (truncated to 2000 chars): {tool_output}
Project: {project}
</tool_call>

Output a JSON object with this structure:
{
  "type": "decision|bugfix|feature|refactor|discovery|pitfall|change",
  "title": "Short title (under 10 words)",
  "subtitle": "Context description (under 20 words)",
  "facts": ["Key fact 1", "Key fact 2"],
  "narrative": "Complete description (under 50 words)",
  "concepts": ["concept_tag_1", "concept_tag_2"],
  "files_modified": ["path/to/file.ts"],
  "should_store": true/false,
  "knowledge_type": "pitfall|adr|glossary|best-practice|pattern|discovery" (optional, only if should_store is true)
}

Rules:
1. Only extract knowledge with long-term value
2. Ignore temporary operations (simple ls, cat of single files, etc.)
3. Focus on: architecture decisions, gotchas/pitfalls, best practices, term definitions
4. Set should_store=true only for genuinely reusable knowledge
5. Keep responses concise

Respond with ONLY the JSON object, no markdown or explanation.`;

const SUMMARY_PROMPT = `Analyze this conversation session and generate a summary.

<session>
Project: {project}
User Request: {user_prompt}
Observations:
{observations}
</session>

Output a JSON object:
{
  "request": "What the user asked for",
  "investigated": "What was explored/analyzed",
  "learned": "Key learnings and discoveries",
  "completed": "What was accomplished",
  "next_steps": "Suggested follow-up actions",
  "sinkable_knowledge": [
    {
      "type": "pitfall|adr|glossary|best-practice|pattern|discovery",
      "title": "Knowledge title",
      "content": "Detailed knowledge content",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Rules:
1. Be concise but comprehensive
2. Focus on actionable insights
3. Only include sinkable_knowledge for truly reusable learnings
4. Each sinkable item should be self-contained and understandable without context

Respond with ONLY the JSON object, no markdown or explanation.`;

// ============================================================================
// Compressor Service
// ============================================================================

export class CompressorService {
  private client: Anthropic | null = null;
  private model: string;

  // 优雅降级状态
  private aiEnabled: boolean = true;
  private disabledReason: DisabledReason | null = null;
  private warningLogged: boolean = false;

  constructor() {
    this.model = getSetting('AI_MODEL');

    // 检查是否通过配置禁用
    if (!getSettingBool('AI_COMPRESSION_ENABLED')) {
      this.disableAI('config_disabled');
    }

    // 检查 API Key 是否存在
    if (!process.env.ANTHROPIC_API_KEY) {
      this.disableAI('no_api_key');
    }
  }

  /**
   * 检查 AI 压缩是否可用
   */
  isEnabled(): boolean {
    return this.aiEnabled;
  }

  /**
   * 获取禁用原因
   */
  getDisabledReason(): DisabledReason | null {
    return this.disabledReason;
  }

  /**
   * 禁用 AI 功能（优雅降级）
   */
  private disableAI(reason: DisabledReason): void {
    if (this.aiEnabled) {
      this.aiEnabled = false;
      this.disabledReason = reason;

      // 只记录一次警告
      if (!this.warningLogged) {
        this.warningLogged = true;
        const messages: Record<DisabledReason, string> = {
          no_api_key: 'ANTHROPIC_API_KEY 未设置，AI 压缩已禁用',
          credit_exhausted: 'API 额度耗尽，AI 压缩已禁用（其他功能正常）',
          invalid_api_key: 'API Key 无效，AI 压缩已禁用',
          config_disabled: 'AI 压缩已通过配置禁用',
          rate_limited: 'API 速率限制，AI 压缩暂时禁用',
          unknown_error: 'API 调用失败，AI 压缩已禁用',
        };
        logger.warn('COMPRESS', messages[reason]);
      }
    }
  }

  /**
   * 检测 API 错误类型并决定是否禁用
   */
  private handleAPIError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = JSON.stringify(error);

    // 检测额度耗尽
    if (
      errorMessage.includes('credit balance is too low') ||
      errorMessage.includes('insufficient_quota') ||
      errorString.includes('credit balance')
    ) {
      this.disableAI('credit_exhausted');
      return;
    }

    // 检测 Key 无效
    if (
      errorMessage.includes('invalid_api_key') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('401')
    ) {
      this.disableAI('invalid_api_key');
      return;
    }

    // 检测速率限制
    if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
      this.disableAI('rate_limited');
      return;
    }

    // 其他错误：记录但不禁用（可能是临时网络问题）
    logger.debug('COMPRESS', 'API call failed (will retry next time)', { error: errorMessage });
  }

  private getClient(): Anthropic | null {
    // 如果已禁用，返回 null
    if (!this.aiEnabled) {
      return null;
    }

    if (!this.client) {
      try {
        this.client = new Anthropic();
      } catch (error) {
        this.handleAPIError(error);
        return null;
      }
    }
    return this.client;
  }

  /**
   * Compress a tool call result into structured observation
   * 优雅降级：API 不可用时返回 null，不影响其他功能
   */
  async compressToolCall(
    toolName: string,
    toolInput: string | object | undefined,
    toolOutput: string | undefined,
    project: string
  ): Promise<CompressionResult | null> {
    // 优雅降级：如果 AI 已禁用，直接返回 null
    const client = this.getClient();
    if (!client) {
      return null;
    }

    try {
      // Normalize input to string (handle undefined/null)
      const inputStr = toolInput == null
        ? ''
        : (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput));

      // Normalize output to string (handle undefined/null)
      const outputStr = toolOutput == null ? '' : String(toolOutput);

      // Truncate output if too long
      const truncatedOutput =
        outputStr.length > 2000 ? outputStr.slice(0, 2000) + '...[truncated]' : outputStr;

      const prompt = COMPRESSION_PROMPT.replace('{tool_name}', toolName)
        .replace('{tool_input}', inputStr)
        .replace('{tool_output}', truncatedOutput)
        .replace('{project}', project);

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      // Parse JSON response
      const result = JSON.parse(content.text) as CompressionResult;

      logger.debug('COMPRESS', `Compressed ${toolName}`, {
        shouldStore: result.should_store,
        type: result.type,
      });

      return result;
    } catch (error) {
      // 检测错误类型，决定是否禁用 AI
      this.handleAPIError(error);

      // 只在非禁用情况下记录详细错误
      if (this.aiEnabled) {
        logger.error('COMPRESS', 'Failed to compress tool call', { toolName }, error as Error);
      }
      return null;
    }
  }

  /**
   * Generate session summary
   * 优雅降级：API 不可用时返回 null，不影响其他功能
   */
  async generateSummary(
    project: string,
    userPrompt: string,
    observations: Array<{ type: string; title: string; narrative?: string }>
  ): Promise<SummaryResult | null> {
    // 优雅降级：如果 AI 已禁用，直接返回 null
    const client = this.getClient();
    if (!client) {
      return null;
    }

    try {
      // Format observations
      const obsText = observations
        .map((o, i) => `${i + 1}. [${o.type}] ${o.title}: ${o.narrative || 'N/A'}`)
        .join('\n');

      const prompt = SUMMARY_PROMPT.replace('{project}', project)
        .replace('{user_prompt}', userPrompt || 'Unknown')
        .replace('{observations}', obsText || 'No observations recorded');

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return null;
      }

      const result = JSON.parse(content.text);

      // Transform sinkable_knowledge to proper format
      const sinkableKnowledge: KnowledgeInput[] = (result.sinkable_knowledge || []).map(
        (k: { type: string; title: string; content: string; tags?: string[] }) => ({
          project,
          type: k.type,
          title: k.title,
          content: k.content,
          tags: k.tags,
        })
      );

      return {
        request: result.request,
        investigated: result.investigated,
        learned: result.learned,
        completed: result.completed,
        next_steps: result.next_steps,
        sinkable_knowledge: sinkableKnowledge,
      };
    } catch (error) {
      // 检测错误类型，决定是否禁用 AI
      this.handleAPIError(error);

      // 只在非禁用情况下记录详细错误
      if (this.aiEnabled) {
        logger.error('COMPRESS', 'Failed to generate summary', { project }, error as Error);
      }
      return null;
    }
  }

  /**
   * Quick check if a tool call is worth compressing
   */
  shouldCompress(toolName: string, toolInput: string | object | undefined): boolean {
    // Skip trivial tools
    const skipTools = [
      'ListMcpResourcesTool',
      'SlashCommand',
      'Skill',
      'TodoWrite',
      'TodoRead',
      'TaskList',
      'TaskGet',
      'TaskCreate',
      'TaskUpdate',
      'AskUserQuestion',
    ];

    if (skipTools.includes(toolName)) {
      return false;
    }

    // Skip simple read operations without meaningful content
    if (toolName === 'Read' || toolName === 'Glob') {
      // Still compress - might discover important files
      return true;
    }

    // Skip bash commands that are just exploration
    if (toolName === 'Bash') {
      // Normalize input to string for command analysis
      const inputStr = toolInput == null ? '' : (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput));
      const simpleCommands = ['ls', 'pwd', 'which', 'echo', 'cat'];
      const inputLower = inputStr.toLowerCase();
      for (const cmd of simpleCommands) {
        if (inputLower.startsWith(cmd) && !inputLower.includes('&&') && !inputLower.includes('|')) {
          return false;
        }
      }
    }

    return true;
  }
}

// Singleton
let compressorInstance: CompressorService | null = null;

export function getCompressor(): CompressorService {
  if (!compressorInstance) {
    compressorInstance = new CompressorService();
  }
  return compressorInstance;
}
