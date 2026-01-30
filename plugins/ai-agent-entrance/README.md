# AI Agent Entrance

**Version 2.2.0** - 智能路由与知识沉淀 Plugin，基于 Vercel agents.md 研究优化检索策略。

实现三层检索架构（L0 被动索引 + L1 交叉验证 + L2 详情获取），消除决策摩擦，提升知识检索成功率从 56% 到 90%+。

核心特性：
- **L0 被动索引**：SessionStart 自动注入压缩知识索引（~2.7KB），Agent 始终可见
- **L1 交叉验证**：search_knowledge() 返回 score + snippet，智能排序多候选
- **L2 详情获取**：get_asset() 按需获取完整内容，避免 token 浪费
- **L1↔L2 同步**：本地 SQLite 缓存与 Git 仓库双向同步

## 三层检索策略 (v2.2.0)

基于 [Vercel agents.md 研究](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)，优化知识检索流程：

```
┌─────────────────────────────────────────────────────┐
│ L0: 被动索引扫描（SessionStart 注入）                │
│ • AGENTS-INDEX.md (~2.7KB, 10 assets)              │
│ • 始终可见，无需主动调用                             │
│ • 快速判断：是否有相关文档？                          │
└────────────┬────────────────────────────────────────┘
             ↓
        决策点：评估 L0 结果
             ↓
    ┌────────┴────────┐
    │                 │
1-2 条精确匹配      3+ 条或不确定
    │                 │
    ↓                 ↓
┌─────────┐  ┌──────────────────────────────────┐
│ 跳过 L1 │  │ L1: 主动交叉验证                  │
│         │  │ • search_knowledge()             │
│         │  │ • 返回 score + snippet            │
│         │  │ • 语义排序多候选                   │
└────┬────┘  └────────┬──────────────────────────┘
     │                 │
     └────────┬────────┘
              ↓
┌─────────────────────────────────────────────────────┐
│ L2: 主动详情获取                                     │
│ • get_asset(name, product_line)                     │
│ • 返回完整 markdown 内容                             │
│ • 优先级：L1 score 排序 or L0 精确匹配               │
└─────────────────────────────────────────────────────┘
```

**关键优势：**
- ✅ 消除决策摩擦：索引始终可见，Agent 无需"想起"要搜索
- ✅ 按需加载：只在需要时调用 L1/L2，节省 token
- ✅ 智能排序：L1 交叉验证提供相关性分数和内容预览
- ✅ 检索成功率：从 56%（主动调用）提升到 90%+（被动可见）

## 核心功能

### 1. 智能路由

自动检测用户需求中的关键字，推荐最合适的开发流程：

| 任务类型 | 推荐工具 | 说明 |
|---------|---------|------|
| 新项目完整开发 | BMAD | 多角色敏捷流程 |
| 老项目优化/重构 | OpenSpec | 变更隔离模式 |
| 严格 SDD+TDD | Superpowers | 自动强制 TDD |
| 需求明确的功能 | SpecKit | 规格驱动开发 |
| Bug 修复/小改动 | Plan 模式 | 内置，无需安装 |

**自动安装**：如果推荐的工具未安装，会自动安装后继续。

### 2. L1 ↔ L2 知识同步架构 (v2.1.0)

双层缓存架构实现本地与远程知识的无缝同步：

```
┌─────────────────────────────────────────────────────────┐
│  L1 (Local Cache) - SQLite                              │
│  • FTS5 全文搜索                                          │
│  • knowledge_assets 表 (8 种类型)                        │
│  • 即时读写，低延迟                                       │
└─────────────┬───────────────────────────────────────────┘
              │ Sync Engine (pull/push/both)
              │ • Markdown ↔ SQLite 转换
              │ • Git operations (clone/pull/commit/push)
              │ • Conflict resolution (remote-wins 策略)
              ↓
┌─────────────────────────────────────────────────────────┐
│  L2 (Git Repository) - Persistent Storage               │
│  • compound-knowledge/ 目录结构                          │
│  • YAML frontmatter + Markdown body                     │
│  • 版本控制，团队共享，可发布                             │
└─────────────────────────────────────────────────────────┘
```

**Knowledge Assets** 支持 8 种类型：
- `skill` - 可复用技能
- `reference` - 参考文档
- `pitfall` - 踩坑记录
- `decision` - 架构决策 (ADR)
- `pattern` - 设计模式
- `api_spec` - API 规格
- `runbook` - 运维手册
- `other` - 其他

### 3. MCP Server (v2.1.0)

提供 10 个 MCP tools 用于知识管理和同步：

| Tool | 功能 |
|------|------|
| `search_knowledge` | FTS5 全文搜索知识资产 |
| `get_asset` | 获取单个知识资产详情 |
| `list_assets` | 列出知识资产（支持过滤） |
| `sync_knowledge` | 触发 L1↔L2 同步 (pull/push/both) |
| `sink_knowledge` | 创建新知识资产到 L1 |
| `read_config` | 读取配置 (L2_REPO_URL 等) |
| `write_config` | 写入配置 |
| `git_commit_push` | 手动 commit & push L2 |
| `filter_sensitive` | 检测/过滤敏感信息 |
| `get_knowledge_stats` | 获取知识资产统计 |

MCP 服务器自动通过 stdio 启动，无需手动配置。

### 4. 敏感信息过滤 (v2.1.0)

内置 13 种敏感信息检测规则：
- API keys (api_key, apikey)
- Passwords (password, passwd, pwd)
- Secrets (secret, client_secret)
- Tokens (token, access_token, refresh_token, Bearer)
- Private keys (PEM format)
- AWS credentials (AKIA*/ASIA*, aws_secret_access_key)
- Hex secrets (32+ 十六进制)
- Connection strings (mongodb://, postgres://, mysql://, redis://)
- JWT tokens
- GitHub tokens (ghp_*, gho_*, ghu_*, ghs_*, ghr_*)
- Slack tokens (xox[bpars]-*)

**用法**：
```typescript
// Via MCP tool
filter_sensitive({ content: "password=abc123", sanitize: true })
// Returns: { safe: false, findings: [...], sanitized: "password=[REDACTED]" }
```

### 5. Dashboard UI (v2.1.0)

访问 `http://localhost:37778` 查看可视化面板：

**统计卡片**：
- Observations - 观察记录总数
- Knowledge - 传统知识条目数
- Assets - L1 知识资产总数
- Promoted - 已同步到 L2 的资产数
- Sessions - 会话数
- Uptime - Worker 运行时间

**Sync Panel** (L1↔L2同步控制台)：
- Pull / Push / Sync Both 按钮
- L2 Repo URL 配置
- Auto Sync on Session Start 开关
- 同步状态实时显示

**Knowledge Assets Tab**：
- FTS5 全文搜索框
- 类型/产品线/晋升状态 过滤器
- 资产卡片展示（类型徽章、产品线徽章、L2 SYNCED 徽章）

## 安装

```bash
/plugin install ai-agent-entrance@ai-agent-entrance-marketplace
```

或从本地开发目录：

```bash
/plugin marketplace add /path/to/ai-agent-entrance-marketplace
/plugin install ai-agent-entrance@ai-agent-entrance-marketplace
```

## 使用

### 自动模式

安装后，每次启动 Claude Code 会自动激活：

1. **Worker Service** 在后台启动 (端口 37778)
2. **Auto Sync** 如果配置了 `L2_REPO_URL` 且启用了 `AUTO_SYNC_ON_SESSION_START`，会自动 pull L2 知识
3. **Context Injection** 注入路由分析和知识摘要到会话上下文

直接描述你的需求即可：

```
用户: 我想优化撮合引擎的延迟问题

AI: 🔍 检测结果：
    • 关键字: 撮合引擎、延迟、优化
    • 产品线: exchange/core
    • 任务类型: 性能优化

    🎯 推荐流程: OpenSpec
    ⚙️ 正在自动安装...
    ✅ 安装完成，启动 OpenSpec 流程
```

### 手动命令

#### 路由相关

```bash
/gateway                         # 查看路由建议
```

#### 知识沉淀（传统方式）

```bash
/knowledge                       # 自动检测类型
/knowledge pitfall               # 沉淀踩坑记录
/knowledge adr                   # 沉淀架构决策
/knowledge glossary              # 沉淀术语定义

/knowledge list                  # 查看待沉淀列表
/knowledge skip                  # 跳过当前提醒
/knowledge promote               # 将项目知识晋升到全局库
```

#### L1↔L2 同步 (v2.1.0)

```bash
/sync pull                       # 从 L2 拉取最新知识到 L1
/sync push                       # 将 L1 未晋升知识推送到 L2
/sync both                       # 双向同步 (先 pull 后 push)
/sync                            # 默认 both
```

#### MCP Tools (通过 Claude 调用)

```
用户: Search knowledge about "JWT authentication"
Claude: [调用 search_knowledge MCP tool]

用户: Sync my knowledge with the L2 repo
Claude: [调用 sync_knowledge MCP tool with direction="both"]
```

## 配置

### L2 Git 仓库配置

通过 Dashboard UI 或 MCP tools 配置：

```typescript
// Via MCP write_config tool
write_config({
  key: "L2_REPO_URL",
  value: "https://github.com/org/compound-knowledge.git"
})

write_config({
  key: "AUTO_SYNC_ON_SESSION_START",
  value: "true"
})

write_config({
  key: "SYNC_CONFLICT_STRATEGY",
  value: "remote-wins"  // or "local-wins"
})
```

或直接在 SQLite 数据库中：

```sql
INSERT INTO config (key, value, updated_at)
VALUES ('L2_REPO_URL', 'https://github.com/org/compound-knowledge.git', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
```

### 业务关键字 (config/biz-keywords.yaml)

自定义产品线关键字和任务类型识别规则。

### 路由规则 (config/workflow-routes.yaml)

自定义任务类型到开发工具的映射规则。

## 架构

### Worker Service (v2.0.0+)

独立的 Express HTTP 服务 + SQLite 持久化：

```
┌─────────────────────────────────────────────────┐
│  Claude Code Session                            │
│  ├─ SessionStart hook → worker-cli.cjs start    │
│  ├─ ToolUse hook → worker-cli.cjs record        │
│  └─ SessionStop hook → worker-cli.cjs stop      │
└──────────────┬──────────────────────────────────┘
               │ HTTP API (localhost:37778)
               ↓
┌─────────────────────────────────────────────────┐
│  Worker Service (worker-service.cjs)            │
│  ├─ Express routes (11 routes for v2.1.0)      │
│  ├─ DatabaseStore (better-sqlite3)              │
│  ├─ SyncEngine (L1↔L2 orchestration)            │
│  ├─ SensitiveFilter                             │
│  └─ CompressorService (optional)                │
└──────────────┬──────────────────────────────────┘
               │
               ↓
┌─────────────────────────────────────────────────┐
│  SQLite Database (~/.ai-agent-entrance/)        │
│  ├─ observations (FTS5)                         │
│  ├─ knowledge (legacy)                          │
│  ├─ knowledge_assets (FTS5, v2.1.0)             │
│  ├─ sync_log (v2.1.0)                           │
│  └─ config (v2.1.0)                             │
└─────────────────────────────────────────────────┘
```

### 目录结构

```
ai-agent-entrance/
├── .claude-plugin/
│   └── plugin.json              # Plugin 元数据
├── .mcp.json                    # MCP server 配置 (v2.1.0)
├── hooks/
│   ├── hooks.json               # Lifecycle hooks 配置
│   └── session-*.sh             # Hook 脚本
├── skills/
│   ├── agent-router/            # 智能路由 Skill
│   └── knowledge-sink/          # 知识沉淀 Skill
├── commands/
│   ├── gateway.md               # /gateway 命令
│   ├── knowledge.md             # /knowledge 命令
│   └── sync.md                  # /sync 命令 (v2.1.0)
├── scripts/
│   ├── worker-service.cjs       # Worker 主服务 (Express + SQLite)
│   ├── worker-cli.cjs           # Worker CLI 客户端
│   ├── entrance-mcp-server.cjs  # MCP Server (v2.1.0)
│   └── smart-install.js         # 依赖自动安装
├── ui/
│   └── dashboard.html           # Web Dashboard (v2.1.0 更新)
├── config/
│   ├── biz-keywords.yaml        # 业务关键字
│   └── workflow-routes.yaml     # 路由规则
└── templates/
    ├── pitfall.md               # 踩坑记录模板
    ├── adr.md                   # 架构决策模板
    ├── glossary.md              # 术语定义模板
    └── best-practice.md         # 最佳实践模板
```

### L2 Repository Structure

当配置了 L2 Git 仓库后，会创建以下目录结构：

```
compound-knowledge/
├── knowledge/
│   ├── _index.json              # 索引文件（自动生成）
│   ├── exchange/                # Exchange 产品线
│   │   ├── skills/
│   │   ├── references/
│   │   ├── pitfalls/
│   │   ├── decisions/
│   │   └── ...
│   ├── custody/                 # Custody 产品线
│   ├── infra/                   # Infra 产品线
│   └── general/                 # 通用知识
└── README.md
```

每个知识资产文件格式：

```markdown
---
type: skill
name: jwt-auth-pattern
product_line: exchange
tags: authentication, security, jwt
title: JWT Authentication Pattern
source_project: exchange-api
---

# JWT Authentication Pattern

[Markdown content here...]
```

## API Reference

### Worker Service HTTP API

Base URL: `http://localhost:37778`

#### Knowledge Assets (v2.1.0)

- `GET /api/knowledge-assets/search?query=...&type=...&product_line=...` - FTS5 搜索
- `GET /api/knowledge-assets/get?id=123` - 获取单个资产
- `GET /api/knowledge-assets/list?type=...&product_line=...&promoted=...&limit=50` - 列表查询
- `POST /api/knowledge/sink-asset` - 创建知识资产

#### Sync Operations (v2.1.0)

- `POST /api/sync/trigger` - 触发同步 `{ direction: "pull"|"push"|"both" }`
- `POST /api/sync/commit-push` - 手动 commit & push

#### Config (v2.1.0)

- `GET /api/config/read` - 读取所有配置
- `POST /api/config/write` - 写入配置 `{ key: "L2_REPO_URL", value: "..." }`

#### Security (v2.1.0)

- `POST /api/security/filter` - 敏感信息检测 `{ content: "...", sanitize: true }`

#### Stats (v2.1.0)

- `GET /api/stats/knowledge` - 知识资产统计（按类型、产品线、晋升状态）

#### Legacy Routes (v2.0.0)

- `GET /api/health` - 健康检查
- `GET /api/observations` - 观察记录列表
- `GET /api/knowledge` - 传统知识列表
- `POST /api/observations` - 创建观察记录
- `POST /api/knowledge` - 创建知识条目
- `POST /api/sessions/start` - 开始会话
- `POST /api/sessions/stop` - 结束会话

## Troubleshooting

### Worker Service 未启动

```bash
# 手动启动
node ~/.claude/plugins/cache/ai-agent-entrance-marketplace/ai-agent-entrance/2.1.0/scripts/worker-cli.cjs start

# 检查状态
node ~/.claude/plugins/cache/ai-agent-entrance-marketplace/ai-agent-entrance/2.1.0/scripts/worker-cli.cjs status
```

### MCP Server 连接失败

检查 `.mcp.json` 配置和 `entrance-mcp-server.cjs` 文件是否存在：

```bash
ls ~/.claude/plugins/cache/ai-agent-entrance-marketplace/ai-agent-entrance/2.1.0/.mcp.json
ls ~/.claude/plugins/cache/ai-agent-entrance-marketplace/ai-agent-entrance/2.1.0/scripts/entrance-mcp-server.cjs
```

### L2 Sync 失败

1. 检查 `L2_REPO_URL` 配置是否正确
2. 确保有 Git 仓库的访问权限
3. 查看 `sync_log` 表了解错误详情

```sql
SELECT * FROM sync_log ORDER BY created_at_epoch DESC LIMIT 10;
```

### Dashboard 无法访问

确认 Worker Service 在运行且监听 37778 端口：

```bash
curl http://localhost:37778/api/health
# 期望输出: {"success":true,"version":"2.1.0","uptime":...}
```

## Development

### Build from Source

```bash
npm install
npm run build
```

Build 产物：
- `plugins/ai-agent-entrance/scripts/worker-service.cjs`
- `plugins/ai-agent-entrance/scripts/worker-cli.cjs`
- `plugins/ai-agent-entrance/scripts/entrance-mcp-server.cjs`

### Testing

```bash
npm test
```

（测试框架使用 Node.js built-in test runner + tsx）

## Changelog

### v2.1.0 (2026-01-27)

- ✨ 添加 L1↔L2 双层知识同步架构
- ✨ 新增 Knowledge Assets 实体类型（8 种）
- ✨ 添加 MCP Server（10 个 tools）
- ✨ 添加敏感信息过滤器（13 种规则）
- ✨ 更新 Dashboard UI（Sync Panel + Assets Tab）
- ✨ 新增 `/sync` 命令
- 🔧 数据库 schema v1→v2 迁移
- 🔧 Worker Service 新增 11 个 API routes

### v2.0.0 (2025-01-23)

- ♻️ 架构重构：Worker Service 模式
- ✨ SQLite 持久化存储
- ✨ Web Dashboard
- ✨ 自动依赖安装

### v1.0.0 (2024-12-XX)

- 🎉 初始发布
- ✨ 智能路由
- ✨ 知识沉淀

## License

MIT

## Author

Larry Yan ([@LeiYanAdmin](https://github.com/LeiYanAdmin))

## Repository

https://github.com/LeiYanAdmin/ai-agent-entrance-marketplace
