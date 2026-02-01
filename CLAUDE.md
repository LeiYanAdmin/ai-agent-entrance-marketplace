# AI Agent Entrance Marketplace

Claude Code 插件：智能路由与知识沉淀。

## 开发同步

修改源代码后，需要同步到 Claude Code 的 plugin 安装目录：

```bash
# 同步到 marketplace 目录
cp -r plugins/ai-agent-entrance/* ~/.claude/plugins/marketplaces/ai-agent-entrance-marketplace/plugins/ai-agent-entrance/

# 同步到 cache 目录（当前版本 2.2.0）
cp -r plugins/ai-agent-entrance/* ~/.claude/plugins/cache/ai-agent-entrance-marketplace/ai-agent-entrance/2.2.0/

# 重启 worker 服务
node ~/.claude/plugins/cache/ai-agent-entrance-marketplace/ai-agent-entrance/2.2.0/scripts/worker-cli.cjs restart
```

或者使用 npm script：

```bash
npm run sync-plugin
```

## 构建

```bash
npm run build
```

## 项目结构

```
src/
├── cli/                 # CLI 工具 (worker-cli)
├── mcp/                 # MCP Server (entrance-mcp-server)
├── services/
│   ├── ai/              # AI 压缩服务
│   ├── database/        # SQLite 存储
│   ├── index/           # AGENTS-INDEX.md 生成
│   ├── infrastructure/  # 进程管理
│   ├── security/        # 敏感信息过滤
│   └── sync/            # L1↔L2 同步引擎
├── shared/              # 共享配置和类型
└── utils/               # 日志工具

plugins/ai-agent-entrance/
├── hooks/               # Claude Code hooks 配置
├── skills/              # 自定义 skills
├── scripts/             # 构建后的 CJS 脚本
└── config/              # 业务关键字配置
```
