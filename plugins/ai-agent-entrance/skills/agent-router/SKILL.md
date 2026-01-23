---
name: agent-router
description: This skill should be used at the start of every conversation to detect the user's intent, identify relevant business keywords, and recommend the optimal development workflow. It automatically installs missing tools when needed.
---

# Agent Router - 智能路由 Skill

## 核心职责

1. **关键字检测**：扫描用户输入，匹配业务关键字
2. **流程推荐**：基于任务类型推荐最佳开发流程
3. **自动安装**：检测到最佳工具未安装时自动安装
4. **知识触发**：检测可沉淀内容，提示或记录待沉淀

## 执行流程

```
用户输入
    ↓
┌─────────────────────────────────────┐
│ 1. 关键字匹配                        │
│    • 产品线识别 (exchange/custody/infra)
│    • 任务类型识别 (新功能/优化/重构/bug)
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 2. 流程推荐                          │
│    • 根据任务类型确定最佳工具         │
│    • 检查工具是否已安装              │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 3. 自动安装（如需要）                 │
│    • 执行安装命令                    │
│    • 验证安装成功                    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 4. 启动推荐流程                      │
└─────────────────────────────────────┘
```

## 路由规则

### 任务类型 → 推荐工具

| 任务类型 | 关键字 | 推荐工具 | 安装命令 |
|---------|-------|---------|---------|
| 新项目完整开发 | 新项目、从零开始、完整流程 | BMAD | `npx bmad-method install` |
| 老项目优化/重构 | 优化、重构、改造、迁移 | OpenSpec | `claude plugin install openspec` |
| 严格 SDD+TDD | TDD、测试驱动、省Token | Superpowers | `claude plugin install superpowers` |
| 需求明确的功能 | 规格、明确需求、spec | SpecKit | `claude plugin install speckit` |
| Bug 修复/小改动 | bug、修复、问题、小改 | Plan 模式 | 无需安装（内置） |
| 调研分析 | 调研、分析、评估 | Plan 模式 | 无需安装（内置） |

### Superpowers 优先规则

**重要**：如果检测到 Superpowers 已安装，对于所有开发类任务，优先让 Superpowers 接管：

```
if superpowers_installed && task_is_development:
    output: "✅ Superpowers 已安装，将自动引导 SDD+TDD 流程"
    defer_to_superpowers()
```

## 交互格式

### 标准输出格式

```
🔍 **检测结果：**
   • 关键字: [匹配到的关键字]
   • 产品线: [product_line/category]
   • 任务类型: [task_type]

🎯 **推荐流程: [工具名称]**
   原因: [推荐理由]

   [接受推荐] [使用 Plan 模式] [其他选项]
```

### 需要安装时的输出

```
🔍 **检测结果：**
   • 任务类型: 老项目重构

🎯 **推荐流程: OpenSpec**
   原因: 老项目改造适合变更隔离模式

⚙️ OpenSpec 未安装，正在自动安装...
   > claude plugin install openspec
   ✅ 安装完成

🚀 启动 OpenSpec 流程...
```

## 知识沉淀检测

在对话过程中，持续检测以下触发词：

### 踩坑记录触发词
- 踩坑、坑、注意、小心、原来是、居然是、没想到

### 架构决策触发词
- 决定用、选择、方案、架构、设计、权衡

### 术语定义触发词
- 是什么、什么是、定义、术语、概念

检测到时提示：
```
💡 检测到可沉淀内容（踩坑记录）
   输入 `/knowledge pitfall` 立即沉淀
```

## 配置文件引用

- 业务关键字：`config/biz-keywords.yaml`
- 路由规则：`config/workflow-routes.yaml`
