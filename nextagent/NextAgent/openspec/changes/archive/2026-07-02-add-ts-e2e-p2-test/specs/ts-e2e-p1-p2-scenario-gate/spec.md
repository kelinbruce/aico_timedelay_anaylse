## ADDED Requirements

### Requirement: P1P2 E2E 门槛只接收真实边界场景

`ts-e2e-p1-p2-scenario-gate` SHALL 只接收同时经过真实 product process、真实 web transport、真实 gateway or persistence，以及真实 capability or runtime orchestration 的黑盒场景。任何仅通过 mock route、fake stream、直接调用领域 service、直接调用 gateway fixture 或跳过 product composition 的验证，MUST NOT 记为本 gate 的通过证据。

#### Scenario: 真实边界场景进入门槛
- **WHEN** 某个 `P1` 或 `P2` 特性场景通过真实 local product entrypoint、真实 HTTP/SSE/WebSocket、真实 request lifecycle 和真实持久化链路执行
- **THEN** 该场景可以登记为 `ts-e2e-p1-p2-scenario-gate` 的候选 case

#### Scenario: Mock 或绕过主路径的验证不计入门槛
- **WHEN** 用例使用 mock transport、fake capability result、直接 service 调用或只验证 adapter-private fixture
- **THEN** 该用例 MUST NOT 被计为 `ts-e2e-p1-p2-scenario-gate` 的通过证据

### Requirement: P1P2 E2E 门槛按阶段准入场景

系统 SHALL 按 roadmap 阶段和 OpenSpec 成熟度管理 `P1/P2` 场景准入。只有当前已经存在明确 OpenSpec 输入，或已经归档进入基线且仍缺真实边界 E2E evidence 的稳定 capability，且目标行为能形成外部可观察结果的特性，才能进入本 gate 的 case inventory。纯 contract refinement、纯 owner 拆分、纯 deferred implementation、not-planned 能力或尚未形成外部黑盒效果的内部机制，MUST NOT 成为必需 E2E case。

`assumption-ready` 或 `candidate` 特性只有在 proposal/design 中显式固化默认假设、并且形成明确外部验证目标后，才可以被标记为“待激活”场景；在激活前 MUST NOT 阻断门槛结果。

#### Scenario: Active、Ready 或已归档稳定能力进入当前 gate 必测清单
- **WHEN** 某个 `P1/P2` 特性拥有 active 或 ready 的 OpenSpec change，或对应 capability 已归档进入基线且仍缺少真实边界 E2E evidence
- **AND** 其行为会穿过真实产品边界并产生用户或运维可观察结果
- **THEN** 该特性对应场景 MUST 被纳入本 gate 的 case inventory 和当前 gate 执行清单

#### Scenario: Deferred 或内部拆分能力不进入必测清单
- **WHEN** 某个条目仅承载 owner 拆分、纯内部 contract 收敛、deferred implementation 声明或当前 not-planned 结论
- **THEN** 系统 MUST NOT 将该条目直接声明为必需 E2E case

#### Scenario: Candidate 场景先登记后激活
- **WHEN** 某个 `P1/P2` candidate 或 assumption-ready 特性尚未形成稳定产品路径，但已经识别出未来需要真实边界验证的场景
- **THEN** 系统 SHALL 只将该场景登记为待激活项
- **AND** 在未激活前不得以其失败、缺失或 skipped 阻断门槛结果

#### Scenario: 缺少 feature change 的扩面候选先留在当前 gate backlog
- **WHEN** 某个后续扩面候选场景已经被认定应归属 `ts-e2e-p1-p2-scenario-gate`，但仓库中仍不存在对应的 active/ready feature change，或仍缺少稳定 API、权限、持久化 owner、真实 route/store 与产品闭环
- **THEN** 系统 MUST 将该场景保留在当前 gate 的 planned backlog
- **AND** 系统 MUST NOT 直接把该场景提升为 activated case
- **AND** 对应 feature change 落地后，系统 SHALL 继续由当前 gate 承接该场景的黑盒 E2E 扩面

### Requirement: P1P2 E2E case 必须保持唯一主要归属

每个 `P1/P2` 真实边界 E2E case MUST 只有一个主要维护 gate 或 spec。已经由 Alpha gate、P0 product-journey gate、security gate、resilience gate 或 release-package gate 作为主归属覆盖的场景，MUST NOT 在本 gate 中重复记为主要归属。本 gate 只承接 Alpha/P0 未覆盖、且面向 `P1/P2` 特性增量的真实边界场景。

#### Scenario: 已有 gate 覆盖的场景不重复归属
- **WHEN** 某个场景的主要验证目标已经被 Alpha 或 P0 既有 gate 定义为主归属
- **THEN** `ts-e2e-p1-p2-scenario-gate` MUST NOT 再把该场景登记为主要归属

#### Scenario: Edit-resubmit 不进入 P1P2 gate 主归属
- **WHEN** 场景验证目标是 `edit-resubmit` 主路径
- **THEN** 系统 MUST 将该场景排除在 `ts-e2e-p1-p2-scenario-gate` 的主要归属之外
- **AND** 继续由既有 `product-journey` gate 持有其主归属

#### Scenario: P1P2 增量场景建立唯一 owner
- **WHEN** 某个场景验证 `P1/P2` 特性增量，例如扩展治理、pending input、长期记忆、任务/工作流、远端 gateway、P2 会话扩展等真实边界行为
- **THEN** 系统 MUST 为该场景分配唯一的 case id 和唯一主要维护 spec

#### Scenario: Activated case 在当前 gate 中拥有唯一实现位置
- **WHEN** 某个场景已被登记为 `activated`
- **THEN** 该场景 MUST 绑定唯一 `caseId`、唯一 `ownerGate` 和唯一当前实现位置
- **AND** 系统 MUST NOT 让该场景同时作为 product-journey、security、resilience、release-package 或另一个 `P1/P2` gate 的主要归属

### Requirement: P1P2 E2E 门槛证据必须安全且可消费

`ts-e2e-p1-p2-scenario-gate` SHALL 为每个已激活 case 产出 machine-readable evidence，至少包含 case id、所属场景族、成熟度阶段、结果、失败阶段和安全 evidence ref。evidence MUST NOT 包含 raw credential、prompt、完整模型输出、附件内容、未脱敏路径、provider secret、raw backend exception 或 adapter-private DTO。

已激活 case 中任一必需场景 failed、timeout 或缺失时，本 gate MUST 返回 failed；待激活场景只允许出现在 inventory 中，不影响门槛 verdict。

#### Scenario: 已激活必需场景失败时阻断门槛
- **WHEN** 任一已激活的 `P1/P2` 必需 case failed、timeout 或在执行清单中缺失
- **THEN** 本 gate MUST 返回 failed
- **AND** 输出安全 evidence 以标识 case id、失败阶段和关联场景族

#### Scenario: 待激活场景不阻断门槛
- **WHEN** inventory 中的某个场景仍处于待激活状态
- **THEN** 该场景可以显示为 planned 或 inactive
- **AND** 不得因为其未执行、skipped 或无 evidence 而改变当前 gate verdict

#### Scenario: Activated evidence 使用固定最小字段
- **WHEN** 任一 activated case 输出 machine-readable evidence
- **THEN** evidence MUST 至少包含 `caseId`、`scenarioFamily`、`maturityStage`、`ownerGate`、`result`、`failurePhase` 和 `evidenceRefs`
- **AND** `caseId` 与 `ownerGate` MUST 对应 planning gate registry 中登记的唯一 owner

#### Scenario: Forbidden evidence 内容触发失败
- **WHEN** gate report、artifact 或持久化 evidence 包含 raw credential、prompt、完整模型输出、附件正文、未脱敏绝对路径、provider secret、raw backend exception 或 adapter-private DTO
- **THEN** 对应 activated gate MUST 返回 failed
- **AND** 只允许保留安全 reason、hash 或 opaque evidence ref 作为诊断输出

### Requirement: P1P2 E2E gate 必须直接交付门槛用例

`ts-e2e-p1-p2-scenario-gate` SHALL 在当前 change 中直接交付可执行门槛用例，而不是只登记后续实现入口。当前 gate MUST 实现 inventory 中全部 activated case，并提供唯一 runner 命令和 machine-readable report。

#### Scenario: 当前 gate 运行全部 activated case
- **WHEN** 执行 `npm run test:e2e:p1-p2-scenario-gate`
- **THEN** gate MUST 运行 `e2e-P1P2-01`、`e2e-P1P2-02`、`e2e-P1P2-03`、`e2e-P1P2-04`、`e2e-P1P2-05` 和 `e2e-P1P2-06`
- **AND** 任一 case 缺失、skipped、timeout 或 failed 时 gate MUST 返回 failed

#### Scenario: Gate 复用现有 E2E 结构而不新造框架
- **WHEN** 实现 `ts-e2e-p1-p2-scenario-gate`
- **THEN** 测试代码 MUST 落在 `tests/e2e/p1-p2-scenario-gate/` 和对应 runner script 中
- **AND** 实现 MUST 复用现有 release Vitest 配置、helper 和 case inventory 模式
- **AND** MUST NOT 为本 gate 引入新的通用 E2E DSL 或第二套 gate framework
