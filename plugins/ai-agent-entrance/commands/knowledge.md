---
name: knowledge
description: Manually trigger knowledge sinking - capture learnings, decisions, or pitfalls from the current conversation
argument-hint: "[type] [optional: description]"
---

# /knowledge - 知识沉淀命令

手动触发知识沉淀，将对话中的有价值内容存入知识库。

## 用法

```bash
# 自动检测类型
/knowledge

# 指定类型
/knowledge pitfall           # 沉淀踩坑记录
/knowledge adr               # 沉淀架构决策
/knowledge glossary          # 沉淀术语定义

# 带描述
/knowledge pitfall MPC签名超时问题

# 管理待沉淀队列
/knowledge list              # 查看待沉淀列表
/knowledge skip              # 跳过当前待沉淀提醒
/knowledge clear             # 清空待沉淀队列

# 知识晋升
/knowledge promote           # 将项目知识晋升到全局库
```

## 沉淀类型

| 类型 | 说明 | 触发词 |
|-----|------|-------|
| `pitfall` | 踩坑记录 | 踩坑、坑、注意、原来是 |
| `adr` | 架构决策记录 | 决定、选择、方案、架构 |
| `glossary` | 术语定义 | 是什么、定义、术语 |

## 沉淀目标

执行命令后会询问沉淀目标：

```
🎯 沉淀目标:
   [1] 项目级 - ./CLAUDE.md（仅本项目可见）
   [2] 全局级 - ~/compound-knowledge/（跨项目共享）

请选择 [1/2]:
```

### 项目级（./CLAUDE.md）
- 项目特定的配置和经验
- 不适合跨项目共享的内容

### 全局级（~/compound-knowledge/）
- 通用技术经验
- 跨项目可复用的知识
- 会根据产品线关键字自动分类到对应目录

## 执行流程

1. **解析参数**：确定沉淀类型
2. **提取内容**：从当前对话中提取相关信息
3. **用户确认**：展示提取内容，请用户确认或补充
4. **选择目标**：项目级或全局级
5. **格式化**：使用对应模板格式化内容
6. **写入文件**：保存到目标位置
7. **Git 提交**：（全局级）自动 commit

## 示例

### 沉淀踩坑记录

```
用户: /knowledge pitfall

📝 从当前对话提取的踩坑内容：

**问题现象**: MPC 签名请求在高并发时频繁超时
**根本原因**: 默认超时时间 30s 在高负载下不足
**解决方案**:
  1. 调整超时时间为 60s
  2. 增加重试机制（最多3次）
  3. 添加请求队列限流

确认以上内容？[Y/n/编辑]
```

### 沉淀架构决策

```
用户: /knowledge adr

📝 从当前对话提取的架构决策：

**决策标题**: 选择 Redis 而非 Memcached 作为缓存方案
**背景**: 需要为交易系统添加缓存层
**考虑的选项**:
  1. Redis - 支持持久化，数据结构丰富
  2. Memcached - 简单高效，纯内存
**最终决策**: Redis
**理由**: 需要持久化能力和复杂数据结构支持

确认以上内容？[Y/n/编辑]
```

## Routes To

`knowledge-sink` skill
