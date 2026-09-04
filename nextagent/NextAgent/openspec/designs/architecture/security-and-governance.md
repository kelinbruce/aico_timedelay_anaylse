# Security And Governance

本设计记录跨模块安全治理事实，尤其是插件、policy、hook 和 capability 扩展的最小安全边界。行为性验收要求由对应 spec 承载；本文件只描述长期架构原则。

## Agent-scoped Plugin Governance

本地 TypeScript 插件只允许通过 trusted startup composition 加载。`agent-app` 读取 `nextAgent.system.plugins[]` 中显式声明的插件条目，最多 8 个，路径必须相对 `configRoot`，并被 containment 校验限制在插件目录内。产品路径不做目录扫描、glob、URL/remote loading、archive 解包、runtime hot load、marketplace 分发或插件私有 `npm install`。

每个插件目录包含 `plugin.json`；`plugin.json.main` 指向同目录内的单文件 `.js` ESM bundle。加载前必须完成 manifest schema 校验、API version 校验、路径 containment 校验和 bundle 静态扫描。静态扫描必须拒绝 static import、re-export-from 和字符串字面量 dynamic import specifier，避免插件绕过 host external inventory 引入任意模块。

`plugin.json` 是部署 artifact 的权威 manifest。`pluginId` 必须是 safe id，并与插件 export 的 plugin id 一致；`version` 是插件作者发布版本，只用于 safe diagnostic、registry snapshot 和 activation refs；`apiVersion` 是 NextAgent plugin API contract 版本，采用 major/minor 字符串，当前唯一支持 `"1.0"`；`main` 必须是插件目录内的相对 `.js` 文件；`artifactType` 当前只允许 `esm-bundle`；`hostExternals` 只允许声明 host external inventory 中的 id 和兼容版本范围。

当 `plugin.json.apiVersion` 缺省时，loader 先使用插件 export 的 `apiVersion`；若 export 也缺省，则按当前 host latest supported API version 解释。显式声明但 host 不支持的版本必须在 materialize provider/policy/hook 前 fail closed。`plugin.version` 不得用于 host API contract 选择。

host external inventory 当前只开放 `typebox` 和 `ajv`：`typebox` 对应 `@sinclair/typebox` schema 构建 surface，`ajv` 对应 `ajv` validation surface。插件可以在构建期把依赖打包进 bundle；只有需要共享 host 工具库时才声明 `hostExternals`。loader 只按 manifest 声明注入 `{ externals }` 给默认导出的 factory，不做 Node module resolution fallback。未知 external id、版本不兼容、非 factory 插件声明 host external、bundle 残留 runtime import specifier、unsupported api version、非法 bundle、缺失 default factory、factory 抛错或贡献 shape 非法都必须 fail closed，并映射为安全 diagnostic。

插件加载产物是冻结的 plugin registry snapshot，记录 safe plugin metadata 和已校验的 provider/policy/hook contribution。该 snapshot 只表示代码已被 trusted startup composition 接收，不授予任何 Agent 可见性或执行权限。运行期 request 只能消费 snapshot 与 accepted AgentAssembly activation facts，不能从 request body、client metadata、model output、SkillHub package、remote URL 或 Agent package 未授权路径触发新插件加载。

## Contribution Governance

插件可以贡献 capability provider、lifecycle hook 和开放 policy executable。插件贡献不是运行时全局注册；`agent-app` 在启动期 materialize 为受信对象，再分别交给 owning package：

- capability provider 交给 `agent-capability`，由统一 provider contribution assembly、catalog governance 和 invocation path 处理；
- lifecycle hook 交给 startup hook registry，并按 AgentAssembly hook activation snapshot 由 `agent-runtime` 执行；
- policy executable 交给 `agent-runtime` 的 policy registry/resolver，具体 policy point owner 通过 typed adapter 查询并执行。

Agent package 通过 `capabilityBindings`、`hooks` 和 `policies` 显式激活插件贡献。没有 Agent-scoped activation 的插件贡献不可见、不可搜索、不可执行。

插件加载、Tool 绑定、policy 激活和 hook 激活是四类不同事实。System config `plugins[]` 只声明可加载的本地插件目录；plugin `providers[]` 只声明可注册的 capability provider；Agent `capabilityBindings` 决定当前 Agent 可见、可搜索、可 resolve、可 invoke 的 plugin Tool；Agent `policies` 编译为 `AgentAssembly.policies`，决定当前 Agent 激活的开放 policy implementation；Agent `hooks` 编译为 `AgentAssembly.hooks`，决定 lifecycle hook 的 stage、enabled/disabled、配置、超时和 order。

Request acceptance 固化 `agentId`、`agentVersion` 和 `agentAssemblyRef` 后，capability、policy 和 hook 执行都必须使用 accepted Agent 的 frozen facts。不得因为插件已全局加载，就让其它 Agent 看到 provider、执行 policy 或触发 hook。

## Policy Governance

Policy registry 是不同形状 policy executable 的统一容器，只提供按 accepted Agent scope 和 policy point 查询的能力，不规定所有 policy 共享同一个输入输出形状。开放 policy 必须先进入固定 inventory：

```text
agentRoutingPolicy        OPEN      owner: agent-core
restrictedOperationPolicy RESERVED  owner: agent-runtime
modelSelectionPolicy      RESERVED  owner: agent-core/agent-model
modelFallbackPolicy       RESERVED  owner: agent-model
contextWindowPolicy       RESERVED  owner: agent-context-engine
```

当前闭合 policy 示例包括 `redactionPolicy`、`promptAssemblyPolicy`、`capabilityConflictResolutionPolicy`、`observabilityProjectionPolicy`、`authorizationAnswerPolicy` 和 `gatewayRetryPolicy`。这些 policy 不允许通过插件覆盖。

Agent `policies` 编译为 runtime-facing `AgentAssembly.policies`，只包含 implementation-free activation facts：`policyPointId`、`pluginId`、`policyId`、`enabled`、可选 `timeoutMs` 和 validated `config`。如果 activation 指向不存在、未开放或 shape 非法的 policy，Agent assembly 必须在启动期 fail closed；运行期不保留 unavailable policy 状态。

`agentRoutingPolicy` 使用既有 core routing policy contract：`decide(RequestRun, RequestContext, AbortSignal)`，返回与 `agent-contracts/core.AgentRoutingDecision` 对齐的结果。Core routing adapter 必须先通过 injected policy resolver 查询 accepted Agent 是否激活 `agentRoutingPolicy`；若未激活则执行系统内置默认 routing policy；若已激活则直接执行插件 policy，不先运行内置 policy。插件 routing policy 接收与内置 routing policy 相同的 `RequestRun` 和 `RequestContext`，包括既有 `acceptedInputText` 语义；policy registry 或 wrapper 不得做额外 summary、redaction、truncation 或字段投影。未来如果要收紧 routing 输入，必须在 core routing 业务 contract 中统一定义，并同时适用于内置和插件 routing policy。

Policy implementation 可以声明 `configSchema` 和 `configure(config)`。`AgentAssembly.policies.config` 必须在启动期按 schema 校验，并只用于 materialize assembly-specific executable；raw config 不进入运行期 policy input。Duplicate enabled activation、invalid config、reserved/unknown policy point、缺失 plugin/policy executable 都必须在 loader、Agent assembly compiler 或 policy registry materialization 阶段 fail closed。

## Safe Diagnostics

Capability 的模型/Web 安全失败面只允许规范化 `status`、`SafeError.code/category/message/retryable/safeDetails`、通过 schema 的安全部分 payload、opaque refs 和低基数 metadata。`safeError.message` 必须说明领域事实与可操作下一步；violations 只包含字段路径、约束和期望形态，不回显非法参数值。完整安全结果在 `256000` UTF-16 code unit 容量内不得截断，超限时通过显式容量错误和受控外置引用处理。

只有 risk policy 明确返回 `REQUIRE_AUTHORIZATION` 才能进入 runtime-owned authorization pending-input 生命周期。普通 `AUTHORIZATION` SafeError，以及 code、message 或 `safeDetails` 中的授权提示，都只是最终失败并按普通 Agent/Workflow 消费规则处理。Lifecycle Hook 的 `PEND`、`DENY`、`BLOCK` 也只由显式控制结果触发，不能从错误文本或模型输出推断。失败反馈不得授予权限；模型提出的后续调用必须重新经过 Agent Scope、Owner Scope、risk policy、capability governance 和 sandbox 边界。

插件相关 diagnostic 只允许携带稳定低基数字段：`pluginId`、`providerId`、`capabilityId`、`policyPointId`、`policyId`、`hookId`、`agentId`、`agentVersion`、`agentAssemblyRef`、reason code、bounded safe summary 和 low-cardinality outcome。

Diagnostic、safe error、log、metric、trace 和 audit 不得包含 host path、raw config、secret、credential、prompt、model output、tool arguments/result、raw provider response、stack trace 或高基数字段。

## Deferred Scope

本治理基线不定义 runtime hot loading、remote plugin marketplace、plugin private dependency install、plugin archive distribution、multi-version SDK compatibility implementation、非 `agentRoutingPolicy` 开放 policy、插件授权 UI 或 Web maintenance API。

## Capability 失败处置协作

统一 Capability 边界只向 consumer 交付安全最终结果；arguments、非法原值、raw exception/provider body、路径、credential、文件或命令内容和中间 attempts 均不得进入模型、Web、stream、timeline 或 audit。owner/agent scope、授权、result-unknown 声明和非幂等重放约束的详细矩阵见 `openspec/designs/architecture/capability-invocation-and-failure-disposition.md`。
