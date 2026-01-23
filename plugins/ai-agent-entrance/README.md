# AI Agent Entrance

智能路由与知识沉淀 Plugin - 自动识别任务类型、推荐最佳开发流程、沉淀可复用知识。

## 功能特性

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

### 2. 知识沉淀

自动或手动将对话中的有价值知识沉淀到知识库：

- **项目级**: `./CLAUDE.md` - 项目特定知识
- **全局级**: `~/compound-knowledge/` - 跨项目共享知识

支持的知识类型：
- 踩坑记录 (pitfall)
- 架构决策 (adr)
- 术语定义 (glossary)
- 最佳实践 (best-practice)

## 安装

```bash
claude plugin install ai-agent-entrance
```

或从本地安装（开发时）：

```bash
claude plugin install /path/to/ai-agent-entrance
```

## 使用

### 自动模式

安装后，每次启动 Claude Code 会自动激活智能路由。直接描述你的需求即可：

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

```bash
# 查看路由建议
/gateway

# 手动触发知识沉淀
/knowledge                    # 自动检测类型
/knowledge pitfall           # 沉淀踩坑记录
/knowledge adr               # 沉淀架构决策
/knowledge glossary          # 沉淀术语定义

# 管理待沉淀队列
/knowledge list              # 查看待沉淀列表
/knowledge skip              # 跳过当前提醒

# 知识晋升
/knowledge promote           # 将项目知识晋升到全局库
```

## 配置

### 业务关键字 (config/biz-keywords.yaml)

自定义产品线关键字和任务类型识别规则。

### 路由规则 (config/workflow-routes.yaml)

自定义任务类型到开发工具的映射规则。

## 目录结构

```
ai-agent-entrance/
├── .claude-plugin/
│   └── plugin.json           # Plugin 元数据
├── hooks/
│   ├── hooks.json            # 钩子配置
│   └── session-start.sh      # SessionStart 钩子
├── skills/
│   ├── agent-router/         # 智能路由 Skill
│   └── knowledge-sink/       # 知识沉淀 Skill
├── commands/
│   ├── gateway.md            # /gateway 命令
│   └── knowledge.md          # /knowledge 命令
├── config/
│   ├── biz-keywords.yaml     # 业务关键字
│   └── workflow-routes.yaml  # 路由规则
└── templates/
    ├── pitfall.md            # 踩坑记录模板
    ├── adr.md                # 架构决策模板
    ├── glossary.md           # 术语定义模板
    └── best-practice.md      # 最佳实践模板
```

## 知识沉淀架构

```
对话中产生知识
       ↓
自动检测（业务关键字）
       ↓
  ┌────┴────┐
  ↓         ↓
项目级      全局级
CLAUDE.md   ~/compound-knowledge/
            └→ 可发布、可共享、可迭代
```

## License

MIT

## Author

Larry Yan - https://github.com/yanlei-chainup
