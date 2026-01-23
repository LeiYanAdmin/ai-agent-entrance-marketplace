---
name: knowledge-sink
description: This skill should be used to capture and persist valuable knowledge from conversations into CLAUDE.md (project-level) or the global Git knowledge repository (~/compound-knowledge).
---

# Knowledge Sink - 知识沉淀 Skill

## 核心职责

1. **内容分类**：识别知识类型（踩坑/决策/术语）
2. **目标选择**：确定沉淀到项目级还是全局级
3. **格式化输出**：使用模板生成标准化内容
4. **持久化存储**：写入文件并可选提交 Git

## 沉淀流程

```
触发沉淀（手动 /knowledge 或自动检测）
    ↓
┌─────────────────────────────────────┐
│ 1. 内容分类                          │
│    • pitfall: 踩坑记录               │
│    • adr: 架构决策记录               │
│    • glossary: 术语定义              │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 2. 提取关键信息                      │
│    • 问题/决策/术语名称              │
│    • 相关上下文                      │
│    • 产品线分类                      │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 3. 选择沉淀目标                      │
│    • 项目级: ./CLAUDE.md            │
│    • 全局级: ~/compound-knowledge/  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 4. 使用模板格式化                    │
│    • templates/pitfall.md           │
│    • templates/adr.md               │
│    • templates/glossary.md          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 5. 写入并提交（可选）                 │
│    • 写入目标文件                    │
│    • git add && git commit          │
└─────────────────────────────────────┘
```

## 双层知识架构

### 项目级（./CLAUDE.md）

存放内容：
- 项目特定配置和路径
- 本地环境相关的踩坑记录
- 临时性决策
- 项目专用术语

### 全局级（~/compound-knowledge/）

存放内容：
- 通用最佳实践
- 跨项目可复用的踩坑经验
- 技术选型决策
- 通用术语定义

目录结构：
```
~/compound-knowledge/
├── exchange/
│   ├── core/
│   │   ├── pitfalls/
│   │   ├── decisions/
│   │   └── glossary/
│   ├── spot/
│   ├── futures/
│   └── liquidity/
├── custody/
│   ├── mpc/
│   ├── wallet/
│   └── compliance/
├── infra/
│   ├── blockchain/
│   └── devops/
└── README.md
```

## 沉淀目标选择规则

| 内容特征 | 沉淀目标 | 示例 |
|---------|---------|------|
| 包含本地路径 | 项目级 | `/Users/xxx/project` |
| 包含项目特定配置 | 项目级 | 项目专用环境变量 |
| 通用技术问题 | 全局级 | MPC 签名超时处理 |
| 架构决策 | 项目级 → 可晋升 | 选择 Redis 做缓存 |
| 术语定义 | 全局级 | "冷钱包" 定义 |

## 交互格式

### 自动检测提示

```
💡 检测到可沉淀内容：

   类型: 踩坑记录
   摘要: MPC 签名在高并发下超时
   关键字: MPC, 签名, 超时

   [立即沉淀] [稍后处理] [忽略]
```

### 手动沉淀交互

```
用户: /knowledge pitfall

📝 请描述踩坑内容：

**问题现象**: [从对话中提取或请用户补充]
**根本原因**: [从对话中提取或请用户补充]
**解决方案**: [从对话中提取或请用户补充]

🎯 沉淀目标:
   [1] 项目级 - ./CLAUDE.md
   [2] 全局级 - ~/compound-knowledge/custody/mpc/

请选择 [1/2]:
```

### 沉淀完成确认

```
✅ 知识已沉淀

   类型: 踩坑记录
   位置: ~/compound-knowledge/custody/mpc/pitfalls/mpc-signing-timeout.md

   已自动提交: git commit -m "Add pitfall: MPC signing timeout"
```

## 待沉淀队列

当用户未立即处理沉淀提示时，记录到待沉淀队列：

文件位置：`~/.ai-agent-entrance/pending-sink.json`

```json
{
  "session_id": "abc123",
  "timestamp": "2024-01-23T10:30:00Z",
  "project": "/path/to/current/project",
  "items": [
    {
      "type": "pitfall",
      "summary": "MPC 签名在高并发下超时",
      "keywords": ["MPC", "签名", "超时"],
      "product_line": "custody/mpc",
      "context_snippet": "原来是默认超时时间30s不够..."
    }
  ]
}
```

下次会话开始时（SessionStart 钩子）会提醒处理待沉淀内容。

## 知识晋升

将项目级知识晋升到全局级：

```
用户: /knowledge promote

📤 可晋升的项目知识：

   1. [pitfall] Redis 连接池配置不当导致超时
   2. [adr] 选择 Kafka 而非 RocketMQ

选择要晋升的条目 [1/2/all]:
```

晋升时会：
1. 移除项目特定信息
2. 泛化为通用描述
3. 添加到全局知识库
4. 可选：从项目 CLAUDE.md 中移除原条目
