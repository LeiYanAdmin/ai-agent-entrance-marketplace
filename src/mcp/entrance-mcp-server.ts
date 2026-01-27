/**
 * MCP Server for AI Agent Entrance
 * Thin wrapper: StdioServerTransport → HTTP Worker delegation
 *
 * Pattern: All tool calls are delegated to the worker service HTTP API.
 * This process only handles MCP protocol and routes to worker endpoints.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import http from 'http';

// Critical: redirect console.log to stderr for MCP protocol
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  console.error('[entrance-mcp]', ...args);
};

// ============================================================================
// Configuration
// ============================================================================

const WORKER_HOST = process.env.AI_ENTRANCE_WORKER_HOST || '127.0.0.1';
const WORKER_PORT = parseInt(process.env.AI_ENTRANCE_WORKER_PORT || '37778', 10);
const WORKER_BASE = `http://${WORKER_HOST}:${WORKER_PORT}`;

// Tool name → HTTP endpoint mapping
const TOOL_ENDPOINT_MAP: Record<string, { method: string; path: string }> = {
  search_knowledge:    { method: 'GET',  path: '/api/knowledge-assets/search' },
  get_asset:           { method: 'GET',  path: '/api/knowledge-assets/get' },
  list_assets:         { method: 'GET',  path: '/api/knowledge-assets/list' },
  sync_knowledge:      { method: 'POST', path: '/api/sync/trigger' },
  sink_knowledge:      { method: 'POST', path: '/api/knowledge/sink-asset' },
  read_config:         { method: 'GET',  path: '/api/config/read' },
  write_config:        { method: 'POST', path: '/api/config/write' },
  git_commit_push:     { method: 'POST', path: '/api/sync/commit-push' },
  filter_sensitive:    { method: 'POST', path: '/api/security/filter' },
  get_knowledge_stats: { method: 'GET',  path: '/api/stats/knowledge' },
};

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'search_knowledge',
    description: '搜索知识库资产。支持全文检索和过滤。Search knowledge assets with full-text search.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '搜索关键词 / Search query' },
        product_line: { type: 'string', description: '产品线过滤 / Product line filter (e.g. exchange/core)' },
        type: { type: 'string', description: '资产类型 / Asset type (pitfall, adr, best-practice, etc.)' },
        limit: { type: 'number', description: '返回数量 / Max results (default: 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_asset',
    description: '获取知识资产详情。Get knowledge asset details by ID or name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: '资产ID / Asset ID' },
        name: { type: 'string', description: '资产名称 / Asset name' },
        product_line: { type: 'string', description: '产品线 / Product line (required with name)' },
      },
    },
  },
  {
    name: 'list_assets',
    description: '列出知识资产。List knowledge assets with optional filters.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: '按类型过滤 / Filter by type' },
        product_line: { type: 'string', description: '按产品线过滤 / Filter by product line' },
        promoted: { type: 'boolean', description: '仅已推送 / Only promoted assets' },
        limit: { type: 'number', description: '返回数量 / Max results' },
      },
    },
  },
  {
    name: 'sync_knowledge',
    description: '触发知识同步 (L1 SQLite ↔ L2 Git)。Trigger sync between L1 cache and L2 repository.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        direction: {
          type: 'string',
          enum: ['pull', 'push', 'both'],
          description: '同步方向 / Sync direction (default: both)',
        },
        force: { type: 'boolean', description: '强制同步 / Force sync even if no changes' },
      },
    },
  },
  {
    name: 'sink_knowledge',
    description: '沉淀知识资产到L1缓存。Sink a new knowledge asset into L1 cache.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['pitfall', 'adr', 'glossary', 'best-practice', 'pattern', 'discovery', 'skill', 'reference'],
          description: '资产类型 / Asset type',
        },
        name: { type: 'string', description: '唯一标识名 / Unique slug name' },
        product_line: { type: 'string', description: '产品线 / Product line' },
        title: { type: 'string', description: '标题 / Title' },
        content: { type: 'string', description: '内容 / Content (markdown)' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签 / Tags' },
        source_project: { type: 'string', description: '来源项目 / Source project path' },
      },
      required: ['type', 'name', 'product_line', 'title', 'content'],
    },
  },
  {
    name: 'read_config',
    description: '读取配置值。Read a configuration value.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: '配置键名 / Config key' },
      },
      required: ['key'],
    },
  },
  {
    name: 'write_config',
    description: '写入配置值。Write a configuration value.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: '配置键名 / Config key' },
        value: { type: 'string', description: '配置值 / Config value' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'git_commit_push',
    description: '提交并推送L2知识仓库。Commit and push L2 knowledge repository.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: '提交信息 / Commit message' },
      },
    },
  },
  {
    name: 'filter_sensitive',
    description: '检测并过滤敏感信息。Detect and filter sensitive information from content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: '待检测内容 / Content to filter' },
        custom_patterns: {
          type: 'array',
          items: { type: 'string' },
          description: '自定义正则 / Custom regex patterns',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_knowledge_stats',
    description: '获取知识库统计信息。Get knowledge base statistics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_line: { type: 'string', description: '按产品线 / Filter by product line' },
      },
    },
  },
];

// ============================================================================
// HTTP Client Helper
// ============================================================================

function workerRequest(
  method: string,
  path: string,
  params: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let url = `${WORKER_BASE}${path}`;

    // For GET requests, convert params to query string
    if (method === 'GET' && Object.keys(params).length > 0) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          qs.append(key, String(value));
        }
      }
      url += `?${qs.toString()}`;
    }

    const urlObj = new URL(url);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch {
          resolve({ success: true, data });
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Worker request failed: ${err.message}. Is the worker service running on ${WORKER_BASE}?`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Worker request timed out'));
    });

    if (method !== 'GET') {
      req.write(JSON.stringify(params));
    }
    req.end();
  });
}

// ============================================================================
// Server Setup
// ============================================================================

async function main(): Promise<void> {
  const server = new Server(
    {
      name: 'ai-agent-entrance',
      version: '2.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args || {}) as Record<string, unknown>;

    const endpoint = TOOL_ENDPOINT_MAP[name];
    if (!endpoint) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: `Unknown tool: ${name}` }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await workerRequest(endpoint.method, endpoint.path, params);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: (error as Error).message }),
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log('MCP server started');
}

main().catch((error) => {
  console.error('MCP server failed to start:', error);
  process.exit(1);
});
