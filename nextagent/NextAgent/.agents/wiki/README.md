# NextAgent LLM Wiki

面向 CodeAgent 的持久化、可复合项目知识库。不替代代码、AGENTS.md 或 openspec/ 中已有的规则，而是积累 CodeAgent 无法从代码推导的知识：设计意图、隐式约束、历史决策和实战经验。

## 设计原则

- **可复合**：wiki 随项目演进而增长。CodeAgent 的好回答、踩坑经验、源变更影响都应回写 wiki
- **可按需加载**：每个页面聚焦一个主题，CodeAgent 根据任务选择性读取，不必全量加载
- **可追踪**：每个 wiki 页标注来源和最后验证时间，源变了知道该更新谁
- **结构化优先**：表格、列表、短句，减少叙述性文本，最大化信息密度
- **不重复源文件**：AGENTS.md、coding-standards.md、openspec/ 已有的只给指针和摘要

## 页面索引

| 页面 | 何时读取 | 一句话摘要 |
|---|---|---|
| [domain-glossary.md](domain-glossary.md) | 理解需求、编写代码、review 时 | 电信运维与 NextAgent 领域术语表 |
| [architecture-map.md](architecture-map.md) | 修改跨包逻辑、新增包/模块前 | 包职责、分层模型、依赖方向 |
| [package-ownership.md](package-ownership.md) | 判断"这段代码应放在哪个包"时 | 每个 package 拥有什么、禁止什么 |
| [contract-navigation.md](contract-navigation.md) | 新增/修改 API、DTO、Record、port 时 | 如何找到和使用 contracts 与 OpenSpec |
| [data-flow-atlas.md](data-flow-atlas.md) | 追踪请求处理、调试流式问题、理解生命周期时 | 关键数据流路径 |
| [decision-trees.md](decision-trees.md) | 面临"X 应该放在哪/用哪种模式"时 | 常见开发决策指南 |
| [anti-patterns.md](anti-patterns.md) | 编写代码、review 时 | LLM 常犯错误与项目特殊约束 |
| [vocabulary-ids.md](vocabulary-ids.md) | 创建新类型、ID、enum 时 | Branded ID、枚举、DO/DTO/PO 规范 |
| [frontend-rules.md](frontend-rules.md) | 修改 frontend/agent-web 时 | 前端边界约束与三宿主模式 |
| [verification-gates.md](verification-gates.md) | 提交前验证、CI 配置时 | 验证命令与门禁规则 |
| [quick-ref.md](quick-ref.md) | 上下文预算紧张、需要快速确认规则时 | 最关键规则浓缩卡 |
| [config-and-entry-points.md](config-and-entry-points.md) | 配置修改、启动排障、理解入口时 | 配置文件与入口点速查 |
| [openspec-workflow.md](openspec-workflow.md) | 创建/修改 OpenSpec change 时 | 契约先行工作流 |
| [test-writing-guide.md](test-writing-guide.md) | 编写/修改测试时 | 测试分类、位置、模式与常见错误 |

## 任务→页面映射

CodeAgent 收到任务后，按下表选择要读取的页面（1-3 页即可）：

| 任务类型 | 优先读取 | 辅助读取 |
|---|---|---|
| 新增 Web API 端点 | contract-navigation, package-ownership | verification-gates |
| 新增持久化字段/表 | package-ownership, vocabulary-ids | data-flow-atlas |
| 修改请求处理流程 | data-flow-atlas, architecture-map | anti-patterns |
| 新增包/模块 | architecture-map, package-ownership | — |
| 新增 Branded ID / 枚举 | vocabulary-ids, package-ownership | — |
| 修改前端 | frontend-rules, anti-patterns | verification-gates |
| 新增 Capability (Tool/Skill/Agent/Workflow) | decision-trees, contract-navigation | data-flow-atlas |
| 创建 OpenSpec change | openspec-workflow, contract-navigation | — |
| 调试流式/生命周期问题 | data-flow-atlas, anti-patterns | — |
| Code Review | anti-patterns, package-ownership | — |
| 写测试 | test-writing-guide, verification-gates | anti-patterns |
| 上下文预算紧张 | quick-ref | 按需读详细页 |
| 配置/启动相关问题 | config-and-entry-points | architecture-map |

## 快速参考卡

上下文预算紧张时，先读 [quick-ref.md](quick-ref.md)（~60 行），覆盖最关键的 DO/DTO/PO/Record 边界、Agent/Owner Scope、Gateway 写入模式和常见禁止项。

## 使用方式

1. **按需读取**：根据当前任务选择 1-3 个最相关页面，不要全量加载
2. **结合 AGENTS.md**：本 wiki 是 AGENTS.md 的补充，不替代其约束
3. **结合 codegraph**：本 wiki 提供"为什么"，codegraph 提供"在哪里"，两者互补
4. **遇到冲突时**：以 AGENTS.md > openspec/ > 本 wiki 的优先级为准
5. **交叉引用**：页面间用 `→ see xxx.md` 标注关联页面

## 维护操作

### Ingest（源变更时更新 wiki）

当以下事件发生时，CodeAgent 应主动更新 wiki：

| 触发事件 | 应更新的 wiki 页面 | 动作 |
|---|---|---|
| 新增/归档 OpenSpec change | contract-navigation, 相关专题页 | 更新 affected pages，在 [log.md](log.md) 记录 |
| 新增/修改 package | architecture-map, package-ownership | 更新职责表和依赖规则，记录 log |
| 变更 contract subpath 白名单 | architecture-map | 更新白名单表，记录 log |
| 修改 AGENTS.md 约束 | anti-patterns, quick-ref, package-ownership | 同步相关页面，记录 log |
| 新增 branded ID / 枚举 | vocabulary-ids | 添加条目，记录 log |
| 修改前端约束 | frontend-rules | 同步更新，记录 log |

### Query 回写（有价值的发现存入 wiki）

CodeAgent 在工作中产生以下内容时，应考虑回写 wiki：

| 发现类型 | 回写目标 | 示例 |
|---|---|---|
| 踩坑经验（犯了 wiki 已记录的错） | anti-patterns.md | 补充具体错误代码片段 |
| 新发现的隐式约束 | anti-patterns.md 特殊约束表 | "X 方法不能在 Y 场景使用" |
| 常见任务的多步操作清单 | decision-trees.md | 新增第 N 棵决策树 |
| 调试中发现的非显而易见的数据流 | data-flow-atlas.md | 补充子流程图 |
| 对架构规则的更精确理解 | 对应专题页 | 修正/细化已有条目 |

回写原则：只记录**下次还会遇到**的知识，不记录一次性调试细节。

### Lint（定期健康检查）

当用户要求或 CodeAgent 判断 wiki 可能过期时，执行以下检查：

| 检查项 | 方法 |
|---|---|
| 过期页 | 读取页首 `last-verified` 日期，与 git log 比对相关源文件最后修改时间 |
| 矛盾页 | 同一规则在不同页面描述不一致 |
| 孤立页 | 无其他 wiki 页交叉引用的页面 |
| 缺失页 | 代码中存在的模式未被任何 wiki 页覆盖 |
| 断链 | 交叉引用指向不存在的页面 |

### Log（时序记录）

所有 wiki 变更记录在 [log.md](log.md)。格式：

```
## [YYYY-MM-DD] ingest | 简述
- 更新了 xxx.md：原因
- 新增了 xxx.md：原因

## [YYYY-MM-DD] query-backfill | 简述
- 在 xxx.md 补充了：内容摘要

## [YYYY-MM-DD] lint | 全量/部分
- 发现问题：描述
- 已修复：描述
```

## 维护规则

- 修改架构、新增包、变更 contract 边界时，同步更新对应 wiki 页面
- wiki 只记录**难以从代码直接推导**的知识：设计意图、历史决策、隐式约束、实战经验
- 代码已明确表达的（类型签名、导出列表、文件结构）不在 wiki 重复
- 每次变更 wiki 后必须追加 log.md 条目
