## 背景和现状（Context）

当前 `rag` Tool 已经通过 `RagRetrievalGateway` 隔离 local/remote provider，并且 Tool input 允许模型传入 provider-neutral logical `indexes`。分支实现中已经加入 `rag.indexes` 配置和 `ragDefaultIndexes` Tool dependency，但长期基线规格不应在实施阶段直接修改，需要通过 active change 承载该行为调整。

当前 implementation-vs-spec gap 是：实现支持从 app composition 注入默认 indexes，但 stable `rag-tool` 规格仍表达为省略时固定 `["local"]`；同时 stable `app-config-schema` 还未声明 `rag.indexes` 配置组。本 change 用 active delta 先定义目标行为，归档时再合入基线。

相关方：
- `agent-app`: 唯一 composition root，负责 startup config freeze 和 Tool dependency 注入。
- `agent-capability`: 拥有 builtin `rag` Tool descriptor、input/output schema 和 executor。
- retrieval provider: local/remote provider 只通过 `RagRetrievalGateway` 被调用，不暴露 provider-private 细节。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 用户显式指定 `indexes` 时，Tool 使用用户指定的 logical indexes。
- 用户未指定 `indexes` 时，Tool 使用 trusted app composition 注入的默认 logical indexes。
- 默认 logical indexes 不可用、不存在、未 ready 或查询超时时，Tool 返回显式 safe reason，供模型反问用户指定可用索引。
- `rag.indexes` 只作为 app composition 默认 logical index 配置，不能表达 provider-private binding、endpoint、credential、路径或检索参数。
- 不直接修改 `openspec/specs/` 基线文档；实施阶段只维护 active change 文档和代码。

**非目标：**

- 不实现 remote RAG provider。
- 不增加 provider-private index binding、召回参数、ranking protocol 或 endpoint 配置。
- 不让 Tool input 选择 provider、deployment mode、credential 或 workspace root。
- 不新增 Web API、runtime command、持久化表或 request-time 配置热更新。

## 设计决策（Decisions）

### 决策 1：默认索引由 `agent-app` 冻结并注入 Tool dependency

唯一实现路径是：`agent-app` 在 startup config validation 中冻结 `rag.indexes`，默认值为 `["local"]`；composition 创建 capability subsystem 时，通过 `ToolDependencies.ragDefaultIndexes` 注入 builtin `rag` Tool。这样默认索引来自可信 app composition，不来自用户请求体、模型输出或 provider 返回。

放弃方案：让 `rag` Tool 自己读取配置文件。原因是 `agent-capability` 不拥有 app config，也不能绕过 composition root。

### 决策 2：显式 Tool input `indexes` 优先于默认配置

`rag` executor 只在 input 没有 `indexes` 时读取 `ragDefaultIndexes`。如果 input 提供了 `indexes`，executor 原样使用 schema 校验后的 logical list，不追加、替换或合并默认值。这样用户指定的查询意图不会被默认配置稀释。

放弃方案：显式索引与默认索引合并。原因是合并会扩大检索范围，可能造成用户以为只查某个索引但实际查了更多索引。

### 决策 3：默认索引失败仍由 provider 返回 safe reason，Tool 不做二次 provider 选择

当默认 logical indexes 不存在、未 ready、provider 不可用或查询超时时，provider 通过 `RagRetrievalGateway` 返回 safe status/reason；`rag` Tool 映射为 degraded/unavailable/failed/timeout/canceled Tool result。模型根据 Tool 描述和 safe reason 反问用户指定可用索引名。Tool 不枚举 provider、不猜测其他索引、不暴露 provider-private binding。

放弃方案：Tool 发现失败后自动切换其他索引。原因是这会让 Tool 持有索引发现和 provider 策略，越过 gateway/composition 边界。

### 决策 4：配置 schema 只承载默认 logical indexes

`rag.indexes` 是 app composition config 的窄投影，仅允许 1-5 个唯一 safe logical index names。它不承载 remote endpoint、credential、workspace path、SQLite path、raw FTS expression、provider-private index binding 或召回参数。remote provider 的私有接入后续由 provider/composition 专属 change 定义。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Tool input 不能携带 provider/private authority；默认 indexes 来自 trusted composition；配置禁止 endpoint、credential、路径和 provider-private binding。 | `rag-capability.test.ts`, `config-assembly.test.ts`, `test:contract`, code review |
| 性能/容量 | 默认 indexes 最多 5 个，query/topK 仍沿用 RAG Tool 既有上限；不新增 request-time 配置读取。 | `rag-capability.test.ts`, config validation tests |
| 可靠性/恢复 | 默认索引不可用时返回显式 safe reason，不返回空成功；不做自动 provider 切换。 | RAG capability tests, gateway/provider focused tests |
| 可维护性 | app config ownership 留在 `agent-app`；Tool 只消费 dependency；provider-private 细节留在 gateway provider。 | `lint:architecture`, code review |
| 可测试性 | 通过 capability subsystem fake gateway 验证 explicit/default indexes；通过 config validation 验证 schema fail-closed。 | `rag-capability.test.ts`, `config-assembly.test.ts` |
| 审计/可追溯性 | 本 change 不新增日志字段；Tool completion diagnostics 继续只记录 status/count/reason 等低基数字段。 | existing observability tests, code review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 显式 indexes 优先于默认值 | 1.1 | `npm test -- packages/agent-capability/tests/rag-capability.test.ts` |
| 省略 indexes 时使用 composition 默认 indexes | 1.1, 2.1 | `rag-capability.test.ts`, `config-assembly.test.ts` |
| `rag.indexes` 只能是 safe logical index list | 2.1 | `config-assembly.test.ts`, `openspec validate --all --strict` |
| 默认索引失败返回 explicit safe reason | 1.2 | `rag-capability.test.ts`, provider focused tests |
| Tool 不选择 provider、不接触 local/remote 私有实现 | 1.1, 3.1 | `npm run lint:architecture`, code review |
| 不直接修改 `openspec/specs/` | 3.2 | `git diff --name-only origin/main...HEAD`, code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/rag-tool/spec.md` 和 `openspec/specs/app-config-schema/spec.md` 在归档时承载。
- 架构和跨模块设计：无新增 architecture 主文档。
- 模块设计：若归档时需要长期记录，`openspec/designs/modules/agent-app.md` 承载默认 indexes 注入关系，`openspec/designs/modules/agent-capability.md` 承载 Tool 只消费 dependency 的边界。
- ADR：无。
- 导航：无。

## 风险与取舍（Risks / Trade-offs）

- [风险] 默认 indexes 配置可能被误认为 remote provider 私有 index binding -> 通过 spec 明确其为 provider-neutral logical names，并禁止 endpoint/credential/private binding。
- [风险] 默认索引失败后用户体验依赖模型反问 -> Tool 描述明确反问条件，provider 返回 safe reason；不在 Tool 内引入 pending-input 或多轮状态机。
- [风险] 直接修改 stable specs 破坏 OpenSpec 流程 -> 本 change 恢复 stable specs，使用 active change delta 承载变更。

## 迁移计划（Migration Plan）

无数据迁移。代码变更只影响 startup config validation、app composition dependency 注入和 Tool 描述。回滚时移除 active change 和对应代码增量，默认行为回到固定 `["local"]`。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/rag-tool/spec.md`: 合入 explicit indexes 优先、composition 默认 indexes、默认索引失败 safe reason。
- `openspec/specs/app-config-schema/spec.md`: 合入 `rag.indexes` 配置组和 fail-closed 规则。
- `openspec/designs/modules/agent-app.md`: 视当前文档结构补充 `rag.indexes` 注入为 app composition 职责。
- `openspec/designs/modules/agent-capability.md`: 视当前文档结构补充 `rag` Tool 只消费 `RagRetrievalGateway` 和默认 indexes dependency。

## 待确认问题（Open Questions）

无。
