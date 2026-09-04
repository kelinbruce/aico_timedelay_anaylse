## ADDED Requirements

### Requirement: Executable Sandbox Runtime 拥有 Sandbox 执行集成

在 active change 集合内，本 change SHALL 拥有可执行 capability 调用的 NextAgent 侧 sandbox 执行集成。该集成 MUST 覆盖可执行 capability 路由、`SandboxExecutionRequest` 构造、统一的 `SandboxGatewayPort` 提交、`SandboxExecutionResult` 到 `CapabilityInvocationResult` 的映射，以及安全的 sandbox 执行 observability。本地和远端 sandbox 实现 MUST 保持在 gateway adapter package 之内，并暴露同一 port 契约。

本需求 MUST NOT 被解释为拥有真实 sandbox 平台实现。容器隔离、进程隔离、资源强制限制、本地 adapter 内部实现和远端执行服务实现保持在 capability/runtime 面向的协议之外，除非由对应的 gateway adapter package 或独立的平台 change 定义。

#### Scenario: 可执行 sandbox 执行以本 change 为集成 owner

- **WHEN** 一个可执行 capability 需要沙箱化执行
- **THEN** NextAgent 侧的执行集成 MUST 由本 change 治理
- **AND** gateway 配置、跨平台 executable 语义和 deny-by-default adapter 变更 MUST NOT 定义与之竞争的 sandbox 执行路由或结果映射行为

### Requirement: 可执行 Capability 调用 MUST 穿越 Sandbox Gateway 边界

具有宿主侧副作用的可执行 capability MUST 只通过 sandbox gateway 边界执行。Shell、python、script、hook、bash 和模型生成代码的执行 MUST NOT 直接在宿主进程中运行。

#### Scenario: 可执行 capability 使用 sandbox gateway

- **WHEN** capability 调用边界调用一个需要沙箱化执行的 capability
- **THEN** 该调用 MUST 经 sandbox gateway 边界路由
- **AND** 系统 MUST NOT 在宿主进程中直接执行该 capability

#### Scenario: 直接宿主执行绕过被拒绝

- **WHEN** 一条 capability、hook、policy 或生成代码路径尝试在 sandbox gateway 之外执行 shell、python、script、bash 或等价代码
- **THEN** 系统 MUST 以安全失败 outcome 拒绝该尝试

### Requirement: Sandbox 执行使用统一的请求与结果边界

本 change 中的沙箱化执行 MUST 使用单一受治理的请求/结果边界。系统 MUST 从可信执行事实构造 sandbox 请求，并 MUST 把 sandbox 结果映射回 `CapabilityInvocationResult`。

#### Scenario: 沙箱化调用被映射回 capability 结果

- **WHEN** 一次 capability 调用的 sandbox 执行完成
- **THEN** 系统 MUST 把 sandbox 结果映射进 `CapabilityInvocationResult`
- **AND** 它 MUST NOT 为 sandbox 执行暴露与之竞争的 runtime 面向结果词表

### Requirement: 执行前校验发生在 Sandbox 提交之前

在把可执行工作发送给 sandbox 之前，系统 MUST 至少校验：

- capability 可见性
- 调用参数
- risk policy outcome
- 工作目录约束
- 环境 allowlist 约束

Sandbox 可用性 MUST 由当前组合的 `SandboxGatewayPort` adapter 结果表达。当组合的 adapter 是 deny-by-default 或不可用时，Capability 调用 MUST NOT 绕过 gateway，也 MUST NOT 创建与之竞争的不可用执行分支。

#### Scenario: 无效执行输入不到达 sandbox

- **WHEN** 调用未通过可见性、参数、risk policy、工作目录或环境校验
- **THEN** 系统 MUST 在 sandbox 提交之前安全失败
- **AND** 它 MUST NOT 把无效执行请求提交给 sandbox gateway

### Requirement: Discovery 与内容加载 MUST NOT 执行本地命令

Discovery、descriptor 注册和 Skill 内容加载 MUST 只注册安全的可执行资源引用和已校验的 capability 事实。这些阶段 MUST NOT 执行本地命令，MUST NOT 在 capability descriptor 中暴露 raw 宿主路径。

#### Scenario: Skill discovery 注册 ref 而不执行本地命令

- **WHEN** 系统发现一个可执行 capability 或 Skill 支撑的可执行资源
- **THEN** discovery MUST 只注册安全的可执行资源 ref 或已校验的 capability 事实
- **AND** 它 MUST NOT 在 discovery 或内容加载期间执行本地命令
- **AND** 产出的 descriptor MUST NOT 暴露 raw 宿主路径

### Requirement: Sandbox 失败与资源限制是显式的

Sandbox 不可用、policy 拒绝、timeout、cancellation、命令失败、输出过大和资源超限条件 MUST 产生显式的安全失败 outcome。系统 MUST NOT 静默截断输出，也 MUST NOT 在 sandbox 执行失败时回退到未沙箱化的本地执行。

#### Scenario: Sandbox 不可用不回退到宿主执行

- **WHEN** 需要 sandbox 执行且组合的 sandbox gateway adapter 返回 deny 或不可用结果
- **THEN** 系统 MUST 把该 `SandboxExecutionResult` 映射为安全的不可用 capability outcome
- **AND** 它 MUST NOT 通过在 sandbox 之外本地运行同一可执行工作来重试

#### Scenario: 输出过大是显式的

- **WHEN** 沙箱化执行产生超出允许安全边界的输出
- **THEN** 系统 MUST 返回显式的安全失败或安全的 result-ref outcome
- **AND** 它 MUST NOT 静默截断输出并假装执行正常完成

### Requirement: Sandbox 结果 MUST NOT 泄露宿主敏感细节

从 sandbox 执行派生的 capability 结果 MUST NOT 在 runtime 面向的 capability 结果边界暴露宿主路径、raw 命令、raw stdout/stderr、secret、credential 或完整内部执行 trace。

#### Scenario: 沙箱化 capability 结果被脱敏

- **WHEN** 系统为沙箱化执行返回一个 capability 结果
- **THEN** 该结果 MUST 只保留安全的摘要字段、安全 ref、安全 metadata 和受治理的失败信息
- **AND** 它 MUST NOT 泄露宿主路径、raw 命令、raw stdout/stderr、secret、credential 或完整内部执行 trace

### Requirement: Sandbox 可用性与执行可观察

系统 MUST 为 sandbox 执行开始、完成、失败、timeout 和资源限制 outcome 发出安全的 observability 信号。这些信号 MUST 能支撑运维，而不暴露敏感执行内容。

#### Scenario: Sandbox 执行失败发出安全 diagnostics

- **WHEN** sandbox 执行失败、超时或超出资源限制
- **THEN** 系统 MUST 为该 outcome 发出安全 diagnostics 或 metrics
- **AND** 那些 observability 信号 MUST 遵守针对命令、输出、secret 和宿主路径的 redaction 边界
