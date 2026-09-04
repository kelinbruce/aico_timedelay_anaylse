## 背景与问题（Why）

某些 capability（如 `Bash`）执行时可能产生副作用，需要在沙箱中运行以保护宿主系统安全。

`add-ts-executable-tool-sandbox-runtime` 旨在为有副作用的 capability 提供沙箱执行环境，确保：
- 工具执行不会影响宿主系统安全
- 工具执行资源受限，不会耗尽系统资源
- 工具执行可被监控和审计

在当前 active changes 中，本 change 是 NextAgent 侧“沙箱执行接入”的唯一职责归口：负责 executable capability 到统一 `SandboxGatewayPort` 协议的执行路由、执行结果到 capability result 的映射，以及 sandbox execution observability。local / remote sandbox 的具体执行 adapter 分别由对应 gateway package 实现；真实 sandbox 平台本身的容器、进程隔离、资源限制实现仍由外部 sandbox 服务或后续独立 change 承接。

## 变更范围（What Changes）

- **新增** `add-ts-executable-tool-sandbox-runtime` change
- **复用** `agent-contracts/gateway` 冻结契约：`SandboxGatewayPort`、`SandboxExecutionRequest`、`SandboxExecutionResult`
- **定义** 统一 sandbox execution 协议：对外只暴露 `SandboxGatewayPort`、`SandboxExecutionRequest`、`SandboxExecutionResult`；local / remote 具体 adapter 分别位于 `agent-platform-gateway-local` / `agent-platform-gateway-remote`
- **新增** executable capability 必须经 sandbox gateway 执行的边界路由；该判定由 executor 根据 capability 执行种类直接路由，无需扩展 `CapabilityDescriptor`

## Capability 影响（Capabilities）

### 修改的 Capability
- `agent-capability` - capability invocation sandbox routing、risk policy 校验和执行结果映射
- `agent-runtime` - 只传递 cancellation/timeout/lifecycle context，不根据 capability 语义决定 sandbox 路由

## 影响范围（Impact）

- `modules/agent-capability` - sandbox routing 与 `CapabilityInvocationResult` 映射
- `modules/agent-observability` - 仅消费最小安全 sandbox 诊断事实；不在本 change 内实现完整 telemetry 平台

## 外部依赖

- 沙箱配置由其他团队构建和维护
- local 运行态默认通过 `agent-platform-gateway-local` 的 restricted local sandbox adapter 接入；remote sandbox gateway 通过 `agent-platform-gateway-remote` adapter 接入；具体本地隔离机制和远端协议细节停留在对应 adapter 私有实现内

## 主要 Owner

- Owner 9 Tool Capability

## 职责归属（Responsibility）

- 本 change 负责沙箱执行接入主链：`executable capability invocation -> SandboxExecutionRequest -> SandboxGatewayPort -> local/remote sandbox adapter -> SandboxExecutionResult -> CapabilityInvocationResult`。
- `add-ts-sandbox-deny-by-default-adapter` 只负责 restricted local / remote sandbox 不可用、禁用、未配置或平台不支持时的 deny/unavailable 兜底 adapter；本 change 消费其结果，不重新定义其 adapter 行为。
- `add-ts-cross-platform-executable-semantics` 只负责 Builtin Tool 的平台命令、路径、解释器、工作目录和 env 语义适配；需要执行时仍交由本 change 的 sandbox gateway path。
- `add-ts-gateway-configuration` 只负责 gateway section 的启动期配置选择、校验和冻结；具体装配哪个 local/remote sandbox adapter 由 app composition 消费其冻结结果，本 change 拥有统一 sandbox execution protocol、capability routing 和 result mapping。

## 非目标（Non-Goals）

- 不定义沙箱的具体实现技术（由具体部署环境决定）
- 不定义沙箱的进程隔离细节（由沙箱实现决定）
- 不定义跨平台的沙箱策略（首版聚焦单一沙箱实现）
- 不定义 Windows/Linux 命令归一、平台特定解释器解析或可执行语法策略；这些由跨平台可执行语义 change 承接
- 不允许 shell、python、hook、bash、脚本或模型生成代码绕过 sandbox gateway 直接在宿主进程执行
- **不在 `CapabilityDescriptor` 上增加 `requiresSandbox` 字段**：本 change 的 sandbox routing 由 executor 根据 capability 执行种类（executable tool kind）直接判定，无需 descriptor 标志；后续若需在 `CapabilityDescriptor` 上增加 `requiresSandbox` 字段，须经核心契约负责人确认后以独立 contract refinement change 方式实施
- 不重新定义 sandbox unavailable / deny-by-default adapter 行为；当当前 `SandboxGatewayPort` adapter 返回不可用或拒绝结果时，本 change 只消费标准 `SandboxExecutionResult` 并映射为 capability failure
