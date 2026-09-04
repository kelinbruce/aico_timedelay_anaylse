## 背景与问题（Why）

当前仓库已经为 Alpha 和 P0 范围建立了最小内核、产品旅程、安全、恢复和候选运行包等 E2E quality gates，但 roadmap 中面向 `P1`、`P2` 的特性族仍缺少一份统一的“真实边界 E2E 门槛” change。结果是两类风险同时存在。

第一，`P1` 的业务自定义与扩展能力正在沿着真实运行链路进入主产品路径，例如 lifecycle hook、risk policy、skill resource access、attachment request context、AskUser/pending input、RAG、长期记忆、子 Agent、路由和质量门禁。这些能力跨越 `agent-runtime`、`agent-core`、`agent-context-engine`、`agent-capability`、`agent-platform-gateway-*` 和 `agent-channel-web` 等多个 owner；只靠 unit、contract 或单点 integration test，不能证明它们在真实 product composition、真实 transport 和真实 persistence 下仍满足黑盒目标。

第二，roadmap 中部分 `P2` 正式版与扩展候选能力已经具备独立的 OpenSpec 输入或稳定基线能力，例如 gateway configuration、workflow routing/execution/package composition，以及若干仍待激活的远端基础设施、会话与前端扩展能力。发布前如果没有一组按场景归属、按阶段分层的 E2E 门槛，后续实现容易出现“代码已落地，但没有真实边界证据”“多个 gate 重复验证同一场景”或“把尚未稳定的 candidate 愿景误当硬门槛”的问题。

需要一个专门的实现型 E2E gate change，直接为 `P1/P2` 联合特性提供真实边界黑盒用例，并把结果输出为可被 release qualification 消费的门槛证据。这个 change 的黑盒目标不是继续规划“未来谁来测”，而是落出当前必须存在的 `P1/P2` 门槛用例，支撑门槛验证本身。

## 变更范围（What Changes）

- 新增一个面向 `P1/P2` 联合特性的实现型 E2E gate capability，直接交付真实 product process、真实 transport、真实 gateway/persistence 与真实 capability execution 的黑盒用例。
- 在 `tests/e2e/` 下落出当前 `activated` 场景族对应的 case inventory、Vitest 用例、negative gate 和 report writer，并为该 gate 提供单一标准命令。
- 建立 `P1/P2` 场景分层规则：当前 gate 覆盖仓库里已经具备明确 OpenSpec 输入，或已归档进入基线且仍缺真实边界 E2E 证据的全部可实现黑盒场景；`bookmark`、`personalization`、远端 memory / infrastructure adapter 等候选能力，归属到当前 gate 的后续扩面 backlog，但必须先补各自 feature change，不能在缺少稳定 API、权限、持久化 owner 和真实产品闭环时直接进入 activated 清单；纯 contract refinement、纯内部 owner 拆分、当前明确 deferred/not-planned 的事项不进入当前必测清单。
- 明确与 Alpha/P0 product-journey/security/resilience/release-package gate 的唯一归属边界，避免重复主归属。
- 明确本 change 要生成测试代码、用例 inventory、report 和执行命令，但不新增通用 E2E DSL、不重写既有 gate 职责、也不把所有 `candidate` change 提前声明为发布硬门槛。

BREAKING：无。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-e2e-p1-p2-scenario-gate`: 定义并实现 `P1/P2` 联合特性的真实边界 E2E gate、case inventory、执行命令和安全证据要求。

### 修改的 Capability

无。

## 影响范围（Impact）

- 主要影响 `openspec/changes/add-ts-e2e-p2-test/` 下的 proposal、design、specs 和 tasks，并直接驱动 `tests/e2e/`、gate runner script 和 `package.json` 命令的实现落地。
- 间接影响现有 E2E 架构导航与质量门槛设计，特别是 `e2e-quality-gates` 中对 Alpha/P0 与 P1/P2 场景边界的划分。
- 消费 roadmap 中 `P1`、`P2` 的 active/ready/assumption-ready/candidate change 输入，以及已归档进入基线的稳定 capability 输入，但不改写这些 feature change 自身的产品契约。
- 影响测试治理：新增 case inventory、case owner、执行命令、report/evidence 结构和后续扩展边界。
- 不改变 `agent-contracts`、Web API、runtime lifecycle、gateway port 或既有产品行为语义，只增加真实边界测试覆盖和门槛证据输出。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-e2e-p1-p2-scenario-gate/spec.md`：新增 `P1/P2` 联合特性的 E2E 场景门槛契约。

长期背景：
- `openspec/overview.md`：记录 Alpha/P0 之外，`P1/P2` 特性在进入发布门槛前需要真实边界 E2E 场景归属与准入规则。

设计视图：
- `openspec/designs/architecture/e2e-quality-gates.md`：增加 `P1/P2` 场景分层、唯一归属、准入阶段与 evidence 规则。
- `openspec/designs/modules/agent-app.md`：无。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加本 capability 与 E2E 质量门槛设计导航。

验证入口：
- `openspec validate add-ts-e2e-p2-test --strict`
- `openspec validate --all --strict`
