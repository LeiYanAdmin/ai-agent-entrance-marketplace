/**
 * Core types for AI Agent Entrance
 */

// ============================================================================
// Database Entity Types
// ============================================================================

export interface SessionRow {
  id: number;
  session_id: string;
  project: string;
  user_prompt: string | null;
  detected_keywords: string | null; // JSON array
  recommended_workflow: string | null;
  created_at: string;
  created_at_epoch: number;
  completed_at: string | null;
  status: 'active' | 'completed' | 'failed';
}

export interface ObservationRow {
  id: number;
  session_id: string;
  project: string;
  type: ObservationType;
  title: string;
  subtitle: string | null;
  facts: string | null; // JSON array
  narrative: string | null;
  concepts: string | null; // JSON array
  files_read: string | null; // JSON array
  files_modified: string | null; // JSON array
  tool_name: string | null;
  prompt_number: number | null;
  discovery_tokens: number;
  should_sink: boolean;
  created_at: string;
  created_at_epoch: number;
}

export interface KnowledgeRow {
  id: number;
  session_id: string | null;
  observation_id: number | null;
  project: string;
  type: KnowledgeType;
  title: string;
  content: string;
  tags: string | null; // JSON array
  file_path: string | null; // Path to CLAUDE.md or global repo
  synced_at: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SessionSummaryRow {
  id: number;
  session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null; // JSON array
  files_edited: string | null; // JSON array
  sinkable_knowledge: string | null; // JSON array of knowledge IDs
  created_at: string;
  created_at_epoch: number;
}

// ============================================================================
// Enum Types
// ============================================================================

export type ObservationType =
  | 'decision'    // Architecture decision
  | 'bugfix'      // Bug fix
  | 'feature'     // New feature
  | 'refactor'    // Code refactoring
  | 'discovery'   // Code/system discovery
  | 'pitfall'     // Gotcha/trap
  | 'change';     // General change

export type KnowledgeType =
  | 'pitfall'       // 踩坑记录
  | 'adr'           // Architecture Decision Record
  | 'glossary'      // 术语定义
  | 'best-practice' // 最佳实践
  | 'pattern'       // 设计模式
  | 'discovery';    // 发现

export type WorkflowType =
  | 'superpowers'   // SDD + TDD
  | 'bmad'          // Full product development
  | 'openspec'      // Legacy optimization
  | 'speckit'       // Clear spec implementation
  | 'plan'          // Built-in plan mode
  | 'ralph';        // Long-running autonomous

export type TaskType =
  | 'new-project'
  | 'optimization'
  | 'refactor'
  | 'bug-fix'
  | 'feature'
  | 'research'
  | 'unknown';

// ============================================================================
// Input Types (for creating records)
// ============================================================================

export interface SessionInput {
  session_id: string;
  project: string;
  user_prompt?: string;
  detected_keywords?: string[];
  recommended_workflow?: WorkflowType;
}

export interface ObservationInput {
  session_id: string;
  project: string;
  type: ObservationType;
  title: string;
  subtitle?: string;
  facts?: string[];
  narrative?: string;
  concepts?: string[];
  files_read?: string[];
  files_modified?: string[];
  tool_name?: string;
  prompt_number?: number;
  discovery_tokens?: number;
  should_sink?: boolean;
}

export interface KnowledgeInput {
  session_id?: string;
  observation_id?: number;
  project: string;
  type: KnowledgeType;
  title: string;
  content: string;
  tags?: string[];
  file_path?: string;
}

// ============================================================================
// Hook Types
// ============================================================================

export interface HookInput {
  session_id?: string;
  project?: string;
  cwd?: string;
}

export interface SessionStartInput extends HookInput {
  type: 'startup' | 'resume' | 'clear' | 'compact';
}

export interface UserPromptSubmitInput extends HookInput {
  prompt: string;
  prompt_number?: number;
}

export interface PostToolUseInput extends HookInput {
  tool_name: string;
  tool_input: string;
  tool_output: string;
  prompt_number?: number;
}

export interface StopInput extends HookInput {
  transcript_path?: string;
  last_user_message?: string;
  last_assistant_message?: string;
}

export interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
  hookSpecificOutput?: string;
  message?: string;
}

// ============================================================================
// Routing Types
// ============================================================================

export interface RoutingResult {
  keywords: string[];
  task_type: TaskType;
  product_line?: string;
  recommended_workflow: WorkflowType;
  reason: string;
  installed_tools: string[];
  missing_tools: string[];
}

export interface KeywordMatch {
  keyword: string;
  category: string;
  weight: number;
}

// ============================================================================
// Search Types
// ============================================================================

export interface SearchFilters {
  project?: string;
  type?: ObservationType | ObservationType[];
  concepts?: string | string[];
  files?: string | string[];
  dateStart?: string | number;
  dateEnd?: string | number;
}

export interface SearchOptions extends SearchFilters {
  limit?: number;
  offset?: number;
  orderBy?: 'relevance' | 'date_desc' | 'date_asc';
}

export interface SearchResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// ============================================================================
// API Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  database: boolean;
  ai: boolean;
}

// ============================================================================
// AI Compression Types
// ============================================================================

export interface CompressionResult {
  type: ObservationType;
  title: string;
  subtitle?: string;
  facts: string[];
  narrative: string;
  concepts: string[];
  files_modified: string[];
  should_store: boolean;
  knowledge_type?: KnowledgeType;
}

export interface SummaryResult {
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  next_steps: string;
  sinkable_knowledge: KnowledgeInput[];
}
