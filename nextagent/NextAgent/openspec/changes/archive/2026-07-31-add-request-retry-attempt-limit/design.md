## 背景和现状（Context）

Request retry 由 `agent-runtime` 的 `RuntimeSubmission.retryLatest`（`packages/agent-runtime/src/lifecycle/submit.ts`）拥有：校验幂等键、agent+owner scope、latest request、terminal 状态后，以 `attempt: source.attempt + 1` 创建新 `RequestRun` 并排队。`attempt` 已是 durable fact，且 `REQUEST_ACCEPTED` canonical event 的 inlinePayload 携带 `attempt`。

当前没有任何次数上限：`request-retry` 稳定 spec 只约束合法性边界。前端 `frontend/agent-web` 的 retry 按钮（`TurnBlock.tsx`）只对 latest turn 可见，点击后走 `requestStore.retryRequest` → `POST /api/v1/sessions/:sessionId/retry`，失败时已有 conflict/notice 处理路径。

约束：

- AGENTS.md 规格优先：runtime command 行为变化必须先有 OpenSpec change（本 change）。
- 最小内核非回归：不得修改 `ts-minimal-agent-kernel` 拥有的 conversation 历史响应形状。
- 同形同策：超限拒绝必须与既有 acceptance 拒绝（NOT_LATEST、NOT_TERMINAL 等）使用同一模式——安全错误码 + 无 side effect。

相关方：`agent-runtime`（权威限制）、`agent-channel-web`（safe error 透传）、`frontend/agent-web`（按钮禁用投影）。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 每个 request 最多 5 次 retry（最高 attempt 6），超限在 acceptance 阶段以稳定安全错误码 `REQUEST_RETRY_LIMIT_EXCEEDED` 拒绝。
- 计数锚点唯一：durable `RequestRun.attempt`；accepted 即计数（含失败 attempt）；acceptance 拒绝不计数；幂等重放优先于上限校验。
- agent-web 收到超限错误后禁用 retry 按钮并以 message.warning 气泡提示「当前系统仅支持最多5次的重试」；实时路径已知 attempt 达上限时同样禁用。

**非目标：**

- 不引入上限配置项（固定常量 5）。
- 不实现 runtime 自动重试预算（瞬态故障的自动重试是独立机制，本 change 不涉及）。
- 不修改 conversation 历史响应或新增读端点来暴露 attempt（刷新后按钮先可用、点击一次后禁用，是刻意接受的取舍）。
- 不区分失败原因做次数返还（失败 attempt 一律占次数）。
- 不改变既有 retry lineage、visibility replacement、model context exclusion 语义。

## 设计决策（Decisions）

### D1：上限常量与判定锚点

固定常量 `MAX_RETRY_ATTEMPTS = 5`（用户重试次数），判定式为 `source.attempt >= 1 + MAX_RETRY_ATTEMPTS`（即 source attempt 达 6 时拒绝）。锚点直接复用 durable `RequestRun.attempt`，acceptance 时一次整数比较，不需要新增 gateway 查询或计数表。

- 放弃「只计 COMPLETED attempt」：需要 attempt 编号与计数脱钩、新增按 lineage 统计的 gateway 查询，复杂度显著增加；且失败 attempt 同样消耗了模型/算力资源，计入符合限次的成本治理目的。用户逃生路径（edit-resubmit 创建新 requestId、预算重算）保持可用。
- 放弃「时间窗速率限制」：与单条回答限次解决的不是同一个问题，且需要新的计数存储。

### D2：校验位置与顺序

上限校验放在 `retryLatest` acceptance 路径中、幂等重放解析和 source 合法性校验之后、创建新 run 之前：

1. 幂等键缺失/重放/冲突（既有）——重放已 accepted 的 retry 直接返回首次结果，不受上限影响；
2. not-found、stale latest、terminal-pending、非 terminal（既有）；
3. **attempt 上限（新增）**；
4. 创建 attempt + 排队（既有）。

这个顺序保证：幂等重放语义不被上限破坏；超限拒绝与既有 acceptance 拒绝一样无任何 side effect。

### D3：安全错误形态

新增稳定错误码 `REQUEST_RETRY_LIMIT_EXCEEDED`，category `CONFLICT`，`retryable=false`，`safeDetails.reasonCode` 与错误码同名。CONFLICT 与既有「request 当前状态不允许 retry」一族错误（NOT_LATEST、NOT_TERMINAL）保持同形同策；`retryable=false` 防止调用方自动重试放大。错误 message 为通用安全文案，不含 scope、存储或内部细节。

### D4：前端禁用投影（方案 A：错误驱动 + 实时已知）

agent-web 不自行权威计数，禁用状态来自两个可信数据源：

- **实时已知 attempt**：retry acceptance 响应（`RequestAccepted.attempt`）和 live `REQUEST_ACCEPTED` 事件携带的 attempt；已知 attempt 达到 6 时禁用 latest turn 的 retry 按钮。
- **超限错误**：`POST /retry` 返回 `REQUEST_RETRY_LIMIT_EXCEEDED` 时，以 message.warning 气泡展示提示（i18n：zh-CN「当前系统仅支持最多5次的重试」/ en-US 对应文案），并将该 turn 的 retry 按钮置为禁用，Tooltip 显示同一提示。

禁用投影覆盖全部三个 retry 入口，共享同一 view state 来源，不形成平行禁用逻辑：

- **TurnBlock 重试按钮**（`btn-retry-ai`）和 **Composer 重试按钮**（`btn-retry-latest`）：禁用态复用既有 `favoriteDisabled`/`shareDisabled` 同款禁用范式——`cursor: not-allowed`、降低透明度、外层 `Tooltip` 悬浮展示原因文案，并设置 `aria-disabled`。禁用是「可见但不可操作」，不是隐藏按钮。
- **`/retry` slash 命令**：无法预先禁用（命令目录不持有 per-request attempt 状态），触发后收到超限错误时展示同一 message.warning 气泡提示。

刻意接受：刷新/重开会话后前端不知道历史 attempt，按钮先可用，用户点击一次触发超限错误后禁用。权威限制始终在 runtime，该体验缺口不影响安全语义。

- 放弃「新增 retry-state 读端点」：为一个字段新增 API surface，收益只是刷新后首屏的禁用状态。
- 放弃「conversation 历史响应携带 attempt」：需要修改 frozen 最小内核 spec 和 message read model，blast radius 与收益不成比例。

### D5：幂等键处理

超限拒绝发生在 acceptance 之前、未创建任何 run，因此该次点击使用的 control idempotency key 未被锚定到任何事实；前端按既有 `shouldKeepControlIdempotencyKey` 语义处理确定性拒绝即可，不影响后续合法操作。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 上限常量固化在 runtime，不接受任何 client 输入；超限错误为 safe error，不泄漏 scope/存储/内部细节；agent+owner scope 校验顺序不变 | `agent-runtime` 超限负例测试断言错误码与无泄漏；Web 错误透传测试 |
| 性能/容量 | 上限直接约束单 request 的最大模型调用次数（6 次）；判定为 O(1) 整数比较，无新增查询 | 既有 retry acceptance 测试不退化 |
| 可靠性/恢复 | 幂等重放优先于上限校验；超限拒绝无 side effect，不产生 recovery 需要 reconcile 的中间态 | 幂等重放 + 超限组合测试；无 side effect 断言 |
| 可维护性 | 单一常量、单一判定锚点、单一校验点；与既有 acceptance 拒绝同模式 | `npm run lint:architecture`；code review |
| 可测试性 | 上限行为完全由 durable attempt 驱动，可用既有 retry 测试基建构造 attempt 1..6 的确定性场景 | `agent-runtime` characterization/contract 测试；agent-web 组件测试 |
| 审计/可追溯性 | 超限拒绝以稳定错误码进入既有 runtime 日志/safe error 路径；每次 accepted retry 的 attempt lineage 已 durable | 既有 observability 断言路径，无新增信号 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 第 5 次 retry 接受、attempt 6 之后的 retry 以 `REQUEST_RETRY_LIMIT_EXCEEDED` 拒绝且无 side effect | T2 | `npm test -- ...agent-runtime` retry 上限测试 |
| 失败 attempt 占次数 | T2 | `agent-runtime` FAILED 终态后超限拒绝测试 |
| 幂等重放优先于上限 | T2 | `agent-runtime` 重放已 accepted retry 测试 |
| acceptance 拒绝不创建 attempt、最高 attempt 不变 | T2 | 上述测试中的负例断言 |
| Web channel 透传 safe error、无敏感信息泄漏 | T3 | `npm run test:contract` / channel 错误映射测试 |
| agent-web 超限后禁用按钮 + 提示；实时已知 attempt 达上限禁用 | T4 | `frontend/agent-web` `npm test -- ...` 相关组件/store 测试 |
| 三宿主行为一致（复用同一 store/projection） | T4 | agent-web 测试 + `npm run build` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/request-retry/spec.md`（本 change delta 归档合并：上限数值、计数锚点、错误码、投影行为）。
- 架构和跨模块设计：`openspec/designs/architecture/request-run.md` 归档前补充 retry attempt 上限常量与超限拒绝语义。
- 模块设计：无（`retryLatest` 职责不变）。
- ADR：无（决策复杂度不足以单独立 ADR，取舍记录在本 design）。
- 导航：无。

## 风险与取舍（Risks / Trade-offs）

- [刷新后超限按钮先可用、点击一次才禁用] -> 权威限制在 runtime，错误提示即反馈；如未来产品要求刷新后一致，再评估 retry-state 读路径（本 change 不预留扩展点）。
- [用户因系统故障（模型超时等）损失重试次数] -> 接受：失败 attempt 同样消耗资源；用户可 edit-resubmit 开启新预算；未来若引入 runtime 自动重试，作为独立预算设计。
- [既有长 retry 历史的会话在上线后立即超限] -> 符合预期：上限对存量 attempt 同样生效，无需迁移。

## 迁移计划（Migration）

无数据迁移。上限为运行时判定，对存量 durable attempt 自然生效。发布无需特殊步骤；回滚即还原代码，无持久化格式变化。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/request-retry/spec.md`：合并「Retry attempt 次数上限」requirement。
- `openspec/overview.md`：稳定基线描述补充 retry 上限一句。
- `openspec/designs/architecture/request-run.md`：补充上限常量、计数锚点、超限拒绝语义。

## 待确认问题

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-2.3-重试请求` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/request-retry/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
