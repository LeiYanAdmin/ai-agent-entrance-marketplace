# AI-Agent-Entrance 升级计划

> 基于 Claude-Mem 官方架构文档 (https://docs.claude-mem.ai) 的改进方案

## 📖 Claude-Mem 架构关键学习

### 完整的 6 个钩子 + 1 个 Pre-Hook

```
┌─────────────────────────────────────────────────────────────────┐
│ 0. Smart Install Pre-Hook                                       │
│    缓存依赖检查，仅版本变化时运行                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. SessionStart (context-hook.ts)                               │
│    启动 Bun worker + 注入前序会话上下文                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. UserPromptSubmit (new-hook.ts)                               │
│    创建会话 + 保存原始 prompt 到 FTS5                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. PostToolUse (save-hook.ts) × 100+ 次                         │
│    捕获工具执行 → 发送到 Worker → AI 压缩                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Worker 处理 (Claude Agent SDK)                               │
│    迭代式 AI 处理 → 提取结构化学习                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Stop (summary-hook.ts)                                       │
│    生成会话总结 (request, completions, learnings)                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. SessionEnd (cleanup-hook.ts)                                 │
│    标记会话完成 (graceful，不是 DELETE)                          │
│    /clear 时跳过，保留进行中的会话                                │
└─────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|---|------|
| 语言 | TypeScript (ES2022, ESNext modules) |
| 运行时 | Node.js 18+ |
| 数据库 | SQLite 3 + bun:sqlite |
| 向量存储 | ChromaDB (可选) |
| HTTP 服务 | Express.js 4.18 |
| 实时通信 | Server-Sent Events (SSE) |
| AI SDK | @anthropic-ai/claude-agent-sdk |
| 构建工具 | esbuild |
| 进程管理 | Bun |

### 数据流

```
Memory Pipeline:
Hook (stdin) → Database → Worker Service → SDK Processor → Database → Next Session Hook

Search Pipeline:
User Query → MCP Tools → HTTP API → SessionSearch → FTS5 → Claude
```

---

## 📊 当前架构 vs 目标架构

### 当前状态 (v1.0)

```
┌─────────────────────────────────────────────────┐
│ ai-agent-entrance v1.0                          │
├─────────────────────────────────────────────────┤
│ Hooks:                                          │
│   └── SessionStart only (静态 shell 脚本)        │
│                                                 │
│ Skills:                                         │
│   ├── agent-router (智能路由)                    │
│   └── knowledge-sink (手动知识沉淀)              │
│                                                 │
│ Commands:                                       │
│   ├── /gateway (显示路由分析)                    │
│   └── /knowledge (手动触发知识沉淀)              │
│                                                 │
│ 存储: 无 (直接写入 CLAUDE.md)                    │
└─────────────────────────────────────────────────┘
```

### 目标架构 (v2.0)

```
┌─────────────────────────────────────────────────┐
│ ai-agent-entrance v2.0                          │
├─────────────────────────────────────────────────┤
│ Worker Service (HTTP API @ port 37778)          │
│   ├── /api/context/inject (上下文注入)           │
│   ├── /api/session/init (会话初始化)             │
│   ├── /api/observation/capture (观察捕获)        │
│   ├── /api/knowledge/summarize (知识总结)        │
│   └── /api/health (健康检查)                     │
├─────────────────────────────────────────────────┤
│ 5 Lifecycle Hooks:                              │
│   ├── SessionStart → 启动 Worker + 注入上下文    │
│   ├── UserPromptSubmit → 初始化会话              │
│   ├── PostToolUse → 捕获工具调用观察             │
│   ├── Stop → 生成会话总结                        │
│   └── SessionEnd → 清理资源 (可选)               │
├─────────────────────────────────────────────────┤
│ Dual Database:                                  │
│   ├── SQLite + FTS5 (全文检索)                   │
│   └── ChromaDB (语义向量搜索)                    │
├─────────────────────────────────────────────────┤
│ AI Compression:                                 │
│   └── SDKAgent (语义压缩 + 结构化提取)           │
├─────────────────────────────────────────────────┤
│ MCP Server:                                     │
│   └── knowledge-search (知识检索工具)            │
└─────────────────────────────────────────────────┘
```

## 🎯 核心升级项

### 1. 完整的生命周期钩子 (5 Hooks)

**从 claude-mem 学到**：每个钩子都委托给 Worker Service HTTP API。

```json
// hooks/hooks.json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js start" },
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook context-inject" },
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook show-routing" }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook session-init" },
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook detect-keywords" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook capture-observation" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook generate-summary" },
          { "type": "command", "command": "node ${PLUGIN_ROOT}/scripts/worker.js hook auto-sink-knowledge" }
        ]
      }
    ]
  }
}
```

### 2. Worker Service (HTTP API)

**架构设计**：

```
src/
├── services/
│   ├── worker-service.ts          # Express HTTP Server (port 37778)
│   ├── database/
│   │   ├── sqlite.ts              # SQLite + FTS5 管理
│   │   ├── types.ts               # 数据实体类型
│   │   └── migrations.ts          # 数据库迁移
│   ├── sync/
│   │   └── chroma-sync.ts         # ChromaDB 向量同步
│   ├── ai/
│   │   ├── sdk-agent.ts           # AI 语义压缩
│   │   └── prompts/               # 压缩提示词模板
│   └── infrastructure/
│       ├── process-manager.ts     # 进程管理 (PID, 守护进程)
│       └── health-monitor.ts      # 健康检查
├── hooks/
│   ├── context-hook.ts            # SessionStart 钩子
│   ├── session-hook.ts            # UserPromptSubmit 钩子
│   ├── observation-hook.ts        # PostToolUse 钩子
│   └── summary-hook.ts            # Stop 钩子
└── cli/
    └── worker-cli.ts              # CLI 入口 (start/stop/hook)
```

### 3. 渐进式披露 (Progressive Disclosure)

**3 层检索策略**：

```typescript
// MCP 工具定义
{
  "search": {
    description: "搜索知识库，返回索引（~50-100 tokens/结果）",
    returns: "{ id, title, type, date, project }[]"
  },
  "timeline": {
    description: "获取某条记录周围的上下文",
    returns: "{ before: [], target: {}, after: [] }"
  },
  "get_full": {
    description: "获取指定 ID 的完整详情",
    returns: "完整的观察/总结内容"
  }
}
```

**Token 节约**：
- 搜索 100 条记录：~5,000 tokens (索引) vs ~50,000 tokens (完整)
- 节约 10x tokens！

### 4. AI 驱动的语义压缩

**观察结构**：

```typescript
interface Observation {
  id: number;
  session_id: string;
  project: string;
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'pitfall';

  // AI 提取的结构化字段
  title: string;           // 简短标题
  subtitle: string;        // 副标题/上下文
  facts: string[];         // 关键事实列表
  narrative: string;       // 叙述性描述
  concepts: string[];      // 相关概念标签
  files_read: string[];    // 读取的文件
  files_modified: string[];// 修改的文件

  // 元数据
  prompt_number: number;   // 第几轮对话
  discovery_tokens: number;// 发现这条知识消耗的 tokens
  created_at: string;
}
```

**压缩 Prompt 示例**：

```typescript
const COMPRESSION_PROMPT = `
你是知识提取专家。分析以下工具调用结果，提取可复用的知识。

输入：
- 工具名称: {tool_name}
- 工具输入: {tool_input}
- 工具输出: {tool_output}
- 当前项目: {project}

输出 JSON：
{
  "type": "decision|bugfix|feature|refactor|discovery|pitfall",
  "title": "简短标题（10字以内）",
  "subtitle": "上下文描述（20字以内）",
  "facts": ["关键事实1", "关键事实2"],
  "narrative": "完整描述（50字以内）",
  "concepts": ["概念标签1", "概念标签2"],
  "files_modified": ["path/to/file.ts"],
  "should_store": true/false  // 是否值得存储
}

规则：
1. 只提取有长期价值的知识
2. 忽略临时性操作（ls, cat 单个文件等）
3. 重点关注：架构决策、踩坑记录、最佳实践、术语定义
`;
```

### 5. 双数据库存储

**SQLite Schema**：

```sql
-- 会话表
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE,
  project TEXT,
  created_at TEXT,
  created_at_epoch INTEGER
);

-- 观察表 (FTS5 全文搜索)
CREATE VIRTUAL TABLE observations_fts USING fts5(
  title, subtitle, facts, narrative, concepts,
  content='observations', content_rowid='id'
);

CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  project TEXT,
  type TEXT,
  title TEXT,
  subtitle TEXT,
  facts TEXT,      -- JSON array
  narrative TEXT,
  concepts TEXT,   -- JSON array
  files_read TEXT, -- JSON array
  files_modified TEXT,
  prompt_number INTEGER,
  discovery_tokens INTEGER,
  created_at TEXT,
  created_at_epoch INTEGER
);

-- 会话总结表
CREATE TABLE session_summaries (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  project TEXT,
  request TEXT,
  investigated TEXT,
  learned TEXT,
  completed TEXT,
  next_steps TEXT,
  files_read TEXT,
  files_edited TEXT,
  created_at TEXT,
  created_at_epoch INTEGER
);
```

**ChromaDB 集成**：

```typescript
class ChromaSync {
  async syncObservation(obs: Observation): Promise<void> {
    const documents = this.splitToDocuments(obs);
    // 分字段存储，提高检索精度
    // - title_doc: 标题向量
    // - facts_doc: 事实列表向量
    // - narrative_doc: 叙述向量
    await this.collection.add(documents);
  }

  async semanticSearch(query: string): Promise<SearchResult[]> {
    return await this.collection.query({
      queryTexts: [query],
      nResults: 10
    });
  }
}
```

### 6. 自动上下文注入

**SessionStart 注入的内容**：

```typescript
async function injectContext(): Promise<string> {
  const project = getCurrentProject();

  // 1. 获取最近活动
  const recentActivity = await db.getRecentObservations(project, 10);

  // 2. 获取相关知识 (基于最近的文件/概念)
  const relatedKnowledge = await searchRelevantKnowledge(project);

  // 3. 格式化输出
  return formatContextForClaude({
    recentActivity,
    relatedKnowledge,
    installedTools: await getInstalledTools()
  });
}
```

**输出格式**：

```markdown
<ai-agent-entrance>
# 🧠 智能路由已激活

## 最近活动
| 时间 | 类型 | 标题 |
|-----|------|-----|
| 5分钟前 | 🔵 feature | 添加用户认证功能 |
| 1小时前 | 🔴 bugfix | 修复登录循环问题 |

## 已安装工具
- superpowers ✅
- compound-engineering ✅

## 相关知识
- [#1234] JWT 认证最佳实践
- [#1235] Rails session 管理
</ai-agent-entrance>
```

## 📁 目录结构升级

```
ai-agent-entrance-marketplace/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/ai-agent-entrance/
    ├── .claude-plugin/
    │   ├── plugin.json
    │   └── .mcp.json              # MCP 服务器配置 (新增)
    ├── hooks/
    │   └── hooks.json             # 5 个生命周期钩子 (升级)
    ├── scripts/                   # 构建后的 JS 脚本 (新增)
    │   ├── worker.cjs             # Worker 服务
    │   ├── mcp-server.cjs         # MCP 搜索服务
    │   └── smart-install.js       # 智能安装脚本
    ├── skills/
    │   ├── agent-router/SKILL.md
    │   └── knowledge/SKILL.md     # 重命名
    ├── commands/
    │   ├── gateway.md
    │   └── knowledge.md
    ├── config/
    │   ├── biz-keywords.yaml
    │   └── workflow-routes.yaml
    └── templates/
        ├── pitfall.md
        ├── adr.md
        ├── glossary.md
        └── best-practice.md

# 源码目录 (开发时)
src/
├── services/
│   ├── worker-service.ts
│   ├── database/
│   ├── sync/
│   ├── ai/
│   └── infrastructure/
├── hooks/
├── cli/
├── mcp/
│   └── knowledge-search.ts        # MCP 搜索服务
└── utils/
```

## 🚀 实施路线图

### Phase 1: Worker Service 基础 (1-2天)

1. 创建 Express HTTP 服务框架
2. 实现进程管理 (start/stop/status)
3. 添加健康检查端点
4. 配置 PID 文件管理

### Phase 2: 数据库层 (1-2天)

1. 设计 SQLite schema
2. 实现 FTS5 全文搜索
3. 创建数据库迁移系统
4. 添加基本 CRUD 操作

### Phase 3: 生命周期钩子 (1天)

1. 重构 hooks.json (5 个钩子)
2. 实现每个钩子的 HTTP 调用
3. 测试钩子触发流程

### Phase 4: AI 压缩 (1-2天)

1. 集成 Claude Agent SDK
2. 设计压缩 prompt
3. 实现 PostToolUse 观察捕获
4. 实现 Stop 总结生成

### Phase 5: 向量搜索 (可选, 1天)

1. 集成 ChromaDB
2. 实现实时同步
3. 添加语义搜索 API

### Phase 6: MCP 服务器 (1天)

1. 创建 MCP 搜索工具
2. 实现 3 层检索 API
3. 配置 .mcp.json

## ⚠️ 关键差异点

| 方面 | Claude-Mem | AI-Agent-Entrance |
|-----|-----------|-------------------|
| **核心目标** | 通用记忆系统 | 智能路由 + 知识沉淀 |
| **存储范围** | 所有工具调用 | 仅有价值的知识 |
| **输出格式** | Session 回顾 | 可复用的文档模板 |
| **集成目标** | 读取历史 | 指导当前决策 |
| **端口** | 37777 | 37778 |

## 📌 保留的原有功能

1. **智能路由** - 基于关键字检测推荐工作流
2. **工具自动安装** - 检测并安装推荐工具
3. **知识模板** - pitfall/adr/glossary/best-practice
4. **双层沉淀** - 项目级 + 全局知识库
5. **/gateway** 和 **/knowledge** 命令

## 📝 Claude-Mem 实现模式学习

### Smart Install 模式

```javascript
// smart-install.js 关键模式
const MARKER = join(ROOT, '.install-version');

function needsInstall() {
  if (!existsSync(join(ROOT, 'node_modules'))) return true;
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  const marker = JSON.parse(readFileSync(MARKER, 'utf-8'));
  return pkg.version !== marker.version;
}

// 自动重启 Worker
if (needsInstall()) {
  installDeps();
  // 通过 HTTP API 优雅关闭旧 Worker
  execSync(`curl -s -X POST http://127.0.0.1:${port}/api/admin/shutdown`);
  // 新 Worker 由下一个 hook 启动
}
```

### Worker CLI 模式

```javascript
// worker-cli.js 关键模式
const O = '{"continue": true, "suppressOutput": true}';  // Hook 输出
const A = stdin.isTTY;  // TTY 检测

switch (command) {
  case 'start':
    const result = await WorkerManager.start(port);
    console.log(A ? `Worker started (PID: ${result.pid})` : O);
    break;
  // ...
}
```

### Hook 输出协议

```json
// SessionStart hook 输出格式
{
  "continue": true,
  "suppressOutput": true,
  "hookSpecificOutput": "# Context injection content..."
}
```

### PID 文件管理

```typescript
// ~/.claude-mem/worker.pid
{
  "pid": 12345,
  "port": 37777,
  "startedAt": "2025-01-25T12:00:00.000Z",
  "version": "7.5.0"
}
```

---

## 🎯 下一步行动

### 选项 A: 轻量级升级 (推荐)

保持简单，只添加关键功能：

1. **添加 UserPromptSubmit 钩子** - 检测关键字
2. **添加 Stop 钩子** - 自动提示知识沉淀
3. **改进路由显示** - 更好的格式化

预计工作量：1 天

### 选项 B: 中等升级

添加持久化存储：

1. 选项 A 的全部内容
2. **添加 SQLite 存储** - 保存检测到的知识点
3. **添加 /knowledge search 命令** - 搜索历史知识

预计工作量：2-3 天

### 选项 C: 完整升级

完全对标 claude-mem 架构：

1. 选项 B 的全部内容
2. **Worker Service HTTP API**
3. **AI 语义压缩**
4. **ChromaDB 向量搜索**
5. **MCP 搜索工具**

预计工作量：5-7 天

---

## 📋 建议的实施顺序

1. **先完成选项 A** - 验证钩子机制
2. **用户测试反馈** - 确认价值
3. **根据反馈决定** - 是否继续升级
