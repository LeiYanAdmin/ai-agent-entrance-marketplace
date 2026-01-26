/**
 * Worker Service - HTTP API for AI Agent Entrance
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { getWorkerPort, getWorkerHost, ensureDataDir } from '../shared/config.js';
import { logger } from '../utils/logger.js';
import { DatabaseStore, getStore } from './database/store.js';
import { SearchService } from './database/search.js';
import { getRoutingService, RoutingService } from './routing.js';
import { getCompressor, CompressorService } from './ai/compressor.js';
import { ProcessManager } from './infrastructure/process-manager.js';
import type {
  SessionStartInput,
  UserPromptSubmitInput,
  PostToolUseInput,
  StopInput,
  HookOutput,
  ApiResponse,
  HealthStatus,
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
  private startTime: number;
  private isShuttingDown: boolean = false;

  constructor() {
    this.app = express();
    this.store = getStore();
    this.routing = getRoutingService();
    this.compressor = getCompressor();
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

    // Search
    this.app.get('/api/search/observations', this.handleSearchObservations.bind(this));
    this.app.get('/api/search/knowledge', this.handleSearchKnowledge.bind(this));

    // Knowledge management
    this.app.post('/api/knowledge/sink', this.handleKnowledgeSink.bind(this));
    this.app.get('/api/knowledge/pending', this.handleKnowledgePending.bind(this));

    // Stats
    this.app.get('/api/stats', this.handleStats.bind(this));
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
      version: process.env.npm_package_version || '2.0.0',
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

      // Format context
      let context = `<ai-agent-entrance>\n\n**智能路由已激活** - 我会根据你的需求自动推荐最佳开发流程。\n\n`;

      // Recent activity
      if (observations.length > 0) {
        context += `## 最近活动\n\n| 时间 | 类型 | 标题 |\n|-----|------|-----|\n`;
        for (const obs of observations.slice(0, 10)) {
          const time = new Date(obs.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          const typeEmoji = this.getTypeEmoji(obs.type);
          context += `| ${time} | ${typeEmoji} | ${obs.title} |\n`;
        }
        context += '\n';
      }

      // Installed tools
      context += `## 已安装工具\n`;
      if (installedTools.length > 0) {
        context += installedTools.map(t => `- ${t} ✅`).join('\n');
      } else {
        context += '- 无已安装的开发工具';
      }
      context += '\n\n</ai-agent-entrance>';

      res.json({
        continue: true,
        suppressOutput: false,
        hookSpecificOutput: context,
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
