## 背景与问题（Why）

Agent routing、constraint validation 和 targeted Skill routing 会产生处理路径选择、拒绝、澄清或人工接管结果。模型调用失败时，archive 的 `add-ts-model-fallback-semantics` 已冻结 `agent-model` 不得隐式 cross-profile fallback，并把上层 fallback orchestration 与 evidence 留给 Agent orchestration/routing evidence 承接。若系统只保留最终回答，运维、审计和问题定位无法追溯“为什么选择了这个安全路径”。

本 change 补齐 Agent Core 的模型 fallback orchestration 闭环，并记录 routing/fallback/constraint safe outcome evidence。它负责基于 `modelProfileRegistry.fallbackEligibleProfileIds`、当前 `SafeError`、request/run/step 状态和 visible-output gate 判断 fallback-applied、fallback-denied 或 fallback-exhausted；同时把 outcome 安全投影到 audit、脱敏日志、trace 和既有 runtime timeline-only `POLICY_APPLIED` 诊断事实。它不新增核心 DTO，不让 `agent-model` 隐式 fallback，不向用户暴露详细 evidence。

## 变更范围（What Changes）

- 记录 routing safe outcome evidence：path selected、rejected、clarification selected、handoff selected。
- 记录 constraint safe outcome evidence：accepted、rejected、ignored、degraded。
- 在 Agent Core 中实现模型 fallback orchestration：基于 fallback-eligible profile set、当前 `SafeError`、request/run/step 状态和 visible-output gate，按 frozen `fallbackEligibleProfileIds` 顺序选择第一个未尝试 profile、拒绝 fallback 或判定候选耗尽。
- 记录 fallback safe outcome evidence：fallback applied、fallback denied、fallback exhausted。
- 复用已冻结 `POLICY_APPLIED` 作为 runtime timeline-only 诊断事实。
- 将 evidence 投影到 audit、structured log 和 trace，必须脱敏或降级为 reason-only。
- 用户只看到最终结果、pending input、handoff 或 `SafeError`，不看到 routing evidence 详情。

## Capability 影响（Capabilities）

### 新增 Capability

- `routing-evidence-and-fallback`: 记录 routing、constraint 和 fallback safe outcome evidence。

### 修改的 Capability

- `agent-routing-core`: 产出 safe routing outcome，供 evidence 记录。
- `model-fallback-semantics`: 承接 archive change 的 deferred upper-layer fallback orchestration；保持 `agent-model` 不做隐式 cross-profile fallback。
- `routing-constraint-validation`: 产出 constraint safe outcome，供 evidence 记录。
- `targeted-skill-routing`: 产出 preferred Skill accepted/rejected/fallback safe outcome，供 evidence 记录。

## 影响范围（Impact）

- `agent-core`: 在 Agent orchestration 内执行 model fallback orchestration，记录 safe outcome evidence，并通过 runtime timeline boundary 发出 `POLICY_APPLIED` timeline-only diagnostic event。
- `agent-app`: 提供 frozen `modelProfileRegistry.fallbackEligibleProfileIds` 和 provider route descriptors；本 change 只消费该 registry，不重新读取原始配置。
- `agent-model`: 继续只执行当前 selected profile；失败时返回 safe failure result，不读取 fallback candidates。
- `agent-observability`: 消费脱敏 evidence，写入 audit、structured log 和 trace；redaction 失败时降级为 reason-only 或跳过对应 sink。
- `agent-runtime`: 接收 `POLICY_APPLIED` timeline-only diagnostic event，不拥有业务 routing，不解释 evidence。
- `agent-channel-web`: 不投影详细 evidence，只展示最终用户可见结果、pending input、handoff 或 `SafeError`。
- `agent-contracts`: 不新增 public core DTO、routing evidence DTO 或 timeline event vocabulary。
- 调度前提：constraint evidence 依赖 `add-ts-routing-constraint-validation` 已能产出 accepted/rejected/ignored/degraded safe outcome；preferred Skill evidence 依赖 `add-ts-targeted-skill-routing` 已能产出 accepted/rejected/fallback safe outcome。本 change 在这些上游 outcome 已存在时负责统一记录和 fallback 编排，不反向定义它们的治理规则。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/routing-evidence-and-fallback/spec.md`：新增 safe outcome evidence、timeline-only、observability redaction 和用户不可见边界。

设计视图：
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 routing evidence owner 和 runtime/channel 边界。
- `openspec/designs/architecture/observability-boundaries.md`：同步 redacted evidence projection。
- `openspec/designs/spec-to-design-map.md`：增加导航。

验证入口：
- `npm test -- --run packages/agent-core/tests/routing-evidence-and-fallback.test.ts`
- `npm test -- --run packages/agent-observability/tests/routing-evidence-redaction.test.ts`
- `npm run lint:architecture`
- `openspec validate add-ts-routing-evidence-and-fallback --strict`
