# ADR: Agent-scoped Startup Plugin Composition

## Status

Accepted

## Context

NextAgent 需要允许本地 TypeScript 插件扩展 capability provider、lifecycle hook 和少量开放 policy，同时保持电信级安全边界：插件代码不能在请求路径动态加载，不能通过目录扫描或远端分发扩大攻击面，也不能绕过 Agent Scope activation 直接进入运行态。

既有系统已经有统一 Capability SPI、startup-composed lifecycle hook、AgentAssembly 冻结快照和 runtime-owned request lifecycle。插件机制必须复用这些边界，而不是新增平行 catalog、hook executor 或 policy pipeline。

## Decision

插件加载限定为 trusted startup composition。`agent-app` 从系统配置显式插件列表读取本地插件目录，校验 `plugin.json`、API version、路径 containment、single-file ESM bundle 和 host external declaration 后，调用默认 factory 取得贡献对象。加载后的贡献按类型交给 owning package：capability provider 进入 `agent-capability`，hook 进入 startup hook registry，policy executable 进入 `agent-runtime` policy registry。

Agent package 只通过 `capabilityBindings`、`hooks` 和 `policies` 激活贡献。Capability、hook 和 policy 都按 accepted run 固化的 Agent scope 与 AgentAssembly facts 查询执行；没有激活就不可见、不可执行。

Policy registry 只作为不同 policy shape 的统一容器。具体 policy point owner 保留 typed adapter 和业务执行逻辑。当前只开放 `agentRoutingPolicy`，由 `agent-core` 在 routing 边界查询 `policyResolver.resolve(...)`；若没有插件 policy，执行既有默认 routing policy。

## Consequences

- `agent-app` 仍是 composition root，但不承载 capability、hook 或 policy 的业务执行逻辑。
- `agent-runtime` 承载 Agent-scoped policy registry/resolver 这一运行时机制；各模块依赖 `agent-contracts` 中的接口，并由 app composition 注入实现。
- `agent-core` 保持 Agent 内部 routing owner，插件路由 policy 与默认路由 policy 使用同一个既有 `RequestRun`、`RequestContext` 和 `AbortSignal` 形状。
- 插件安全边界优先于灵活性：不支持 hot reload、remote marketplace、private `node_modules`、archive install 或未声明 external fallback。

## Rejected Options

- **Runtime hot loading**：会把代码加载失败、权限治理和版本兼容问题带入 request path，不符合当前可靠性和可诊断目标。
- **Remote plugin marketplace first**：需要独立分发、签名、升级、授权和回滚治理，超出本地 TypeScript 插件的目标。
- **把 policy registry 放在 agent-app**：`agent-app` 只应做装配，registry/resolver 属于运行时机制，且 app package 是可选 composition root，不应成为业务模块的直接依赖。
- **把所有 policy 强制成同一函数 shape**：不同 policy point 的输入输出语义不同，统一函数 shape 会把类型约束推迟到运行期并阻碍后续开放更多 policy。
