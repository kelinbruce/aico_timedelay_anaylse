# Executable Tool Sandbox Runtime Design

## 背景和现状

某些 capability（如 `Bash`）执行时可能产生副作用，需要在沙箱中运行以保护宿主系统安全。`add-ts-capability-core-governance` 定义了 capability 的调用契约，但缺少沙箱执行能力。

本 change 是当前 active changes 中 NextAgent 侧沙箱执行接入的职责归口。它不实现真实 sandbox 平台本身，但负责把 executable capability invocation 接入统一 sandbox gateway 协议、映射执行结果，并提供安全可观测信号。local / remote 的具体 sandbox adapter 分别落在对应 gateway package。

## 目标和非目标

### 目标
- 复用 `agent-contracts/gateway` 冻结的 sandbox gateway 契约（`SandboxGatewayPort`、`SandboxExecutionRequest`、`SandboxExecutionResult`），不得新建竞争词汇
- 明确 local / remote sandbox adapter 都实现同一个 `SandboxGatewayPort` 对外协议，具体实现分别归 `agent-platform-gateway-local` / `agent-platform-gateway-remote`
- 定义 executable capability sandbox 路由边界；该判定属于 capability invocation/risk policy/executor 边界，无需扩展 `CapabilityDescriptor`
- 定义 capability 与沙箱的集成方式
- 定义 Skill script、hook、bash、python 和模型生成代码等 executable capability 必须经过 sandbox gateway 的安全边界
- 明确本 change 拥有沙箱执行接入主链，不把该职责分散到 gateway configuration、cross-platform executable semantics 或 deny-by-default adapter change

### 非目标
- 不定义沙箱的具体实现技术
- 不定义沙箱的进程隔离细节
- 不定义跨平台的沙箱策略
- 不定义 Windows/Linux 命令归一、平台特定解释器解析或可执行语法策略
- 不在 `CapabilityDescriptor` 上增加 `requiresSandbox` 字段；后续若需该字段，需经核心契约变更流程，不在本 change 范围内

## 黑盒目标（Blackbox Goal）

当任意 executable capability 被调用时，系统必须在 capability invocation / executor 边界内完成可见性、参数、risk policy、工作目录和环境 allowlist 校验，随后构造 `SandboxExecutionRequest` 并调用当前装配的 `SandboxGatewayPort`。无论当前 adapter 是 local sandbox adapter、remote sandbox adapter，还是 deny-by-default / unavailable adapter，本 change 都负责把 `SandboxExecutionResult` 映射为安全的 `CapabilityInvocationResult`，并留下不泄漏命令正文、宿主路径、stdout/stderr、secret 或内部执行轨迹的 observability。

## 相邻 Change 边界（Adjacent Change Boundaries）

- `add-ts-sandbox-deny-by-default-adapter`：拥有 restricted local / remote sandbox 不可用、禁用、未配置或平台不支持时的安全兜底 adapter selection 和 deny/unavailable `SandboxExecutionResult` 生成；本 change 只消费该结果并映射为 capability failure。
- `add-ts-cross-platform-executable-semantics`：拥有 Builtin Tool 的平台语义适配；本 change 拥有适配后 executable work 的 sandbox gateway submission 和 result mapping。
- `add-ts-gateway-configuration`：拥有 gateway section 配置冻结和 adapter selection 输入；本 change 拥有统一 sandbox execution protocol、capability routing、result mapping 和 sandbox execution observability。
- gateway adapter packages：`agent-platform-gateway-local` 拥有本地受限 sandbox adapter 实现，`agent-platform-gateway-remote` 拥有远端 sandbox gateway adapter 实现；两者都只通过 `SandboxGatewayPort` 对上暴露。
- 真实 sandbox 服务 / 后续真实 adapter change：拥有容器、进程隔离、资源计量和远端执行平台实现；本 change 不把这些平台细节提升为 capability/runtime contract。

## 设计决策

### D1: SPI 可插拔设计

```typescript
// 复用冻结契约（SandboxGatewayPort 等位于 agent-contracts/gateway）
interface SandboxGatewayPort {
    execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}
```

**为什么**：
- 复用 `core-contracts.md` 冻结的 sandbox gateway 契约，不得引入竞争词汇
- sandbox 执行由当前装配的 local 或 remote gateway adapter 承接，NextAgent 上层只调用 `SandboxGatewayPort`
- 异步执行允许长时间运行的命令不阻塞主流程
- `SandboxExecutionRequest`/`SandboxExecutionResult` 形态已由冻结契约定义

### D2: 沙箱调用方式

沙箱执行通过当前装配的 `SandboxGatewayPort` adapter 完成。local 运行态默认使用 `agent-platform-gateway-local` 的 restricted local sandbox adapter，remote sandbox gateway adapter 位于 `agent-platform-gateway-remote`。两个 adapter 都实现同一个冻结 port，并在包内私有地适配本地隔离机制或外部 sandbox 服务协议。

```typescript
// local / remote adapter 均实现同一个对外协议，内部实现细节不进入 public contract
class LocalSandboxGatewayAdapter {
    async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}

class RemoteSandboxGatewayAdapter {
    async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}
```

**为什么**：
- capability/runtime 只关心冻结的 `SandboxGatewayPort` 接口，不根据 local / remote 分叉执行逻辑
- 具体本地隔离机制、远端 endpoint、polling、credential header、retry 或 SDK 形态属于 adapter 私有实现，不进入本 change 的公共契约
- 异步调用避免长时间执行的 tool 阻塞主流程

### D3: Sandbox 路由由 Capability 种类决定

可执行 capability（shell、python、bash、脚本、模型生成代码等）必须通过 sandbox gateway 执行。**路由判定机制**：executor/risk policy 根据 capability 的执行种类（TOOL/executable tool kind）判定，无需 `CapabilityDescriptor` 新增 `requiresSandbox` 字段。`agent-runtime` 只传递 request lifecycle、cancellation、timeout、timeline 和 terminal commit 相关上下文，不根据 capability 业务语义决定 sandbox 路由。

**具体判定方式**：`BuiltinToolExecutor` 在收到 `bash`/`python` 等 executable tool invocation 时，直接将该 invocation routing 到 sandbox gateway path，无需在 descriptor 中查找 `requiresSandbox` 标志。后续若新增其他 executable capability kind，也由 executor 直接判定 routing 到 sandbox path。

**关于 `requiresSandbox` 字段**：`requiresSandbox` 字段扩展已从本 change 移除。后续若需在 `CapabilityDescriptor` 上增加该字段，需经核心契约负责人确认后，以独立 contract refinement change 方式添加到 `CapabilityDescriptor`，不影响本 change 的 executor routing 逻辑。

### D4: 执行结果复用冻结契约

`sandbox gateway` 的执行结果形态已由 `core-contracts.md` 的 `SandboxExecutionResult` 冻结，不得新建竞争词汇。当前冻结契约不包含 resource usage 或 audit refs 字段，因此本 change 不扩展 `SandboxExecutionResult`；资源超限、不可用、拒绝、timeout、canceled 和执行失败等结果均通过既有 `safeError`、`timedOut`、受控 `stdout` / `stderr` 或安全 `resultRef` 映射表达。

### D5: Executable capability sandbox boundary

- Discovery 和 Skill 内容加载阶段只能登记安全 executable resource refs，不得执行脚本或暴露 raw path。
- Capability invocation 必须先校验可见性、参数、风险 policy、working directory 和 env allowlist；sandbox availability 由当前装配的 `SandboxGatewayPort` adapter 统一表达。
- 通过 sandbox gateway 构造 `SandboxExecutionRequest` 并调用 `SandboxGatewayPort`；不得定义竞争性的 sandbox request/result 形态。
- `SandboxExecutionResult` 必须映射为 `CapabilityInvocationResult`，只向上层暴露安全摘要、SafeError、`resultRef`、`artifactRefs`、metadata 或受控 generatedMessages。
- 当当前装配的是 deny-by-default / unavailable adapter 时，capability 必须消费该 adapter 返回的 deny/unavailable `SandboxExecutionResult` 并映射为显式 SafeError-compatible failure 或安全 `resultRef`，不得自行绕过 gateway 另造不可用执行分支。
- Sandbox policy 拒绝、timeout、canceled、command failed、output too large 或 resource exceeded 时，必须返回显式 SafeError-compatible failure 或安全 `resultRef`。
- 系统不得静默截断输出，不得在 sandbox 失败时回退到 unsandboxed local execution。
- capability、hook 或 policy 尝试直接执行 shell、python、脚本或模型生成代码时必须拒绝。

## 模块归属

| 组件 | 模块 | 说明 |
|------|------|------|
| `SandboxGatewayPort` | `agent-contracts/gateway` | 复用冻结契约（core-contracts.md 已有定义），不得新建竞争接口 |
| `SandboxExecutionRequest` | `agent-contracts/gateway` | 复用冻结契约 |
| `SandboxExecutionResult` | `agent-contracts/gateway` | 复用冻结契约 |
| `RestrictedLocalSandboxGatewayAdapter` | `agent-platform-gateway-local` | local 运行态默认 restricted local sandbox adapter，实现 `SandboxGatewayPort`；不得暴露本地隔离、路径、进程或宿主细节；不负责 deny-by-default adapter selection |
| `RemoteSandboxGatewayAdapter` | `agent-platform-gateway-remote` | 远端 sandbox gateway adapter，实现 `SandboxGatewayPort`；远端协议细节停留在 adapter 私有实现；不负责 deny-by-default adapter selection |
| sandbox 路由决策 | `agent-capability` capability invocation / risk policy / executor boundary | 根据 capability 执行种类判定是否需要 sandbox，无需扩展 `CapabilityDescriptor`；runtime 不做 capability 语义路由 |

## 质量属性设计

### 安全性
- 资源隔离：沙箱内的执行不能影响宿主系统
- 最小权限：沙箱默认拒绝所有权限
- 输出截断：防止恶意输出耗尽内存
- 超时保护：防止无限循环占用资源

### 性能
- 沙箱启动开销：应尽量复用沙箱实例
- 输出截断：避免大输出影响内存

### 可观测性
- 在 sandbox request submission 和 result mapping 点产生最小安全诊断事实，至少区分 submitted、completed、failed、timeout / canceled、denied / unavailable
- 诊断事实不得包含 raw command、raw stdout/stderr、host path、secret、credential 或完整内部执行轨迹
- 资源类失败只能通过当前 adapter 返回的 `safeError` 或等价安全结果表达；不得要求 `SandboxExecutionResult` 新增 resource usage 字段，也不在本 change 内实现完整 telemetry 平台

## 实现要求（TypeScript）

- public adapter boundary 需要说明其 `SandboxGatewayPort` contract。
- 非显然的错误归一化、输出边界处理或安全降级逻辑需要短注释；避免为直观代码添加机械注释。

## 归档前基线提升计划

归档时需要把长期有效内容提炼到：
- `openspec/specs/capability-spi/spec.md`（修改）
- `openspec/designs/contracts/capability-spi.md`（修改）

## 风险与取舍

| 风险 | 缓解方式 |
|------|----------|
| 沙箱实现复杂 | local / remote adapter 都只承接 `SandboxGatewayPort`，真实隔离平台或远端协议细节保持在对应 gateway package 或后续独立 change |
| 沙箱性能开销 | 支持沙箱实例复用 |
| 资源计量不准确 | 不扩展 `SandboxExecutionResult`；资源超限以 safe failure 或受控 result-ref 映射表达 |
| sandbox 失败后出现非受控本地执行回退 | 明确禁止 fallback，并用 negative case 验证绕过路径被拒绝 |
