## 背景和现状（Context）

gateway 节点族是 workflow graph 的纯控制节点。当前需要先把 `start-event`、`end-event`、`exclusive-gateway` 这三类基础控制节点独立收口，确保最小流程入口、出口和条件分支语义稳定。

此前 `parallel-gateway` 曾与这批节点一起推进，但它引入了 branch barrier、join、waiting branch、budget 和恢复等额外复杂度。为保持 KISS，本 change 现在只承接基础 gateway 语义；`parallel-gateway` 后续由独立 change 处理，并行 gateway 执行能力由 `add-ts-workflow-parallel-gateway` 独立承接。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 明确三类基础 gateway 节点的统一执行语义
- 明确 gateway 节点与 timeout / retry / event 输出的关系
- 明确外部 recipe DSL 与内部 canonical workflow model 的对齐边界

**非目标：**
- 不实现 `parallel-gateway`（由 `add-ts-workflow-parallel-gateway` change 承接并发 fork/join 执行实现）
- 不新增 `inclusive-gateway` 作为独立 node type；`inclusive-gateway` 作为 `PARALLEL` 的 BPMN DSL 别名受控支持（见 Inclusive Gateway Alias requirement）
- 不新增 `complex-gateway`、`event-based gateway`
- 不把 gateway 节点扩展为业务调用节点

## 设计决策（Decisions）

1. gateway 节点属于 `agent-workflow` handler，不上浮到 `agent-runtime`
2. gateway 节点不产生业务 payload，只更新调度状态
3. `exclusive-gateway` 的 condition 求值失败视为 `false`，但会产出 safe diagnostic event
4. `exclusive-gateway` condition evaluator 只读取可信 `contextVariables`；不得直接读取 `nodeResults` 原始 payload
5. gateway 节点的默认分支与 condition 私有字段由本 change 定义；`agent-contracts/core` 不为这些私有字段冻结强类型
6. safe diagnostic event 使用固定安全摘要字段：`nodeId`、`nodeType`、`reasonCode`，并按场景补充 `selectedBranchId`、`conditionIndex`
7. 外部 DSL 以 `docs/Recipe specification.md` 为准；实现如需在 loader 或 workflow package 内部做命名 normalization，必须是受控私有适配，不得新增第二套用户可见 recipe 语法
8. `exclusive-gateway` 不引入独立 `default` DSL 字段；fallback 语义只能通过按声明顺序放置的最后一个 `condition: ""` 分支表达
9. `parallel-gateway` 不在本 change 范围，也不在当前本地实现中提供 handler
10. `inclusive-gateway` 作为 `PARALLEL` 的 BPMN DSL 别名受控支持；recipe loader 的 `normalizeNodeType` 将 `inclusive-gateway` 映射到 canonical `WorkflowNodeType = "PARALLEL"`，不引入新 node type；执行语义复用 `PARALLEL` handler：评估所有分支条件，激活所有条件为 true 的分支，多分支匹配时执行 fork-join

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | gateway 事件与错误只输出 safe diagnostic；不暴露 prompt、raw capability result 或路径 | `npm run test:contract` |
| 性能/容量 | 三类基础 gateway 都是同步轻量控制节点，不引入额外并发模型 | `npm run build`；集成测试 |
| 可靠性/恢复 | `start/end/exclusive` 不拥有独立恢复状态；取消与超时通过既有 execution 中断边界收敛 | workflow integration tests |
| 可维护性 | 把 `parallel-gateway` 拆出，避免本 change 混入 branch/join 复杂度 | OpenSpec review；代码审查 |
| 可测试性 | `start/end/exclusive` 都能通过黑盒执行路径与 safe diagnostic 断言覆盖 | unit / integration / contract tests |
| 审计/可追溯性 | lifecycle event 保留 `nodeId`、`nodeType`、`reasonCode` 等安全摘要 | contract tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `start-event` 作为唯一入口 | 2.1, 4.1 | workflow integration tests |
| `end-event` 正常完成 execution | 2.2, 4.1 | workflow integration tests |
| `exclusive-gateway` 顺序求值与 fallback 规则 | 2.3, 4.2 | workflow integration tests |
| `exclusive-gateway` 只读 `contextVariables` | 2.4, 4.2 | workflow integration tests；code review |
| gateway 节点无业务 payload、事件不含敏感信息 | 3.1, 3.1A, 4.3 | contract tests |
| `parallel-gateway` 已移出本 change | 说明 | OpenSpec review；代码审查 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`specs/workflow-gateway-nodes/spec.md`
- 模块设计：`openspec/designs/modules/agent-workflow.md`
- 跨模块设计：`openspec/designs/architecture/workflow-contracts.md`
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] `parallel-gateway` 不由本 change 本地实现，外部 DSL 中的该节点类型不会由当前 change 提供执行语义；首版由 `add-ts-workflow-parallel-gateway` 提供 -> 缓解方式：通过独立 change 单独承接 parallel 规格与实现，当前 change 不再声称覆盖它。
- [风险] 现在只实现基础 gateway，后续并行能力还需要额外 OpenSpec 与代码推进 -> 缓解方式：保持本 change 范围稳定，避免继续膨胀。

## 迁移计划（Migration Plan）

无。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-gateway-nodes/spec.md`：保留 `start/end/exclusive` 的可验证行为契约
- `openspec/designs/architecture/workflow-contracts.md`：保留基础 gateway 行为与条件分支语义
- `openspec/designs/modules/agent-workflow.md`：保留 `agent-workflow` 对基础 gateway handler 的 owner 边界
- `openspec/designs/spec-to-design-map.md`：按需补充导航
- `openspec/overview.md`：无
- `openspec/designs/adr/<id>.md`：无

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.3-执行网关节点` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-gateway-nodes/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**`workflow-gateway-nodes` 的 `Exclusive Gateway` 同名 Requirement 与 stable 正文不同。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
