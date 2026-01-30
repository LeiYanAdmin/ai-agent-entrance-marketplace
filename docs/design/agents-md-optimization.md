# AI Agent Entrance v2.2.0 设计方案

基于 Vercel agents.md 研究的优化设计

---

## 执行摘要

**目标：** 将 ai-agent-entrance 从"主动工具调用"模式升级为"被动上下文 + 按需检索"的混合架构。

**核心改进：**
1. **压缩知识索引** - 8-10KB 索引注入系统提示（类似 AGENTS.md）
2. **三层检索策略** - L0 索引扫描 → L1 交叉验证 → L2 详情获取
3. **强化触发指令** - Prefer retrieval-led reasoning
4. **横向/纵向分离** - 横向知识用 AGENTS.md，纵向流程用 Skills

**预期效果：**
- 知识检索成功率：56% → 90%+
- 首次响应 token 成本：可变 → 固定 ~10KB
- 决策摩擦：Agent 始终看到可用知识，无需"想起"要搜索

---

## 1. 压缩知识索引设计

### 1.1 索引格式

**文件位置：** `~/.ai-agent-entrance/AGENTS-INDEX.md`

**格式：**
```markdown
# AI Agent Entrance - Knowledge Index

Last updated: 2026-01-28T13:45:00Z
Total assets: 127 (L1: 45, L2: 82)

## Quick Reference

Use `get_asset(name, product_line)` MCP tool to retrieve full content.

## Index

Format: `name|type|product_line|title|tags|promoted`

<!-- INDEX_START -->
matching-engine-latency|pitfall|exchange/core|撮合引擎延迟优化避坑|performance,optimization,matching|1
redis-cluster-failover|reference|exchange/infra|Redis 集群故障转移指南|redis,ha,ops|1
typescript-generics|pattern|general|TypeScript 泛型最佳实践|typescript,patterns|0
api-rate-limiting|best-practice|exchange/api|API 限流策略|api,security,rate-limit|1
<!-- INDEX_END -->

## Usage Examples

**Scan index for keywords:**
```
User: "Redis 高可用方案？"
→ Scan index for "redis" → find 2 entries
→ get_asset("redis-cluster-failover", "exchange/infra")
```

**Cross-validation when multiple matches:**
```
User: "消息队列重试策略？"
→ Scan index → 5 matches
→ search_knowledge({query: "消息队列 重试"}) → rank by score
→ get_asset(top_result)
```

## Asset Types

- **pitfall**: 踩坑记录 - 避免重复问题
- **reference**: 参考文档 - 技术指南、API 规范
- **pattern**: 设计模式 - 可复用解决方案
- **best-practice**: 最佳实践 - 团队规范、代码风格
- **glossary**: 术语定义 - 统一语言、业务概念
- **adr**: 架构决策记录 - 设计历史、权衡分析
- **discovery**: 发现笔记 - 临时记录，可转化为其他类型
- **skill**: 工作流技能 - 纵向流程（由 Skills 显式调用）
```

**压缩率目标：**
- 100 条资产 × ~100 bytes/条 = ~10KB
- 相比全量注入（100 条 × 5KB = 500KB），节省 98%

### 1.2 生成逻辑

**实现文件：** `src/services/index/agents-md-generator.ts`

```typescript
export class AgentsMdGenerator {
  constructor(private store: DatabaseStore) {}

  generateIndex(): string {
    const assets = this.store.getAllKnowledgeAssets(); // L1 + L2 全量

    const indexLines = assets.map(asset => {
      const tags = asset.tags ? JSON.parse(asset.tags).join(',') : '';
      return `${asset.name}|${asset.type}|${asset.product_line}|${asset.title}|${tags}|${asset.promoted}`;
    });

    return [header, ...indexLines, footer].join('\n');
  }

  writeAgentsMd(): void {
    const content = this.generateIndex();
    const agentsMdPath = join(getDataDir(), 'AGENTS-INDEX.md');
    writeFileSync(agentsMdPath, content, 'utf-8');
  }
}
```

**触发时机：**
1. Plugin 安装时（初始化）
2. L2 sync 后（pull/push 成功）
3. Sink 知识后（新增资产）

**性能优化（TODO #5）：**
- 批量更新：合并多次操作
- 增量更新：仅更新变更行
- 异步写入：非阻塞后台更新

---

## 2. 三层检索策略

### 2.1 架构图

```
┌─────────────────────────────────────────────────────┐
│ L0: 索引扫描（被动，SessionStart 注入）                │
│ • 始终可见，无 token 成本                             │
│ • 扫描 name|title|tags                               │
│ • 快速判断："有没有相关文档？"                         │
└────────────┬────────────────────────────────────────┘
             ↓
        结果评估决策点
             ↓
    ┌────────┴────────┐
    │                 │
1-2 条精确匹配      3+ 条或不确定
    │                 │
    ↓                 ↓
┌──────────┐  ┌──────────────────────────────────┐
│ 跳过 L1  │  │ L1: 全文搜索（主动，按需调用）     │
│          │  │ • search_knowledge()             │
│          │  │ • 搜索 content 字段               │
│          │  │ • 返回相关性分数 + snippet        │
│          │  │ • 交叉验证 L0 结果                │
└────┬─────┘  └────────┬─────────────────────────┘
     │                 │
     └────────┬────────┘
              ↓
┌─────────────────────────────────────────────────────┐
│ L2: 详情检索（主动，按需调用）                         │
│ • get_asset(name, product_line)                     │
│ • 获取完整 markdown 内容                             │
│ • 优先级：L1 分数排序 or L0 唯一匹配                  │
└─────────────────────────────────────────────────────┘
```

### 2.2 决策逻辑

| L0 扫描结果 | 决策 | 操作 |
|------------|------|------|
| 0 条匹配 | 知识缺口 | 基于通用知识回答 + 记录缺口 |
| 1-2 条精确匹配 | 高置信度 | 直接 L2 获取详情 |
| 3+ 条匹配 | 需验证 | L1 交叉验证 → 排序 → L2 |
| 多条模糊匹配 | 需验证 | L1 交叉验证 → 排序 → L2 |

### 2.3 案例演示

**案例 1：跳过 L1（精确匹配）**

```
User: "Redis Sentinel 怎么配置？"

L0 扫描: redis-sentinel-setup|reference|exchange/infra|Redis Sentinel 高可用配置
评估: 1 条精确匹配
决策: 跳过 L1
L2: get_asset("redis-sentinel-setup", "exchange/infra")
```

**案例 2：启用 L1（交叉验证）**

```
User: "我们的消息队列是怎么处理失败重试的？"

L0 扫描:
  - kafka-consumer-config|reference|...|Kafka 消费者配置
  - rabbitmq-retry-strategy|best-practice|...|RabbitMQ 重试策略
  - redis-stream-processing|pattern|...|Redis Stream 消息处理
  - message-queue-comparison|adr|...|消息队列技术选型
  - async-task-queue|reference|...|异步任务队列实现

评估: 5 条匹配，不确定最相关
决策: 启用 L1 交叉验证

L1: search_knowledge({
  query: "消息队列 失败重试 retry",
  limit: 5
})
返回:
  - rabbitmq-retry-strategy: 0.95 ⭐
  - kafka-consumer-config: 0.78
  - async-task-queue: 0.65
  - message-queue-comparison: 0.42
  - redis-stream-processing: 0.31

L2: get_asset("rabbitmq-retry-strategy", "exchange/infra")
```

### 2.4 MCP 工具增强

**search_knowledge() 返回格式升级：**

```typescript
{
  results: [
    {
      name: "rabbitmq-retry-strategy",
      product_line: "exchange/infra",
      type: "best-practice",
      title: "RabbitMQ 重试策略",
      score: 0.95,  // 新增：相关性分数
      snippet: "...消息队列失败重试的核心是指数退避..."  // 新增：匹配片段
    }
  ]
}
```

---

## 3. 强化触发可靠性

### 3.1 SessionStart Hook 注入强指令

**文件：** `hooks/session-start.sh`

**注入结构：**

```markdown
<ai-agent-entrance>

┌─────────────────────────────────────────────────────┐
│ 1. RETRIEVAL-FIRST POLICY                           │
└─────────────────────────────────────────────────────┘

**CRITICAL: Prefer Retrieval-Led Reasoning**

For ANY task involving code, architecture, or technical decisions:

1. **ALWAYS check knowledge index FIRST** before relying on pre-trained knowledge
2. **Use three-layer strategy** for optimal retrieval
3. **Prefer documented experience** over general best practices

**Why?** Our knowledge base contains team-specific pitfalls and proven solutions that general models don't know.

┌─────────────────────────────────────────────────────┐
│ 2. KNOWLEDGE INDEX                                  │
└─────────────────────────────────────────────────────┘

[... AGENTS-INDEX.md 内容 ...]

┌─────────────────────────────────────────────────────┐
│ 3. THREE-LAYER RETRIEVAL STRATEGY                   │
└─────────────────────────────────────────────────────┘

**L0 (Index Scan) - ALWAYS FIRST:**
Scan the injected knowledge index for matching name/title/tags.

**Decision Point:** Evaluate L0 results
- ✅ **1-2 exact matches** → Skip to L2 (get full content)
- ⚠️ **3+ matches OR uncertain** → Use L1 for cross-validation
- ❌ **0 matches** → Answer from general knowledge (note the gap)

**L1 (Full-text Search) - ON-DEMAND VALIDATION:**
search_knowledge() to:
- Search full content (not just title/tags)
- Get relevance scores + snippets
- Validate which asset best matches

**L2 (Detail Retrieval) - FINAL STEP:**
get_asset() to retrieve full markdown content.

┌─────────────────────────────────────────────────────┐
│ 4. ROUTER SKILL                                     │
└─────────────────────────────────────────────────────┘

[... agent-router skill 内容 ...]

┌─────────────────────────────────────────────────────┐
│ 5. PENDING KNOWLEDGE                                │
└─────────────────────────────────────────────────────┘

[... 待沉淀提醒 ...]

┌─────────────────────────────────────────────────────┐
│ 6. INSTALLED TOOLS                                  │
└─────────────────────────────────────────────────────┘

[... 已安装工具列表 ...]

</ai-agent-entrance>
```

### 3.2 Skill 描述强化

**agent-router/SKILL.md:**

```markdown
---
name: agent-router
description: **REQUIRED at conversation start** - Detect task type, recommend workflow, and route to appropriate tools. This skill MUST be invoked before any development work begins.
---
```

**knowledge-sink/SKILL.md:**

```markdown
---
name: knowledge-sink
description: **REQUIRED when valuable insights emerge** - Capture pitfalls, decisions, patterns to knowledge base. Prefer sinking knowledge over losing it.
---
```

---

## 4. 横向/纵向分离

### 4.1 知识资产分类

| 资产类型 | 分类 | 实现方式 | 理由 |
|---------|------|---------|------|
| **reference** | 横向知识 ✓ | AGENTS.md 索引 | 参考文档需要横向访问 |
| **glossary** | 横向知识 ✓ | AGENTS.md 索引 | 术语定义是基础知识 |
| **pattern** | 横向知识 ✓ | AGENTS.md 索引 | 设计模式可应用于多场景 |
| **best-practice** | 横向知识 ✓ | AGENTS.md 索引 | 最佳实践是通用指导 |
| **pitfall** | 横向知识 ✓ | AGENTS.md 索引 | 避坑指南应随时可见 |
| **adr** | 混合 ⚠️ | 索引 + 按需详情 | 决策记录既是历史也是约束 |
| **discovery** | 混合 ⚠️ | 索引 + 提升机制 | 临时笔记可转化为其他类型 |
| **skill** | 纵向流程 ✓ | Skills 显式调用 | 工作流需要过程执行 |

### 4.2 分层架构

```
┌─────────────────────────────────────────────────────┐
│          AGENTS.md (被动注入 - 横向知识)              │
│  • Compressed Index (8-10KB)                        │
│  • reference, glossary, pattern, best-practice,     │
│    pitfall, adr                                     │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│          MCP Tools (主动检索 - 详情获取)              │
│  • search_knowledge() - 交叉验证                    │
│  • get_asset() - 完整内容                           │
└─────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────┐
│          Skills (纵向流程 - 工作流执行)               │
│  • agent-router (路由推荐)                          │
│  • knowledge-sink (知识沉淀)                        │
│  • phase-detector (阶段识别)                        │
└─────────────────────────────────────────────────────┘
```

---

## 5. 实施计划

### Phase 1: 索引生成基础设施 (1-2 天)

**文件：**
- `src/services/index/agents-md-generator.ts` - 索引生成器
- `src/services/index/agents-md-generator.test.ts` - 单元测试

**功能：**
- [x] generateIndex() - 生成 pipe-delimited 格式
- [x] writeAgentsMd() - 写入 ~/.ai-agent-entrance/AGENTS-INDEX.md
- [x] 集成到 SyncEngine（pullFromL2/pushAllUnpromoted 后触发）
- [x] 集成到 handleSinkAsset（创建资产后触发）

**验证：**
- 生成的索引大小 < 15KB（100 条资产）
- 格式正确（能被 bash 脚本解析）

### Phase 2: SessionStart Hook 增强 (1 天)

**文件：**
- `hooks/session-start.sh` - 修改注入逻辑

**功能：**
- [x] 读取 ~/.ai-agent-entrance/AGENTS-INDEX.md
- [x] 注入强指令（RETRIEVAL-FIRST POLICY）
- [x] 注入三层检索策略说明
- [x] JSON 转义处理

**验证：**
- 会话启动时能看到完整索引
- 指令清晰、易懂

### Phase 3: MCP 工具增强 (1-2 天)

**文件：**
- `src/mcp/entrance-mcp-server.ts` - 修改 search_knowledge 返回格式
- `src/services/database/store.ts` - 添加 snippet 提取

**功能：**
- [x] search_knowledge() 返回 score + snippet
- [x] snippet 提取逻辑（匹配上下文 ±50 字符）
- [x] 相关性分数计算（FTS5 rank）

**验证：**
- 搜索结果包含 score 和 snippet
- snippet 包含匹配的关键字上下文

### Phase 4: 端到端测试 (1 天)

**测试场景：**
1. L0 精确匹配 → 跳过 L1 → L2
2. L0 多结果 → L1 验证 → L2
3. L0 无结果 → 记录知识缺口

**成功标准：**
- Agent 能正确执行三层检索
- 检索成功率 > 90%
- Token 成本符合预期

### Phase 5: 文档和发布 (0.5 天)

**文件：**
- `README.md` - 更新到 v2.2.0
- `CHANGELOG.md` - 记录变更
- `docs/guides/retrieval-strategy.md` - 检索策略指南

---

## 6. 关键指标

### 6.1 性能指标

| 指标 | v2.1.0 (当前) | v2.2.0 (目标) |
|------|--------------|--------------|
| 知识检索成功率 | 56% (被动) | 90%+ |
| 首次响应 token 成本 | 可变（0-50KB） | 固定（10KB） |
| 检索平均耗时 | 2-5s (MCP 调用) | 0s (索引) + 1-3s (详情) |
| 决策摩擦 | 高（需想起调用工具） | 低（索引始终可见） |

### 6.2 质量指标

| 指标 | 衡量方式 |
|------|---------|
| 索引覆盖率 | 所有 L1+L2 资产都在索引中 |
| 压缩效率 | 索引大小 / 全量内容大小 < 5% |
| 触发可靠性 | Agent 正确执行三层检索的比例 |
| 交叉验证准确性 | L1 验证后的 top-1 资产是否正确 |

---

## 7. 风险与缓解

### 7.1 风险：索引过大导致 token 成本过高

**缓解：**
- 限制索引最多 200 条资产
- 提供过滤机制（按产品线、按类型）
- 监控索引大小，超过 20KB 告警

### 7.2 风险：Agent 无法理解三层检索策略

**缓解：**
- 提供详细示例在强指令中
- 使用决策树图示
- A/B 测试不同指令措辞

### 7.3 风险：L1 交叉验证降低响应速度

**缓解：**
- L1 只在必要时触发（3+ 匹配）
- search_knowledge() 限制 limit=5
- 异步优化：后台预加载热门资产

---

## 8. 后续优化方向（Backlog）

### 8.1 智能索引过滤

根据当前项目上下文自动过滤索引：
- 读取项目的 `package.json` / `go.mod` → 推断技术栈
- 只注入相关产品线的索引
- 减少不相关噪音

### 8.2 索引增量更新

当前每次 sink/sync 都全量重写，可优化为：
- 内存缓存索引内容
- 仅更新变更的行（diff 算法）
- 定期（5 分钟）批量刷盘

### 8.3 知识缺口自动记录

当 L0 返回 0 条匹配时：
- 自动创建 discovery 类型资产草稿
- 标记为"知识缺口"
- 定期提醒补充文档

### 8.4 相关性排序优化

引入机器学习模型：
- 收集 Agent 的选择记录（点击哪个资产）
- 训练排序模型
- 替代简单的 FTS5 rank

---

## 9. 参考资料

- [Vercel: agents.md vs Skills Evaluation](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
- [FTS5 Full-text Search Documentation](https://www.sqlite.org/fts5.html)
- [Claude Code Plugin System](https://docs.anthropic.com/claude/docs/claude-code)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)

---

**文档版本：** v1.0
**作者：** Larry Yan
**日期：** 2026-01-28
**状态：** ✅ 设计完成，待实施
