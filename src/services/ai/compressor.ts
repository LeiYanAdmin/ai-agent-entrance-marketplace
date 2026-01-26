/**
 * AI-powered semantic compression for observations
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../../shared/config.js';
import { logger } from '../../utils/logger.js';
import type { CompressionResult, SummaryResult, KnowledgeInput } from '../../shared/types.js';

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

  constructor() {
    this.model = getSetting('AI_MODEL');
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic();
    }
    return this.client;
  }

  /**
   * Compress a tool call result into structured observation
   */
  async compressToolCall(
    toolName: string,
    toolInput: string,
    toolOutput: string,
    project: string
  ): Promise<CompressionResult | null> {
    try {
      const client = this.getClient();

      // Truncate output if too long
      const truncatedOutput =
        toolOutput.length > 2000 ? toolOutput.slice(0, 2000) + '...[truncated]' : toolOutput;

      const prompt = COMPRESSION_PROMPT.replace('{tool_name}', toolName)
        .replace('{tool_input}', toolInput)
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
      logger.error('COMPRESS', 'Failed to compress tool call', { toolName }, error as Error);
      return null;
    }
  }

  /**
   * Generate session summary
   */
  async generateSummary(
    project: string,
    userPrompt: string,
    observations: Array<{ type: string; title: string; narrative?: string }>
  ): Promise<SummaryResult | null> {
    try {
      const client = this.getClient();

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
      logger.error('COMPRESS', 'Failed to generate summary', { project }, error as Error);
      return null;
    }
  }

  /**
   * Quick check if a tool call is worth compressing
   */
  shouldCompress(toolName: string, toolInput: string): boolean {
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
      const simpleCommands = ['ls', 'pwd', 'which', 'echo', 'cat'];
      const inputLower = toolInput.toLowerCase();
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
