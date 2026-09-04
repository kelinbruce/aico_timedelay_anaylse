## 背景和现状（Context）

变更前 TS 最小内核已经具备一条可运行的 capability 路径：

```
createReadCapabilityDescriptor()
  -> createStaticCapabilityCatalog([readDescriptor])
  -> agent-app composition 注入 CapabilityCatalog
  -> agent-context-engine listAvailable()
  -> agent-core resolve()
  -> CapabilityInvocationPort.invoke()
  -> CapabilityInvocationResult
```

本 change 的实施路径在该最小路径上收敛为：

```
createCapabilitySubsystem([])
  -> trusted provider { providerId: "builtin-tools", providerKind: "BUNDLED" }
  -> DefaultCapabilityDiscoveryFactory
  -> BuiltinToolsDiscovery.startupDescriptors
  -> StaticCapabilityCatalog.listAvailable()/resolve() runtime gates
  -> GovernedCapabilityInvocationPort
  -> StaticCapabilityExecutorFactory(providerId + kind)
  -> BuiltinToolsExecutor -> read adapter
  -> CapabilityInvocationResult
  -> agent-core request-local result consumption
```

`agent-app` 只从 capability subsystem 接收 `CapabilityCatalog` 和 `CapabilityInvocationPort` 并注入 context/core；Agent assembly 编译不再以 capability descriptor 预发现作为前提。`resource-inventory` 仍保留为 app-owned assembly resource view，但 capability descriptor existence、availability、provider binding 和 conflict uniqueness 均由 catalog 在 request scope 的 `listAvailable` / `resolve` 阶段治理。

相关存量对象：

- `packages/agent-contracts/src/capability/index.ts` 已定义 capability DTO 和 port
- `packages/agent-capability/src/catalog/catalog.ts` 已定义 `StaticCapabilityCatalog`
- `packages/agent-capability/src/builtins/read/descriptor.ts` 已定义 `read` descriptor；变更前 provider id 曾为 `builtin-read`，本 change 的目标 builtin tools provider id 为 `builtin-tools`
- `packages/agent-app/src/composition/create-app.ts` 变更前装配 `createStaticCapabilityCatalog([readDescriptor])`；本 change 实施后通过 `createCapabilitySubsystem(capabilityProviderConfigs)` 取得 catalog/invocation ports

本 change 不推倒这条路径，而是在它之上建立统一骨架，让后续 provider-specific changes 可以接入。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 保留并复用冻结 capability public contract，不新增竞争 DTO、enum 或 port
- 明确 `CapabilityProvider` 是 descriptor 中的轻量 provider identity，不承载配置或执行逻辑
- 定义 `CapabilityProviderConfig` 核心契约，支持同一可配置 `providerKind` 多实例，并作为后续外部配置加载的唯一目标模型；config 使用统一 `{ provider, discoveryMode, options }` 形态，schema/normalization 拒绝 `provider.providerKind=BUNDLED`
- 定义 provider config validation/normalization 路径；builtin provider 由 `agent-capability` 子系统固定注册，不受外部配置控制
- 定义 `EAGER` 和 `SEARCH` 两种 discovery mode 骨架
- 定义单一 `CapabilityDiscoveryFactory`：输入 provider，输出 provider instance discovery
- 定义单一 `CapabilityExecutorFactory`：输入 resolved capability descriptor，输出 executor
- 将 catalog 责任收敛为注册、查询、Agent binding gate、availability verdict、resolve gate 和后续 conflict policy 插槽
- 明确 capability result 由 `agent-core` 显式消费，executor 不直接写 runtime/session/timeline/audit
- 用 `read` capability 作为内置 `BUNDLED` + `EAGER` provider 的最小验证路径

### 非目标

- 不实现具体远端 provider、local directory、SkillHub、MCP server 或 Agent registry discovery
- 不实现外部配置文件格式、配置加载、配置层级合并、租户/Agent 覆盖、热更新或 secret resolver
- 不实现远端 search cache、refresh、download、install 或 TTL
- 不实现具体冲突优先级和 shadowing
- 不实现 Skill invocation、INLINE/FORK、content loader、nested facts 或 fork handoff
- 不实现 sandbox、audit sink、idempotency recovery 或具体 executable tool semantics
- 不将 catalog、discovery、executor 或 factory implementation class 放入 `agent-contracts`

## 设计决策（Design Decisions）

### D1: Provider 和 Source 概念合一

OpenSpec 主叙事只使用 provider，不再引入独立 source 概念。

- `CapabilityProvider` 是 descriptor 中的 provider identity：`providerId`、`providerKind`、`providerType?`
- `CapabilityProviderConfig` 是 provider 实例配置契约，不进入 descriptor；它只允许配置非 `BUNDLED` provider
- `CapabilityDiscovery` 是 provider 实例 discovery adapter
- `CapabilityExecutor` 是 provider 实例 execution adapter
- provider-private layout、raw manifest、endpoint、credential、local path 和 cache dir 只存在于 config/adapter 内部，不进入 descriptor、model context、stream、safe error、audit detail 或 logs

### D2: Provider Kind 和 Provider Instance 分离

`providerKind` 表示类型，`providerId` 表示实例。

同一 kind 可以有多个实例，例如：

```
providerId=mcp-grafana providerKind=MCP_SERVER endpoint=A
providerId=mcp-netops  providerKind=MCP_SERVER endpoint=B
```

descriptor 只携带：

```json
{
  "provider": {
    "providerId": "mcp-grafana",
    "providerKind": "MCP_SERVER"
  }
}
```

`providerId` 必须稳定，因为 Agent binding、diagnostics、executor/discovery instance lookup 和 owner-safe audit facts 都依赖它。

### D2.1: Provider Config 归 Capability Contract Owner

`CapabilityProviderConfig`、`CapabilityDiscoveryMode`、`CapabilityProviderOptions` 和 provider-specific option DTO/schema 由 `agent-contracts/capability` 拥有。该 owner 与 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityCatalog` 和 `CapabilityInvocationPort` 保持在同一 capability public surface 下，避免 app configuration 重新定义 provider/source vocabulary。

实施约束：

- `packages/agent-contracts/src/capability/index.ts` 导出 `CapabilityProviderConfig`、`CapabilityDiscoveryMode`、`CapabilityProviderOptions`、`LocalDirectoryProviderOptions`、`SkillHubOptions`、`McpServerOptions`、`AgentRegistryOptions` 和 `CustomProviderOptions`
- `packages/agent-contracts/src/app/index.ts` 不定义同名 `CapabilityProviderConfig`
- 后续 app configuration 只引用 capability-owned `CapabilityProviderConfig[]`，不拥有 provider option 字段或 provider-specific schema
- 本 change 通过 `ts-core-contracts` contract refinement 将 catalog public contract 从 `CapabilityCatalogPort` 重命名为 `CapabilityCatalog`；descriptor、invocation request 和 invocation result 字段不重命名

### D3: Provider Config 是外部 Provider 的核心契约

`CapabilityProviderConfig` 使用统一 DTO 形态：`provider` 承载 identity，`discoveryMode` 承载发现模式，`options` 承载 provider-specific 配置。该对象在当前 change 中定义为 capability config core contract，用于锁定后续外部配置 change 的目标模型。

`BUNDLED` 是特殊情况：内置 tool、skill、agent provider 由 `agent-capability` 子系统固定注册，不从外部 provider config 读取，不允许通过外部配置覆盖 providerId 或注入 endpoint/options。builtin provider 仍然走同一条 provider -> discovery -> catalog -> executor 骨架。

外部配置文件的位置、格式、加载、层级合并、tenant/Agent 覆盖、secret resolver 和热更新不属于本 change；后续 `add-ts-capability-source-configuration` 只能负责从外部来源产出这里定义的 `CapabilityProviderConfig[]`，不能重新定义 provider/source、discovery、catalog 或 execution 关系。若配置中出现 `provider.providerKind=BUNDLED`，normalization 必须拒绝。

示意形态：

```typescript
type CapabilityDiscoveryMode = "EAGER" | "SEARCH";

interface CapabilityProviderConfig {
  readonly provider: CapabilityProvider;
  readonly discoveryMode: CapabilityDiscoveryMode;
  readonly options: CapabilityProviderOptions;
}

type CapabilityProviderOptions =
  | LocalDirectoryProviderOptions
  | SkillHubOptions
  | McpServerOptions
  | AgentRegistryOptions
  | CustomProviderOptions;

interface LocalDirectoryProviderOptions {
  readonly directoryRef: string;
}

interface SkillHubOptions {
  readonly endpoint: string;
  readonly credentialRef?: SecretReference;
  readonly managedInstallRef: string;
}

interface McpServerOptions {
  readonly endpoint: string;
  readonly credentialRef?: SecretReference;
  readonly timeoutMs?: number;
}

interface AgentRegistryOptions {
  readonly registryRef: string;
  readonly credentialRef?: SecretReference;
}

interface CustomProviderOptions {
  readonly customOptions: JsonObject;
}
```

Schema validation MUST validate `options` by `provider.providerKind` and, for `CUSTOM`, `provider.providerType`. `CUSTOM` MUST include non-empty `provider.providerType` and `CustomProviderOptions.customOptions`; the options union MUST NOT include a bare `JsonObject` branch because that would make provider-specific options too loose.

实施要求：

- 在 `agent-contracts/capability` 定义 provider config DTO/schema，不改变已冻结 descriptor/catalog/invocation/result 字段；schema 不允许 `provider.providerKind=BUNDLED`
- 在 `agent-capability` 子系统内部提供 config validation/normalization，确保 `CapabilityProviderConfig` 的 `provider`、`discoveryMode` 和 `options` 可作为 discovery/executor factory 输入
- trusted builtin providers 必须由 `agent-capability` 子系统创建，并通过同一条 provider -> discovery/catalog/execution 路径执行
- MCP、local directory、SkillHub、Agent registry 和 custom provider config 可以被 schema 表达，但其具体 discovery/executor、远端检索、缓存、刷新、下载和健康检查延后

### D3.1: Builtin Provider 由 Capability 子系统固定注册

本 change 只实施 builtin tools 的最小实例。该实例不是外部配置项，也不需要单独的 builtin definition DTO；`agent-capability` 在子系统创建时内部构造以下 provider identity：

```typescript
const provider: CapabilityProvider = {
  providerId: "builtin-tools",
  providerKind: "BUNDLED"
};

const discoveryMode: CapabilityDiscoveryMode = "EAGER";
```

固定 builtin providers：

| providerId | providerKind | capability kind | 本 change |
|------|------|------|------|
| `builtin-tools` | `BUNDLED` | `TOOL` | 实施 `read` discovery/execution path |
| `builtin-skills` | `BUNDLED` | `SKILL` | deferred |
| `builtin-agents` | `BUNDLED` | `AGENT` | deferred |

外部配置不得新增、删除或替换这些 builtin providers。

`read` descriptor、默认 Agent binding 和 app resource view 必须使用 `providerId=builtin-tools` 和 `providerKind=BUNDLED`。`read` 是本 change 唯一发现的 builtin tool；更完整的 builtin tool discovery 保持 deferred。

### D4: Discovery 按 Provider Kind/Type 创建实例

`CapabilityDiscoveryFactory` 是 capability subsystem 内的单一 factory，不是一组按注册顺序匹配的 factories。它的输入来自 builtin provider 或经过 validation/normalization 的 `CapabilityProviderConfig`，输出是绑定到该 provider identity 的 `CapabilityDiscovery`。

```typescript
interface CapabilityDiscoveryFactory {
  create(input: {
    readonly provider: CapabilityProvider;
    readonly discoveryMode: CapabilityDiscoveryMode;
    readonly config?: CapabilityProviderConfig;
  }): CapabilityDiscovery;
}

interface CapabilityDiscovery {
  readonly provider: CapabilityProvider;
  readonly discoveryMode: "EAGER" | "SEARCH";
  listAll?(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]>;
  search?(criteria: CapabilitySearchCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]>;
  refresh?(scope: CapabilityRefreshScope, signal: AbortSignal): Promise<void>;
  probe?(descriptor: CapabilityDescriptor, signal: AbortSignal): Promise<CapabilityAvailabilityFacts>;
}

interface CapabilitySearchCriteria {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly agentAssembly: AgentAssembly;
  readonly boundCapabilityIds: readonly CapabilityId[];
}
```

Discovery creation MUST be deterministic:

1. The factory reads exact `provider.providerKind`.
2. If `provider.providerKind="CUSTOM"`, the factory also reads exact non-empty `provider.providerType`.
3. The factory creates one discovery instance for the concrete `provider.providerId`.
4. If the factory has no implementation for that `providerKind/providerType`, subsystem creation MUST fail with a safe configuration error in this change.
5. There is no registration-order fallback and no ambiguous multiple-factory choice.

Examples:

| provider | factory output |
|------|------|
| `{ providerId: "builtin-tools", providerKind: "BUNDLED" }` | discovery for builtin tools |
| `{ providerId: "mcp-a", providerKind: "MCP_SERVER" }` | discovery for that MCP server instance when MCP implementation is added |
| `{ providerId: "custom-a", providerKind: "CUSTOM", providerType: "vendor-x" }` | discovery for that custom type only when the custom implementation is installed |

约束：

- `EAGER` discovery 可以在 app startup 或 explicit refresh 时 `listAll`
- `SEARCH` discovery 启动时只注册 discovery instance，不注册远端 capability
- `SEARCH` discovery 由 catalog 在 `listAvailable` / `resolve` 构造 request-scope 可执行视图时按 Agent bindings 调用；本 change 不提供独立 search API
- cache、refresh 和 remote fetch 只保留接口位置，由后续 provider-specific changes 实现
- discovery 返回 candidate descriptors/facts，不做全局冲突裁决或最终 availability verdict

#### Builtin Tools Discovery

Builtin tools discovery is fixed and minimal:

```
provider:
  providerId: builtin-tools
  providerKind: BUNDLED
discoveryMode: EAGER
```

Startup behavior:

```
createCapabilitySubsystem([])
  -> create provider { providerId: "builtin-tools", providerKind: "BUNDLED" }
  -> CapabilityDiscoveryFactory.create({ provider, discoveryMode: EAGER })
  -> CapabilityDiscovery(provider=builtin-tools, discoveryMode=EAGER)
  -> CapabilityDiscovery.listAll()
  -> [createReadCapabilityDescriptor({ provider: builtin-tools })]
  -> catalog.register(read)
```

Constraints:

- This change discovers only `read` from `builtin-tools`.
- It MUST NOT discover `write`, `glob`, `bash`, `python`, `skill`, `question`, `todo`, or `task`; broader builtin tool discovery remains in `add-ts-builtin-tool-discovery`.
- The `read` descriptor MUST use `provider.providerId="builtin-tools"` and `provider.providerKind="BUNDLED"`.
- Builtin discovery MUST NOT read external provider config and MUST NOT depend on Agent assembly bindings to decide which descriptors exist.
- Agent assembly bindings are applied later by catalog `listAvailable` / `resolve`; they do not change builtin discovery output.

### D5: Catalog 拥有治理结论

Catalog 负责：

- 注册 EAGER descriptors
- 保存 SEARCH discovery instance，并在 `listAvailable` / `resolve` 构造当前可执行视图时调用其 `search(criteria, signal)`
- 按 `AgentAssembly.capabilityBindings` 做 agent/run 可见性过滤
- 排除 `availabilityStatus !== "AVAILABLE"` 的 capability
- `resolve` 前重新执行 binding + availability gate
- 为后续 conflict resolution 保留插槽，但不在本 change 定义具体优先级
- 使用 discovery/probe facts 作为输入，但由 catalog 产生最终 availability verdict

Discovery/provider 可以提供事实，不能自行决定某个 capability 在当前 Agent/run 可见或可执行。

### D5.1: Agent Assembly 编译不依赖 Capability Descriptor 预发现

`AgentAssembly.capabilityBindings` 表达 Agent 对 capability 的授权意图，不是 capability descriptor 的已验证快照。Agent assembly compiler MUST validate binding shape and safe ids, but MUST NOT require every bound capability descriptor to have been discovered before assembly compilation.

Capability descriptor existence, current availability, conflict resolution, and executable uniqueness are catalog runtime governance responsibilities:

```
AgentDefinition.capabilityBindings
  -> assembly compiler validates shape/providerId/capabilityId/kind
  -> AgentAssembly.capabilityBindings
  -> catalog.listAvailable()/resolve() combines bindings with discovered descriptors
```

This removes the startup ordering dependency:

```
discover descriptors -> resource inventory -> compile assembly
```

and replaces it with:

```
compile assembly intent
create capability subsystem
catalog gates descriptors against AgentAssembly at query/resolve time
```

`agent-app` may keep `resource-inventory` as an assembly resource view for model profiles, prompt templates, and other non-runtime resource validation, but capability descriptor existence MUST NOT be a prerequisite for compiling `AgentAssembly`. Existing capability descriptor checks in the resource inventory / assembly compiler path must be removed or narrowed to non-authoritative diagnostics.

### D6: Execution 按 Capability Kind + Provider Identity 分派

执行不是 provider kind 一一对应。大的分派轴是 `CapabilityKind`，再结合 provider identity 找具体 executor。

```typescript
interface CapabilityExecutorFactory {
  create(input: {
    readonly descriptor: CapabilityDescriptor;
  }): CapabilityExecutor | undefined;
}

interface CapabilityExecutor {
  readonly provider: CapabilityProvider;
  readonly capabilityKinds: readonly CapabilityKind[];
  invoke(
    descriptor: CapabilityDescriptor,
    request: CapabilityInvocationRequest,
    signal: AbortSignal
  ): Promise<CapabilityInvocationResult>;
}
```

`CapabilityExecutorFactory` is also a single factory. It is initialized by the capability subsystem with the trusted builtin providers, accepted provider configs, and any provider-specific implementation support available in the current build. Runtime creation/lookup is driven by the resolved descriptor:

1. The input is the `CapabilityDescriptor` returned by `catalog.resolve`.
2. The factory reads exact `descriptor.provider.providerId` and `descriptor.kind`.
3. `descriptor.provider.providerKind` and optional `providerType` are used to choose the provider implementation branch and for diagnostics.
4. The factory MUST NOT choose an executor only because another executor shares the same `providerKind`.
5. If the factory has no executor for `descriptor.provider.providerId + descriptor.kind`, it returns `undefined`; the invocation port maps that to a safe `CapabilityInvocationResult` failure.
6. If implementation configuration would make more than one executor valid for the same `providerId + kind`, subsystem creation MUST fail or invocation MUST return a safe configuration failure; no registration-order fallback is allowed.

`CapabilityInvocationPort` 根据 resolved descriptor 选择 executor；选择表可以是 invocation port 内部实现细节：

```
descriptor.provider.providerId + descriptor.kind
  -> CapabilityExecutor
```

Executor matching MUST be deterministic:

1. The invocation port receives a descriptor that has already passed `catalog.resolve`.
2. The invocation port asks `CapabilityExecutorFactory.create({ descriptor })`.
3. The returned executor must be for exact `descriptor.provider.providerId` and support exact `descriptor.kind`.
4. If one executor is returned, invoke it.
5. If no executor is returned, return a safe `CapabilityInvocationResult` failure.
6. If executor creation detects multiple valid executors for the same descriptor, return a safe configuration/conflict failure; do not choose by registration order.

示例：

```
(TOOL,  BUNDLED, builtin-tools)  -> executor that supports builtin tool invocation
(SKILL, BUNDLED, builtin-skills) -> later executor that supports builtin skill invocation
(TOOL,  MCP_SERVER, mcp-grafana) -> later executor that supports MCP tool invocation
(AGENT, AGENT_REGISTRY, local)   -> later executor that supports agent capability invocation
```

`read` execution path 必须接入 `BUNDLED + TOOL` executor skeleton，或保留在明确的 adapter seam 后。

### D7: Result Contract 不扩展，Agent Core 负责消费

`CapabilityInvocationResult` 已能承载主路径结果：

- `status`
- `structuredPayload`
- `generatedMessages`
- `contextPatch`
- `resultRef`
- `artifactRefs`
- `safeError`
- `fallbackTriggered`
- `metadata`

Executor 只返回 result，不直接写 runtime timeline、session messages、checkpoint、audit sink 或 terminal commit。

`agent-core` 对每个 capability result 使用以下唯一消费规则：

1. 校验 result shape、safe error shape、metadata shape、`structuredPayload` 大小、`generatedMessages` 数量/大小和 refs 数量；不合规则按 safe capability failure 处理。
2. `status=SUCCEEDED` 时，`structuredPayload` 加安全 refs 成为当前 tool call 的 model-visible capability result。
3. `status=DEGRADED` 时，core 先写入降级 notice，再把 `structuredPayload` 加安全 refs 作为当前 tool call 的 model-visible capability result；`safeError` 只能作为 safe reason，不得暴露 raw details。
4. `status=FAILED` 或 `status=TIMED_OUT` 时，core 写入 safe failure / timeout notice 并终止当前 Agent loop；失败结果不得被当作成功 tool result 继续输入模型。
5. `generatedMessages` 必须全部是 `role=USER`。core 将合法 generated messages 放入当前 request/run 的 request-local generated message buffer，并在后续模型调用时追加到 rendered model messages 之后；它们不通过 executor 写 session，也不通过 `RunMessagePort.appendMessage` 写入用户消息。`meta=true` 和 `meta=false` 在本 change 都只影响当前 request/run 后续模型输入，不产生用户可见 session message。
6. `contextPatch.allowedTools` 必须是当前 request scope 内已授权且可见 capability id 的子集。合法 patch 只更新 request-local allowed tool filter，并在后续模型调用时收窄 rendered tools；它不得修改 Agent assembly、catalog state、provider config 或 session config。
7. `contextPatch.modelName` 和 `contextPatch.modelOptions` 必须经过 model selection/governance validation 后才能应用于当前 request/run 后续模型步骤。合法 patch 只更新 request-local model selection/options override，不得修改 Agent assembly、catalog state、provider config、session config 或 global model profile。非法、越权或无法通过治理校验的 patch 必须返回 safe capability failure。
   - Validation path: this change reuses the existing `agent-context-engine` model selection boundary. `agent-core` records the capability-produced model patch as request-local state, then passes that patch into the next context assembly/render step; `agent-context-engine` validates and resolves the effective model through the app-composed `ModelSelectionResolver`, using the accepted `AgentAssembly`, visible model profiles, provider policy, and model option constraints. If validation succeeds, the rendered model input for the next model call contains the effective model info/options; if validation fails, core treats result consumption as a safe capability failure.
   - No new public `ModelGovernancePort` is introduced by this change. A later `add-ts-model-selection-governance` change may refine the model selection policy or replace the internal resolver shape, but provider config governance and capability result consumption in this change must use the existing context-engine resolver path.
8. `resultRef` 和 `artifactRefs` 只作为安全引用进入 capability result metadata 或后续 model-visible safe summary；core 不读取引用内容，不展开 artifact 内容，不把 refs 当成本地路径或 raw provider response。
9. `fallbackTriggered` 和 safe `metadata` 可进入 capability result metadata，但 metadata 不得包含 raw path、secret、raw provider response、用户输入、模型输入/输出或认证凭据。

具体 audit sink、large content materialization、artifact download、Skill INLINE/FORK 和 model selection governance 由后续 changes 承接。

### D7.1: Agent Run State Side Effects 由 Runtime Port 承载

Agent Core 需要写 timeline event、assistant/tool-result session message 和 capability checkpoint，但这些 side effects 的 owner scope、timeline sequencing、message persistence 和 checkpoint idempotency 都属于 runtime lifecycle 边界。为避免 `agent-app` 在 composition 中拼出 submit-command-shaped checkpoint command，本 change 将这些 side effects 收敛到 runtime-owned `AgentRunStatePort`。

Contract shape:

```typescript
interface AgentRunStatePort {
  emitEvent(run: RequestRun, context: RequestContext, event: RunTimelineEvent): Promise<void>;
  appendMessage(run: RequestRun, context: RequestContext, draft: SessionMessageDraft): Promise<MessageId>;
  saveCheckpoint(run: RequestRun, context: RequestContext, triggerReason: CheckpointTriggerReason): Promise<void>;
}
```

`Agent.execute` 收窄为：

```typescript
execute(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<void>;
```

Runtime 创建一个 runtime-owned `AgentRunStatePort` 作为 run state write service，并通过 Agent 构造注入；`Agent` 不需要 per-run 实例来获得 run state，因为 `AgentRunStatePort` 的每个方法都显式接收 accepted `RequestRun` 和 trusted `RequestContext`。

Terminal commit 需要的 final content / output limit 状态不进入 Agent Core contract，也不由 Agent 保存。runtime 在 submit 执行窗口内用 `beginRun(run)` / `finishRun(run)` 管理一个按 `runId` 隔离的 per-run output accumulator；Agent Core 仍只调用 `runState.emitEvent(...)`。Checkpoint 写入不依赖 command idempotency，而是用 `run.runId + triggerReason + run.version` 作为该 checkpoint fact 的幂等锚点。Core 不再接收 execute-time timeline/message ports，也不再通过 `saveCheckpoint` callback 让 app composition 代写 checkpoint。

This keeps the capability result consumption rule intact: executor still returns only `CapabilityInvocationResult`; Agent Core consumes it; runtime-owned run state port performs the actual side effects behind the runtime lifecycle boundary.

#### 6.6.1 Agent Constructor Registration And Runtime Instance Management

`AgentRunStatePort` remains runtime-owned, but Agent instantiation is no longer expressed as an app-owned `createAgent(runState)` callback. The design constraints are:

- runtime owns Agent instance lifecycle decisions: create, reuse, execute, and later unload/evict when such policy exists
- app composition declares available Agent implementations and injects shared Agent runtime dependencies
- Agent implementation packages own behavior, not runtime lifecycle policy
- runtime does not import `agent-core` or `agent-app`
- app composition does not own Agent cache or assembly-scoped reuse policy

Runtime receives two app-composed inputs:

- `AgentConstructor[]`: available Agent implementations, each declaring a static/class-level `getType()` value
- Agent runtime dependencies: context engine, model invocation service, capability catalog/invocation port, assembly registry, lifecycle hook, and optional execution limits

`agent-contracts/runtime` defines the stable execution and constructor contracts:

```typescript
interface Agent {
  execute(run: RequestRun, context: RequestContext, signal: AbortSignal): Promise<void>;
}

interface AgentConstructor<TKit extends object = object> {
  new (kit: TKit): Agent;
  getType(): AgentType;
}
```

`AgentType` is a durable scalar vocabulary owned by `agent-common`; `AgentAssembly` carries `agentType`, and runtime selects the constructor by `assembly.agentType`. The constructor's `getType()` value is class-level metadata so runtime can resolve the implementation before constructing an Agent instance.

Runtime creates one runtime-owned run state port, builds an Agent runtime kit by adding that port to the injected Agent runtime dependencies, and scopes Agent reuse by the accepted assembly identity:

```text
agentId + agentVersion + agentAssemblyRef
```

The design does not require external Agent implementations to inherit from any base class. Agent implementation packages MAY provide convenience base classes for shared validation or scaffolding, but compatibility is defined by the `Agent` interface plus the `AgentConstructor` shape.

#### 6.6.2 Capability Audit From Canonical Events

Capability audit is derived from canonical runtime events, not written directly by capability executors or Agent Core.

Design constraints:

- capability executors return `CapabilityInvocationResult` and do not write audit
- Agent Core consumes the result and emits safe capability lifecycle events
- runtime canonicalizes those events with owner scope, agent scope, request/run/session coordinates, createdAt, and sequence
- observability/audit code may listen to canonical capability lifecycle events and derive audit events
- audit derivation must use only safe event payload fields such as `capabilityId`, `toolCallId`, `status`, `safeErrorCode`, and `safeErrorCategory`
- audit observer failure must not alter request lifecycle, terminal commit, timeline persistence, or stream delivery
- before/after capability hooks may produce hook-specific audit or diagnostics, but capability invocation audit must not depend on hook execution or hook success/failure

`CAPABILITY_COMPLETED` is the minimum terminal event for this derivation. It must be emitted for successful/degraded capability results and for failed/timed-out capability results before the Agent loop fails safely. Audit mapping is:

```text
SUCCEEDED / DEGRADED -> capability.completed
FAILED / TIMED_OUT + AUTHORIZATION -> security.rejected
FAILED / TIMED_OUT -> capability.failed
```

This keeps hook/policy and audit roles separate: hooks may influence or observe lifecycle decisions, while observability derives audit from canonical runtime facts.

## 选定方案（Chosen Design）

### 1. App Composition

```
createComposedApp()
  -> compile AgentAssembly without requiring capability descriptors to be pre-discovered
  -> call agent-capability createCapabilitySubsystem(capabilityProviderConfigs)
  -> receive CapabilityCatalog and CapabilityInvocationPort
  -> inject ports into agent-context-engine and agent-core
  -> pass trusted RequestContext.identityContext into context assembly requests
  -> pass AgentConstructor[] and Agent runtime dependencies into runtime
```

`agent-app` 是唯一 cross-package composition root，但不直接注册 builtin provider、discovery、executor 或 catalog descriptors。capability 子系统内部负责 provider/discovery/executor/catalog 装配。

Capability 子系统装配只替换 capability catalog/invocation ports 的创建方式。除此之外，本 change 明确包含 `ContextAssemblyRequest.identityContext` owner-scope 传递、runtime-owned `AgentRunStatePort` 构造注入、以及 `AgentConstructor[]` 注册/Agent runtime dependency injection。它不得重构、重排或重新绑定 `agent-app` 中其他无关的 runtime、context、model、gateway、observability、attachment、memory 或非 capability 子系统装配。

后续配置 change 只能把外部配置文件、环境变量、租户/Agent 覆盖等来源映射为 `CapabilityProviderConfig[]`，再传给 `createCapabilitySubsystem(capabilityProviderConfigs)`。它不得控制或替换 builtin provider。

### 2. Capability Subsystem Composition

```
createCapabilitySubsystem(capabilityProviderConfigs)
  -> create trusted builtin providers internally
  -> validate/normalize capabilityProviderConfigs
  -> create one CapabilityDiscoveryFactory
  -> create one CapabilityExecutorFactory
  -> create Discovery through CapabilityDiscoveryFactory for each builtin/configured provider
  -> create/extend agent-capability catalog with discoveries
  -> bootstrap catalog discovery
  -> create CapabilityInvocationPort with CapabilityExecutorFactory
  -> return CapabilityCatalog and CapabilityInvocationPort
```

Subsystem public signature:

```typescript
function createCapabilitySubsystem(
  capabilityProviderConfigs: readonly CapabilityProviderConfig[]
): {
  readonly catalog: CapabilityCatalog;
  readonly invocationPort: CapabilityInvocationPort;
}
```

Current change supplies default factories internally. Future provider-specific changes extend the single factories inside the capability subsystem without changing catalog, discovery, executor, or result contracts.

内置 provider：

```typescript
{
  providerId: "builtin-tools",
  providerKind: "BUNDLED"
}
```

本 change 用 `read` descriptor 验证该路径。

### 3. Discovery Flow

```
CapabilityProvider + discoveryMode/config
  -> CapabilityDiscoveryFactory.create()
  -> CapabilityDiscovery instance
  -> if EAGER: listAll() -> catalog.register(descriptor)
  -> if SEARCH: catalog.registerDiscovery(discovery)
```

本 change 不实现独立 remote search API、缓存、刷新或下载；`SEARCH` discovery 只在 `listAvailable` / `resolve` 构造当前 request scope 的可执行视图时被 catalog 调用。

### 4. Catalog Flow

```
listAvailable(request)
  -> registered descriptors
  -> SEARCH discoveries search(criteria derived from AgentAssembly.capabilityBindings)
  -> merge eager and search candidate descriptors
  -> AgentAssembly.capabilityBindings filter
  -> availabilityStatus == AVAILABLE filter
  -> future conflict resolver hook
  -> conflict-resolved visible/executable view unique by capabilityId
  -> descriptors visible to context/core

resolve(request)
  -> build the same visible/executable view as listAvailable, including SEARCH discoveries
  -> lookup by capabilityId in current conflict-resolved visible/executable view
  -> same binding + availability gate
  -> return descriptor or undefined/safe rejection path
```

`resolve` 必须和 `listAvailable` 使用一致 gate；不能出现不可见 capability 能被执行的差异。`providerId` 用于 descriptor identity、binding filter、conflict resolution 和 diagnostics；对 `agent-core` 暴露的当前可执行视图必须保证同一 request scope 下 `capabilityId` 唯一。若冲突无法产生唯一 executable descriptor，catalog 必须让该 capability 不可见且不可 resolve。

### 5. Execution Flow

```
agent-core tool call
  -> catalog.resolve()
  -> build CapabilityInvocationRequest
  -> CapabilityInvocationPort.invoke()
  -> invocation port calls CapabilityExecutorFactory.create({ descriptor })
  -> executor.invoke()
  -> CapabilityInvocationResult
  -> agent-core consumes result into request-local result effects
  -> next model request applies generatedMessages and allowedTools filter
```

`CapabilityInvocationPort` 仍是 runtime/core 唯一执行边界。

## 接口位置

| 接口/对象 | 模块 | 说明 |
|------|------|------|
| `CapabilityProvider` | `agent-contracts/capability` | 冻结 provider identity DTO |
| `CapabilityDescriptor` | `agent-contracts/capability` | 冻结 descriptor DTO |
| `CapabilityCatalog` | `agent-contracts/capability` | runtime/core/context 消费 catalog 的公共接口 |
| `CapabilityInvocationPort` | `agent-contracts/capability` | runtime/core 调用 capability 的公共 port |
| `AgentRunStatePort` | `agent-contracts/runtime` | runtime-owned run state side effects injected into Agent construction |
| `CapabilityProviderConfig` | `agent-contracts/capability` | provider 实例配置核心契约；不允许 `BUNDLED`，外部配置加载后续承接 |
| `CapabilityDiscovery` / factory | `agent-capability` implementation | provider instance discovery skeleton |
| `CapabilityExecutor` / factory | `agent-capability` implementation | capability execution routing skeleton |
| catalog implementation | `agent-capability` implementation | 基于现有 `StaticCapabilityCatalog` 演进 |

## 影响模块

| 模块 | 影响 |
|------|------|
| `agent-capability` | 增加 provider discovery/executor skeleton，收紧 catalog gates |
| `agent-app` | 调用 `createCapabilitySubsystem()` 并注入返回 ports |
| `agent-core` | 明确 result consumption，并避免 executor side effects |
| `agent-contracts` | 新增 provider config DTO/schema；不新增实现类，不重命名冻结字段 |
