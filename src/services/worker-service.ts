/**
 * Worker Service - HTTP API for AI Agent Entrance
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { getWorkerPort, getWorkerHost, ensureDataDir, getPluginRoot, getL2RepoPath, getDataDir } from '../shared/config.js';
import { logger } from '../utils/logger.js';
import { DatabaseStore, getStore } from './database/store.js';
import { SearchService } from './database/search.js';
import { getRoutingService, RoutingService } from './routing.js';
import { getCompressor, CompressorService } from './ai/compressor.js';
import { ProcessManager } from './infrastructure/process-manager.js';
import { SyncEngine } from './sync/sync-engine.js';
import { SensitiveFilter } from './security/sensitive-filter.js';
import { AgentsMdGenerator } from './index/agents-md-generator.js';
import type {
  SessionStartInput,
  UserPromptSubmitInput,
  PostToolUseInput,
  StopInput,
  HookOutput,
  ApiResponse,
  HealthStatus,
  KnowledgeAssetType,
  SyncDirection,
} from '../shared/types.js';

// ============================================================================
// Worker Service Class
// ============================================================================

export class WorkerService {
  private app: express.Application;
  private server: HttpServer | null = null;
  private store: DatabaseStore;
  private search: SearchService | null = null;
  private routing: RoutingService;
  private compressor: CompressorService;
  private syncEngine: SyncEngine;
  private sensitiveFilter: SensitiveFilter;
  private agentsMdGenerator: AgentsMdGenerator;
  private startTime: number;
  private isShuttingDown: boolean = false;

  constructor() {
    this.app = express();
    this.store = getStore();
    this.routing = getRoutingService();
    this.compressor = getCompressor();
    this.syncEngine = new SyncEngine(this.store);
    this.sensitiveFilter = new SensitiveFilter();
    this.agentsMdGenerator = new AgentsMdGenerator(this.store);
    this.startTime = Date.now();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSignalHandlers();
  }

  // ============================================================================
  // Setup
  // ============================================================================

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.debug('HTTP', `${req.method} ${req.path}`);
      next();
    });

    // Error handling
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      logger.error('HTTP', 'Request error', { path: req.path }, err);
      res.status(500).json({ success: false, error: err.message });
    });
  }

  private setupRoutes(): void {
    // Dashboard UI
    const uiDir = join(getPluginRoot(), 'ui');
    this.app.use('/ui', express.static(uiDir));
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(join(uiDir, 'dashboard.html'));
    });

    // Health & Admin
    this.app.get('/api/health', this.handleHealth.bind(this));
    this.app.get('/api/readiness', this.handleReadiness.bind(this));
    this.app.post('/api/admin/shutdown', this.handleShutdown.bind(this));

    // Hook endpoints
    this.app.post('/api/hook/session-start', this.handleSessionStart.bind(this));
    this.app.post('/api/hook/user-prompt', this.handleUserPrompt.bind(this));
    this.app.post('/api/hook/tool-use', this.handleToolUse.bind(this));
    this.app.post('/api/hook/stop', this.handleStop.bind(this));

    // Context injection
    this.app.get('/api/context/inject', this.handleContextInject.bind(this));

    // Routing
    this.app.post('/api/routing/analyze', this.handleRoutingAnalyze.bind(this));

    // Data listing
    this.app.get('/api/observations', this.handleListObservations.bind(this));
    this.app.get('/api/knowledge', this.handleListKnowledge.bind(this));

    // Search
    this.app.get('/api/search/observations', this.handleSearchObservations.bind(this));
    this.app.get('/api/search/knowledge', this.handleSearchKnowledge.bind(this));

    // Knowledge management
    this.app.post('/api/knowledge/sink', this.handleKnowledgeSink.bind(this));
    this.app.get('/api/knowledge/pending', this.handleKnowledgePending.bind(this));

    // Stats
    this.app.get('/api/stats', this.handleStats.bind(this));

    // Knowledge Assets (L1 ↔ L2)
    this.app.get('/api/knowledge-assets/search', this.handleSearchKnowledgeAssets.bind(this));
    this.app.get('/api/knowledge-assets/get', this.handleGetAsset.bind(this));
    this.app.get('/api/knowledge-assets/list', this.handleListAssets.bind(this));
    this.app.post('/api/knowledge/sink-asset', this.handleSinkAsset.bind(this));

    // Sync
    this.app.post('/api/sync/trigger', this.handleSyncTrigger.bind(this));
    this.app.post('/api/sync/commit-push', this.handleCommitPush.bind(this));

    // Config
    this.app.get('/api/config/read', this.handleConfigRead.bind(this));
    this.app.post('/api/config/write', this.handleConfigWrite.bind(this));

    // Security
    this.app.post('/api/security/filter', this.handleSecurityFilter.bind(this));

    // Knowledge Stats
    this.app.get('/api/stats/knowledge', this.handleKnowledgeStats.bind(this));
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info('WORKER', `Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    const port = getWorkerPort();
    const host = getWorkerHost();

    ensureDataDir();

    // Initialize database
    await this.store.initialize();

    // Initialize search service
    this.search = new SearchService();

    // Initialize sync engine (non-blocking)
    const l2RepoUrl = this.store.getConfigValue('L2_REPO_URL') || '';
    this.syncEngine.initialize(l2RepoUrl || undefined).catch(err => {
      logger.warn('WORKER', `Sync engine initialization deferred: ${(err as Error).message}`);
    });

    // Start HTTP server
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      this.server.listen(port, host, () => {
        // Write PID file
        ProcessManager.writePidFile({
          pid: process.pid,
          port,
          startedAt: new Date().toISOString(),
        });

        logger.info('WORKER', `Started on http://${host}:${port}`, { pid: process.pid });
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async shutdown(): Promise<void> {
    logger.info('WORKER', 'Shutting down...');

    // Close search service
    if (this.search) {
      this.search.close();
    }

    // Close database
    this.store.close();

    // Close HTTP server
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server!.close(() => resolve());
      });
    }

    // Remove PID file
    ProcessManager.removePidFile();

    logger.info('WORKER', 'Shutdown complete');
  }

  // ============================================================================
  // Health Handlers
  // ============================================================================

  private handleHealth(req: Request, res: Response): void {
    const status: HealthStatus = {
      status: 'healthy',
      version: process.env.npm_package_version || '2.1.0',
      uptime: Date.now() - this.startTime,
      database: true,
      ai: true,
    };
    res.json(status);
  }

  private handleReadiness(req: Request, res: Response): void {
    res.json({ ready: true });
  }

  private async handleShutdown(req: Request, res: Response): Promise<void> {
    res.json({ success: true, message: 'Shutting down' });

    // Delay shutdown to allow response to be sent
    setTimeout(() => {
      this.shutdown().then(() => process.exit(0));
    }, 100);
  }

  // ============================================================================
  // Hook Handlers
  // ============================================================================

  private async handleSessionStart(req: Request, res: Response): Promise<void> {
    try {
      const input = req.body as SessionStartInput;
      const project = input.project || input.cwd || 'unknown';

      // Get or create session
      const sessionId = input.session_id || `session-${Date.now()}`;
      this.store.getOrCreateSession(sessionId, project);

      const output: HookOutput = {
        continue: true,
        suppressOutput: true,
      };

      res.json(output);
    } catch (error) {
      logger.error('HOOK', 'SessionStart failed', {}, error as Error);
      res.json({ continue: true, suppressOutput: true });
    }
  }

  private async handleUserPrompt(req: Request, res: Response): Promise<void> {
    try {
      const input = req.body as UserPromptSubmitInput;
      const project = input.project || input.cwd || 'unknown';
      const sessionId = input.session_id || `session-${Date.now()}`;

      // Get installed tools
      const installedTools = await RoutingService.getInstalledTools();

      // Analyze routing
      const routing = this.routing.analyze(input.prompt, installedTools);

      // Update session
      this.store.updateSession(sessionId, {
        user_prompt: input.prompt,
        detected_keywords: JSON.stringify(routing.keywords),
        recommended_workflow: routing.recommended_workflow,
      });

      // Detect knowledge triggers
      const triggers = this.routing.detectKnowledgeTriggers(input.prompt);

      const output: HookOutput = {
        continue: true,
        suppressOutput: true,
      };

      // Add trigger hints if found
      if (triggers.length > 0) {
        output.message = `检测到可沉淀关键字: ${triggers.map(t => t.keyword).join(', ')}`;
      }

      res.json(output);
    } catch (error) {
      logger.error('HOOK', 'UserPrompt failed', {}, error as Error);
      res.json({ continue: true, suppressOutput: true });
    }
  }

  private async handleToolUse(req: Request, res: Response): Promise<void> {
    try {
      const input = req.body as PostToolUseInput;
      const project = input.project || input.cwd || 'unknown';
      const sessionId = input.session_id || `session-${Date.now()}`;

      // Check if should compress
      if (!this.compressor.shouldCompress(input.tool_name, input.tool_input)) {
        res.json({ continue: true, suppressOutput: true });
        return;
      }

      // Compress in background (don't block)
      this.compressor
        .compressToolCall(input.tool_name, input.tool_input, input.tool_output, project)
        .then(result => {
          if (result && result.should_store) {
            this.store.createObservation({
              session_id: sessionId,
              project,
              type: result.type,
              title: result.title,
              subtitle: result.subtitle,
              facts: result.facts,
              narrative: result.narrative,
              concepts: result.concepts,
              files_modified: result.files_modified,
              tool_name: input.tool_name,
              prompt_number: input.prompt_number,
              should_sink: !!result.knowledge_type,
            });
          }
        })
        .catch(err => {
          logger.error('HOOK', 'Background compression failed', {}, err);
        });

      res.json({ continue: true, suppressOutput: true });
    } catch (error) {
      logger.error('HOOK', 'ToolUse failed', {}, error as Error);
      res.json({ continue: true, suppressOutput: true });
    }
  }

  private async handleStop(req: Request, res: Response): Promise<void> {
    try {
      const input = req.body as StopInput;
      const project = input.project || input.cwd || 'unknown';
      const sessionId = input.session_id || `session-${Date.now()}`;

      // Get session and observations
      const session = this.store.getSession(sessionId);
      const observations = this.store.getSessionObservations(sessionId);

      // Generate summary
      const summary = await this.compressor.generateSummary(
        project,
        session?.user_prompt || '',
        observations.map(o => ({
          type: o.type,
          title: o.title,
          narrative: o.narrative || undefined,
        }))
      );

      if (summary) {
        // Save summary
        this.store.createSummary(sessionId, project, {
          request: summary.request,
          investigated: summary.investigated,
          learned: summary.learned,
          completed: summary.completed,
          next_steps: summary.next_steps,
        });

        // Create sinkable knowledge
        for (const k of summary.sinkable_knowledge) {
          this.store.createKnowledge(k);
        }
      }

      // Mark session complete
      this.store.updateSession(sessionId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });

      res.json({ continue: true, suppressOutput: true });
    } catch (error) {
      logger.error('HOOK', 'Stop failed', {}, error as Error);
      res.json({ continue: true, suppressOutput: true });
    }
  }

  // ============================================================================
  // Context Injection
  // ============================================================================

  private async handleContextInject(req: Request, res: Response): Promise<void> {
    try {
      const project = (req.query.project as string) || 'unknown';
      const limit = parseInt((req.query.limit as string) || '20', 10);

      // Get installed tools
      const installedTools = await RoutingService.getInstalledTools();

      // Get recent observations
      const observations = this.store.getRecentObservations(project, limit);

      // Build context with all sections
      const sections: string[] = [];

      // ========== 1. Retrieval-First Policy ==========
      sections.push(`┌─────────────────────────────────────────────────────┐
│ RETRIEVAL-FIRST POLICY                              │
└─────────────────────────────────────────────────────┘

**CRITICAL: Prefer Retrieval-Led Reasoning**

For ANY task involving code, architecture, or technical decisions:

1. **ALWAYS check knowledge index FIRST** before relying on pre-trained knowledge
2. **Use three-layer strategy** for optimal retrieval:
   - L0: Scan the knowledge index (already in context)
   - L1: Use search_knowledge() for cross-validation when needed
   - L2: Use get_asset() to retrieve full content
3. **Prefer documented experience** over general best practices

**Why?** The knowledge base contains team-specific pitfalls and proven solutions that general models don't know.`);

      // ========== 2. AGENTS-INDEX.md ==========
      const agentsIndexPath = join(getDataDir(), 'AGENTS-INDEX.md');
      if (existsSync(agentsIndexPath)) {
        try {
          const agentsIndex = readFileSync(agentsIndexPath, 'utf-8');
          if (agentsIndex.trim()) {
            sections.push(`## 知识库索引\n\n${agentsIndex}`);
          }
        } catch (err) {
          logger.warn('CONTEXT', 'Failed to read AGENTS-INDEX.md', {}, err as Error);
        }
      }

      // ========== 3. Recent Activity ==========
      if (observations.length > 0) {
        let activitySection = `## 最近活动\n\n| 时间 | 类型 | 标题 |\n|-----|------|-----|\n`;
        for (const obs of observations.slice(0, 10)) {
          const time = new Date(obs.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          const typeEmoji = this.getTypeEmoji(obs.type);
          activitySection += `| ${time} | ${typeEmoji} | ${obs.title} |\n`;
        }
        sections.push(activitySection);
      }

      // ========== 4. Knowledge Summary (L2 Sync) ==========
      try {
        const autoSync = this.store.getConfigValue('AUTO_SYNC_ON_SESSION_START');
        if (autoSync === 'true') {
          this.syncEngine.pullFromL2().catch(err => {
            logger.warn('CONTEXT', `Auto-sync pull failed: ${(err as Error).message}`);
          });
        }

        const knowledgeSummary = this.syncEngine.getKnowledgeSummary();
        if (knowledgeSummary && knowledgeSummary !== '知识库为空') {
          sections.push(`## 知识库摘要\n${knowledgeSummary}`);
        }
      } catch {
        // Sync engine may not be initialized yet
      }

      // ========== 5. Pending Knowledge Reminder ==========
      const pendingFile = join(getDataDir(), 'pending-sink.json');
      if (existsSync(pendingFile)) {
        try {
          const pendingData = JSON.parse(readFileSync(pendingFile, 'utf-8'));
          if (pendingData.items && pendingData.items.length > 0) {
            const pendingCount = pendingData.items.length;
            const pendingItems = pendingData.items
              .slice(0, 5)
              .map((item: { type: string; summary: string }) => `• ${item.type}: ${item.summary}`)
              .join('\n');
            sections.push(`## 待沉淀知识提醒

🔔 **上次会话有 ${pendingCount} 条知识待沉淀：**

${pendingItems}

输入 \`/knowledge\` 立即沉淀，或输入 \`/knowledge skip\` 跳过。`);
          }
        } catch {
          // Invalid JSON or missing items
        }
      }

      // ========== 6. Installed Tools ==========
      let toolsSection = `## 已安装工具\n`;
      if (installedTools.length > 0) {
        toolsSection += installedTools.map(t => `- ${t} ✅`).join('\n');
      } else {
        toolsSection += '- 无已安装的开发工具';
      }
      sections.push(toolsSection);

      // ========== 7. Router Activation Notice ==========
      sections.push(`**智能路由已激活** - 我会根据你的需求自动推荐最佳开发流程。`);

      // Combine all sections
      const context = `<ai-agent-entrance>\n\n${sections.join('\n\n')}\n\n</ai-agent-entrance>`;

      res.json({
        continue: true,
        suppressOutput: false,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: context,
        },
      });
    } catch (error) {
      logger.error('CONTEXT', 'Inject failed', {}, error as Error);
      res.json({ continue: true, suppressOutput: true });
    }
  }

  private getTypeEmoji(type: string): string {
    const emojis: Record<string, string> = {
      decision: '🟣',
      bugfix: '🔴',
      feature: '🔵',
      refactor: '🟡',
      discovery: '🟢',
      pitfall: '⚠️',
      change: '⚪',
    };
    return emojis[type] || '⚪';
  }

  // ============================================================================
  // Routing
  // ============================================================================

  private async handleRoutingAnalyze(req: Request, res: Response): Promise<void> {
    try {
      const { input } = req.body as { input: string };
      const installedTools = await RoutingService.getInstalledTools();
      const result = this.routing.analyze(input, installedTools);

      res.json({ success: true, data: result });
    } catch (error) {
      logger.error('ROUTING', 'Analyze failed', {}, error as Error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Data Listing
  // ============================================================================

  private handleListObservations(req: Request, res: Response): void {
    try {
      const project = req.query.project as string;
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const observations = this.store.getRecentObservations(project || undefined, limit);
      res.json({ success: true, data: observations });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private handleListKnowledge(req: Request, res: Response): void {
    try {
      const project = req.query.project as string;
      const pending = this.store.getUnsyncedKnowledge(project || undefined);
      res.json({ success: true, data: pending });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Search
  // ============================================================================

  private handleSearchObservations(req: Request, res: Response): void {
    try {
      if (!this.search) {
        res.status(503).json({ success: false, error: 'Search not ready' });
        return;
      }

      const query = req.query.q as string;
      const project = req.query.project as string;
      const limit = parseInt((req.query.limit as string) || '20', 10);

      if (!query) {
        res.status(400).json({ success: false, error: 'Query required' });
        return;
      }

      const result = this.search.searchObservations(query, { project, limit });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private handleSearchKnowledge(req: Request, res: Response): void {
    try {
      if (!this.search) {
        res.status(503).json({ success: false, error: 'Search not ready' });
        return;
      }

      const query = req.query.q as string;
      const project = req.query.project as string;
      const limit = parseInt((req.query.limit as string) || '20', 10);

      if (!query) {
        res.status(400).json({ success: false, error: 'Query required' });
        return;
      }

      const result = this.search.searchKnowledge(query, { project, limit });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Knowledge Management
  // ============================================================================

  private async handleKnowledgeSink(req: Request, res: Response): Promise<void> {
    try {
      const { type, title, content, tags, project } = req.body;

      const knowledge = this.store.createKnowledge({
        type,
        title,
        content,
        tags,
        project: project || 'unknown',
      });

      res.json({ success: true, data: knowledge });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private handleKnowledgePending(req: Request, res: Response): void {
    try {
      const project = req.query.project as string;
      const pending = this.store.getUnsyncedKnowledge(project);
      res.json({ success: true, data: pending });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  private handleStats(req: Request, res: Response): void {
    try {
      const project = req.query.project as string;
      const stats = this.search?.getStats(project) || { observations: 0, knowledge: 0, sessions: 0 };
      res.json({
        success: true,
        data: {
          ...stats,
          uptime: Date.now() - this.startTime,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Knowledge Assets (L1 ↔ L2)
  // ============================================================================

  private handleSearchKnowledgeAssets(req: Request, res: Response): void {
    try {
      if (!this.search) {
        res.status(503).json({ success: false, error: 'Search not ready' });
        return;
      }

      const query = (req.query.query || req.query.q) as string;
      if (!query) {
        res.status(400).json({ success: false, error: 'Query required' });
        return;
      }

      const product_line = req.query.product_line as string | undefined;
      const type = req.query.type as KnowledgeAssetType | undefined;
      const limit = parseInt((req.query.limit as string) || '20', 10);

      const result = this.search.searchKnowledgeAssets(query, { product_line, type, limit });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private handleGetAsset(req: Request, res: Response): void {
    try {
      const id = req.query.id as string;
      const name = req.query.name as string;
      const productLine = req.query.product_line as string;

      let asset = null;
      if (id) {
        asset = this.store.getKnowledgeAsset(parseInt(id, 10));
      } else if (name && productLine) {
        asset = this.store.getKnowledgeAssetByName(name, productLine);
      } else if (name) {
        asset = this.store.getKnowledgeAssetByName(name, 'general');
      }

      if (!asset) {
        res.status(404).json({ success: false, error: 'Asset not found' });
        return;
      }

      res.json({ success: true, data: asset });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private handleListAssets(req: Request, res: Response): void {
    try {
      if (!this.search) {
        res.status(503).json({ success: false, error: 'Search not ready' });
        return;
      }

      const type = req.query.type as KnowledgeAssetType | undefined;
      const product_line = req.query.product_line as string | undefined;
      const promoted = req.query.promoted === 'true' ? true : req.query.promoted === 'false' ? false : undefined;
      const limit = parseInt((req.query.limit as string) || '50', 10);
      const offset = parseInt((req.query.offset as string) || '0', 10);

      const result = this.search.listAssets({ type, product_line, promoted, limit, offset });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private async handleSinkAsset(req: Request, res: Response): Promise<void> {
    try {
      const { type, name, product_line, title, content, tags, source_project } = req.body;

      if (!type || !name || !product_line || !title || !content) {
        res.status(400).json({ success: false, error: 'Missing required fields: type, name, product_line, title, content' });
        return;
      }

      // Filter sensitive content before sinking
      const safeContent = this.sensitiveFilter.sanitize(content);

      const asset = this.store.upsertKnowledgeAsset({
        type,
        name,
        product_line,
        title,
        content: safeContent,
        tags,
        source_project,
      });

      // Update AGENTS-INDEX.md after sinking asset
      try {
        this.agentsMdGenerator.writeAgentsMd();
      } catch (error) {
        logger.warn('SINK', 'Failed to update AGENTS-INDEX.md after sink', {}, error as Error);
      }

      res.json({ success: true, data: asset });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Sync
  // ============================================================================

  private async handleSyncTrigger(req: Request, res: Response): Promise<void> {
    try {
      const direction = (req.body.direction || 'both') as SyncDirection;

      // Refresh remote URL from config before sync
      const l2RepoUrl = this.store.getConfigValue('L2_REPO_URL');
      if (l2RepoUrl) {
        this.syncEngine.updateRemote(l2RepoUrl);
      }

      const result = await this.syncEngine.sync(direction);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private async handleCommitPush(req: Request, res: Response): Promise<void> {
    try {
      const message = req.body.message as string | undefined;

      // Refresh remote URL from config before push
      const l2RepoUrl = this.store.getConfigValue('L2_REPO_URL');
      if (l2RepoUrl) {
        this.syncEngine.updateRemote(l2RepoUrl);
      }

      const result = await this.syncEngine.commitAndPush(message);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Config
  // ============================================================================

  private handleConfigRead(req: Request, res: Response): void {
    try {
      const key = req.query.key as string;
      if (!key) {
        // Return all config
        const allConfig = this.store.getAllConfig();
        res.json({ success: true, data: allConfig });
        return;
      }
      const value = this.store.getConfigValue(key);
      res.json({ success: true, data: { key, value } });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  private handleConfigWrite(req: Request, res: Response): void {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        res.status(400).json({ success: false, error: 'key and value required' });
        return;
      }
      this.store.setConfigValue(key, String(value));
      res.json({ success: true, data: { key, value } });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Security
  // ============================================================================

  private handleSecurityFilter(req: Request, res: Response): void {
    try {
      const { content, custom_patterns } = req.body;
      if (!content) {
        res.status(400).json({ success: false, error: 'content required' });
        return;
      }

      const filter = custom_patterns ? new SensitiveFilter(custom_patterns) : this.sensitiveFilter;
      const findings = filter.detect(content);
      const sanitized = filter.sanitize(content);

      res.json({
        success: true,
        data: {
          safe: findings.length === 0,
          findings,
          sanitized,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  // ============================================================================
  // Knowledge Stats
  // ============================================================================

  private handleKnowledgeStats(req: Request, res: Response): void {
    try {
      if (!this.search) {
        res.status(503).json({ success: false, error: 'Search not ready' });
        return;
      }

      const productLine = req.query.product_line as string | undefined;
      const stats = this.search.getAssetStats(productLine);
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
}

// ============================================================================
// Main Entry
// ============================================================================

async function main(): Promise<void> {
  const worker = new WorkerService();
  await worker.start();
}

// Run if main module (CJS compatible)
const isMainModule = require.main === module;

if (isMainModule) {
  main().catch(error => {
    logger.failure('WORKER', 'Failed to start', {}, error);
    process.exit(1);
  });
}
