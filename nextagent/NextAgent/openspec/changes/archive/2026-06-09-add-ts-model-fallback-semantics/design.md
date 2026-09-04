## 背景和现状（Context）

本 change 关注模型失败后的后续处理不能被藏在 adapter 内部，先冻结 `agent-model` 不隐式 cross-profile fallback 的边界。

## 黑盒目标（Blackbox Goal）

当当前 profile 调用失败时，`agent-model` 只返回带 `safeError` 的终态失败结果，且不得自动尝试其他 profile。在上层 fallback orchestration 落地前，运行时保持 fail closed。

## 边界（Boundary）

- 负责：明确 model/core/orchestration 的 fallback 边界、禁止 `agent-model` 隐式 cross-profile fallback、冻结 fail-closed 行为
- 不负责：完整 fallback 算法、fallback evidence DTO、routing policy、visible-output replay gate、degraded outcome 全量契约
- owner：当前边界约束由该 change 承载；真正的 fallback decision/evidence owner 是后续 `agent-core` 与 routing evidence change

## 输入输出（Inputs / Outputs）

输入：

- 当前已选 profile
- 当前 provider/model failure

输出：

- `agent-model` 侧输出仅为失败 `ModelFinalResult`
- 不发生隐式 cross-profile fallback 的可验证行为

## 核心实现策略（Core Implementation Strategy）

- `agent-model` 只执行当前已选 profile，并在失败时返回统一的安全失败终态。
- `agent-model` 返回失败后不读取 fallback 候选、不扫描 profile、不重新调用其他 provider。
- 当前 change 不实现上层 fallback 评估；在后续 orchestration change 落地前，失败结果向上返回并 fail closed。
- 后续 fallback 评估必须读取 `modelProfileRegistry` 的 fallback-eligible selector 和安全失败事实，并由 routing evidence 记录 decision；该规则只作为 deferred 边界说明，不进入当前实现任务。

## 关键约束（Key Constraints）

- fallback owner 必须在 orchestration/routing policy，不能在 `agent-model` 内部
- `agent-model` 失败时只能返回带 `safeError` 的终态失败结果
- 不得 route miss 自动换 provider，不得静默重试其他 profile
- 当前 change 不创建 fallback decision DTO 或 evidence DTO
- 在上层 fallback orchestration 落地前，当前 profile 失败后保持 fail closed

## 关键业务流程（Key Flow）

1. 上游先选定当前 profile
2. `agent-model` 执行当前 profile
3. 若成功，返回成功 `ModelFinalResult`
4. 若失败，`agent-model` 返回带 `safeError` 的失败 `ModelFinalResult`
5. `agent-model` 不选择其他 profile、不重新发起 provider 调用
6. 在后续 fallback orchestration 落地前，上层按当前失败终态结束

## 典型用例（Typical Use Cases）

- 主模型调用因超时失败。`agent-model` 返回带 `safeError` 的失败终态，不自动切换到备用 profile。
- route miss 或 normalization failure 发生时，`agent-model` 不扫描其他 profile，不按“第一个可见 provider”重试。
- 当前 profile 失败后，即使配置中存在 fallback-eligible profile，在上层 fallback orchestration 落地前系统仍以当前失败终态 fail closed。

## 已知遗留事项（Deferred Work）

当前 change 不落地完整上层 fallback 编排；以下能力由后续 change 实现：

1. `agent-core` 备用 profile 评估与切换
   - 消费 `modelProfileRegistry` 的 fallback-eligible selector、当前 `SafeError`、request/run/step 状态。
   - 在允许 fallback 时选择下一候选，并以显式编排步骤重新发起模型调用。
   - 不得由 `agent-model` 内部自动切 provider 或扫描临时候选。
2. fallback 决策安全闭环
   - 将“是否已有用户可见输出”作为强制 policy gate；已有可见输出时禁止同一步骤 silent replay。
   - 对切换、拒绝切换、无候选三类结果记录 routing/fallback evidence。
   - evidence owner 仍为 routing evidence capability，不新增 model-owned evidence contract。

在上述遗留事项落地前，系统行为是 fail closed：当前 profile 失败后向上返回安全失败，不自动尝试备用 profile。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `agent-model` 不得因 fallback 评估暴露 profile 配置或 provider 凭证；失败只通过 `safeError` 向上返回 | contract test: no profile leakage on failure |
| 性能/容量 | fail closed 行为不引入额外延迟或重试开销；后续 fallback orchestration 的 timeout 由上层控制 | integration test: fail closed latency |
| 可靠性/恢复 | 当前 profile 失败后返回明确失败终态，不静默切换到其他 provider；上层可基于 `safeError` 决定是否重试 | contract test: explicit failure terminal |
| 可维护性 | fallback 决策权在 orchestration/routing policy，不在 `agent-model`；职责边界清晰 | architecture test: fallback owner boundary |
| 可测试性 | 可通过 mock profile registry 验证 fail closed 行为；不依赖真实 provider failure | integration test: mock profile failure |
| 审计/可追溯性 | 当前 change 不生成 fallback evidence；后续 routing evidence change 负责记录决策 | deferred: routing evidence capability |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `agent-model` 不得隐式 cross-profile fallback | T1.1 | `packages/agent-model/tests/no-implicit-fallback.test.ts` |
| 失败时只返回带 `safeError` 的 `ModelFinalResult` | T2.1 | contract test: failure terminal shape |
| 不读取 fallback 候选、不扫描 profile | T3.1 | architecture test: no profile scan on failure |
| 当前 change 不创建 fallback decision DTO | T4.1 | contract test: no fallback DTO in model |
| 上层 fallback orchestration 落地前保持 fail closed | T5.1 | integration test: fail closed behavior |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/model-fallback-semantics/spec.md`（新增）
- 跨模块设计：`openspec/designs/architecture/model-routing-and-provider-adapter.md`（修改）
- 模块设计：`openspec/designs/modules/agent-model.md`（修改）
- 导航：`openspec/designs/spec-to-design-map.md`（更新）

## 风险与取舍（Risks / Trade-offs）

- [风险] 上层 fallback orchestration 延迟落地，导致当前 profile 失败后无降级路径。-> 明确 fail closed 是当前唯一安全行为，后续 change 必须优先实现 fallback 评估。
- [风险] `modelProfileRegistry` 的 fallback-eligible selector 语义不清晰。-> 后续 change 必须定义 selector 的稳定契约和路由证据记录格式。
- [取舍] 当前不实现 fallback evidence DTO，避免在 routing evidence capability 落地前引入冗余契约。-> 接受临时契约缺口，后续统一收敛。
- [实现状态] 本 change 冻结 `agent-model` fallback 边界和 fail-closed 行为。上层 fallback orchestration（消费 `modelProfileRegistry` fallback-eligible selector、current `SafeError` 和 request/run/step state 做 profile 切换；执行 visible-output replay gate 并记录 routing/fallback evidence）延迟到后续 `agent-core` orchestration / routing evidence change。在后续 change 落地前，runtime SHALL fail closed after the selected profile fails and SHALL NOT attempt implicit cross-profile fallback inside `agent-model`。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/model-fallback-semantics/spec.md`
- 更新 `openspec/designs/architecture/model-routing-and-provider-adapter.md`
- 更新 `openspec/designs/modules/agent-model.md`
- 更新 `openspec/designs/spec-to-design-map.md`
