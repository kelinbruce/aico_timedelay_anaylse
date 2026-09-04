## 背景和现状（Context）

当前稳定基线已经完成三件前置工作：

- `AgentAssembly` / `AgentAssemblyRegistry` 定义了运行期 Agent 装配结果，`agent.yaml` 是 Agent package 的权威业务装配输入。
- Capability 基线已经把 Tool、Skill、Agent 统一建模为 capability kind，`CapabilityKind` 已包含 `AGENT`，`CapabilityDescriptor`、`CapabilityDiscovery` 和 `CapabilityCatalog` 已存在。
- builtin/local Skill source 已经证明了 source adapter 输出 descriptor candidates、Catalog 负责 request-scope governance 的模式。

当前缺口是：产品需要所有 Agent 都进入统一 Catalog，包括可直接服务的顶层 Agent、只能被其他 Agent 调用的内置 Agent、以及父 Agent package 下的本地 subagent。`agent-package-assembly` 已经承认 `subagents/` 是 package-scoped candidate input，但没有定义它的首版 layout、可信 app-owned source handling、如何映射为 `AGENT` descriptor、如何进入 Catalog、以及 discovery 阶段不得执行子 Agent 的边界。同时，可信框架内置 Agent capability 也需要进入统一 Catalog，避免后续 execution change 为内置 Agent 与本地 subagent 分别建立两套 discovery 入口。

当前代码中的相关事实：

- `packages/agent-contracts/src/capability/index.ts` 已包含 `CapabilityDescriptor.kind`、`CapabilityCatalog` 和 `CapabilityInvocationPort`。
- `packages/agent-capability/src/discovery/discovery.ts` 已包含 `CapabilityDiscovery` 和 `CapabilitySearchCriteria`。
- `packages/agent-capability/src/catalog/catalog.ts` 已包含 EAGER/SEARCH discovery、binding disable、model visibility 和 conflict governance。
- 当前 branch 上已有一版局部实现痕迹，但仍停留在旧形态：`packages/agent-capability/src/agents/agent-discovery.ts` 使用 `local-agents-parent-owned`、`AgentPackageSourceLocator`、`BuiltinAgentCandidate` 和直接 descriptor candidate 映射；`packages/agent-app/src/assembly/agent-assembly-registry.ts` 只支持单个 active assembly；`packages/agent-contracts/src/agent-assembly/index.ts` 的 `AgentAssembly` 尚未承载 `userInvocable` / `agentInvocation`。本 change 的实施必须把这些旧形态迁移到本文唯一方案，不保留 parallel provider、parallel locator 或 candidate DTO。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义所有 Agent 都进入 Capability Catalog：顶层 Agent、可信内置 Agent 和父 Agent package 本地 subagent 均以 `CapabilityDescriptor(kind="AGENT")` 表达。
- 定义 builtin Agent 可以基于 default Agent 装配语义定制；是否可被用户直接服务、是否可被其他 Agent 调用由 `AgentAssembly.userInvocable` 和 `AgentAssembly.agentInvocation` 装配事实判断，不进入 `CapabilityDescriptor`。
- 定义本地 subagent 是父 Agent package 下的局部 Agent package candidate。
- 固定首版 layout 为 `agents/{parentAgentId}/subagents/{subagentId}/agent.yaml`。
- 复用现有 Agent package / `agent.yaml` 装配语义，不新增 subagent-only manifest。
- 在 `agent-capability` 中新增/调整 Agent capability discovery adapters，把可信内置 Agent capability、顶层 Agent capability 和本地 subagent 映射为 `CapabilityDescriptor(kind="AGENT")`。
- 通过现有 Capability Catalog 计算父 Agent request-scope 可调用 Agent capability，并让 context engine 只披露这个 governed callable view。
- 保证 discovery 只产生 descriptor facts 和安全诊断，不产生运行时副作用。
- 为后续 `add-ts-local-invoked-agent-execution` 提供稳定 discovery 前置事实。

**非目标：**

- 不执行子 Agent。
- 不创建 child run、branch、timeline event、checkpoint、message 或 artifact。
- 不定义父子上下文继承、附件传递、预算传递或 capability constraints。
- 不定义子 Agent final message 如何返回父 run。
- 不实现 `task` 工具到 Agent capability executor 的执行路径。
- 不定义 remote AgentRegistry discovery 或 remote Agent execution。
- 不新增 Web API、stream event、audit schema、runtime command、gateway persistence 或 public readiness DTO。

## 设计决策（Decisions）

### 唯一实施路径（Implementation Path）

本 change 只有一条生产实施路径，按以下顺序落地：

1. `agent-core` owns trusted builtin Agent package resources under `builtin-agents/{agentId}/agent.yaml` plus optional `prompts/`; `agent-app` reads those trusted package roots together with `agents/{agentId}/agent.yaml` 顶层 local Agent package，以及父 Agent package 下的 `subagents/{subagentId}/agent.yaml`。
2. `agent-app` 复用同一 Agent package parser/compiler，把所有来源编译成同一种 `AgentAssembly`，并写入 `userInvocable`、`agentInvocation`、`sourceKind`、parent-only subagent 的 `parentAgentScope`、`workspacePolicy.files`、safe display facts 和 capability bindings。
3. `agent-app` 发布同一批 compiled `AgentAssembly` objects；同一个 concrete implementation 同时实现 `AgentAssemblyRegistry` 和 `AgentDiscoverySource`，两者读取这批 assemblies，不再维护 `CompiledAgentAssemblyRecord` 或等价第二套 compiled record。
4. `agent-capability` 注册且只注册 `builtin-agents` 与 `local-agents` 两个 Agent provider。`BuiltinAgentDiscovery` 和两个 factory-created `LocalAgentDiscovery` 实例只通过 `AgentDiscoverySource` 获取 compiled assemblies，并投影成 `CapabilityDescriptor(kind="AGENT")`。
5. Catalog 基于当前父 Agent scope、explicit `AGENT` bindings、`AgentAssembly.parentAgentScope` 表达的 parent-local ownership、availability、disable、conflict 和 model visibility 计算 request-scope callable Agent view。
6. `agent-context-engine` 只把 Catalog 返回的 governed `AVAILABLE && modelInvocable=true && kind=AGENT` descriptors 渲染到 system prompt 的 `### Available agents` / `### How to use agents` render-stage disclosure；`AGENT` descriptor 不进入 `RenderedModelInput.tools`。
7. 后续执行 change 如需从 descriptor 回到可执行 Agent，只能调用 `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)`，不能从 descriptor metadata、provider id、raw path 或 discovery-private loading key 反查。

这条路径同时覆盖 builtin Agent、顶层 local Agent 和 parent-local subagent。实现阶段不得保留旧 locator-backed Agent discovery、candidate DTO、第二套 Agent catalog、第二套 Agent descriptor、第二套 assembly object 或 capability 之外的 invocation envelope。

### D1: Subagent 是父 Agent 局部 Agent package candidate

首版 subagent layout 固定为：

```text
agents/{parentAgentId}/
  agent.yaml
  subagents/
    {subagentId}/
      agent.yaml
```

每个 `subagents/{subagentId}/agent.yaml` 都是该 subagent candidate 的权威输入。目录名 `{subagentId}` 只作为 package 坐标和诊断事实的一部分；公开 capability identity 必须来自经 `agent-app` 统一编译后的 `AgentAssembly.agentId`，并且必须满足安全 id 规则。

父 Agent 的 runtime-facing `AgentAssembly` 不嵌入 subagent raw package、prompt、provider config、secret 或 child assembly 全量对象。`subagents/` 只提供 discovery candidate，不直接成为父 assembly 字段。

放弃方案：

- 新增 `SUBAGENT.md`：会形成 Skill manifest 之外的第二套 manifest，且与 Agent package assembly 重复。
- 把 subagent 写入父 `AgentAssembly.subagents` 字段：会扩大 runtime-facing assembly，并把 discovery/governance 事实挤进装配结果。

### D2: `agent-app` 拥有可信 Agent 装配和 discovery source implementation

`agent-core` owns framework builtin Agent business packages but not assembly. Each builtin Agent package uses the same package shape as a developer Agent package:

```text
packages/agent-core/src/builtin-agents/
  default-agent/
    agent.yaml
  network-explorer/
    agent.yaml
    prompts/
      SYSTEM_PROMPT/
        template.yaml
```

`agent-core` may expose only the trusted `builtin-agents` root directory. It MUST NOT expose a hand-maintained builtin Agent list, import `agent-app`, parse `agent.yaml`, compile `AgentAssembly`, register prompt templates, or publish Capability descriptors. `agent-app` MUST enumerate direct child directories under that trusted root, accept only children containing `agent.yaml`, and compile each package through the same Agent definition parser/compiler used for local Agent packages. Adding a builtin Agent package MUST be a data/package addition under `builtin-agents/{agentId}/`, not a TypeScript list edit.

Builtin Agent package definitions MUST NOT carry legacy `workspaceDir` or `workspaceFiles` fields. Runtime workspace layout and file authority are owned by trusted app composition and the runtime-facing `AgentAssembly.workspacePolicy`: `roots` describe execution workspace roots, while `workspacePolicy.files` describes file-tool read/write directories and size limits. Builtin package configuration MUST NOT reintroduce package-local physical or legacy workspace planning. When an Agent definition omits `workspaceFiles`, app assembly MUST compile product default file authority into `workspacePolicy.files`; an explicit `workspaceFiles.writeDirectories=[]` continues to disable workspace writes for that Agent. App composition MUST NOT initialize a global workspace file tool policy from the current default route Agent; file tools MUST resolve file authority by fetching the current tool execution context's Agent assembly and reading `workspacePolicy.files`.

Builtin Agent package `agent.yaml` is still parsed through the normal Agent definition parser. Because builtin packages are framework defaults that are based on the selected/default Agent product configuration, `agent-app` MAY normalize builtin package model profile references before assembly compile when the package references a framework-default profile that is not present in the current `ResourceInventory`. The normalized value MUST come from the trusted active Agent definition/model profile baseline already accepted by app composition; it MUST NOT come from request input, descriptor metadata, model output, capability arguments, or provider config. This keeps builtin Agents usable when product configuration renames or replaces the default model profile, without adding a second Agent definition parser.

`agent-app` / Agent package assembly 边界负责统一解析、校验和编译所有 Agent 来源，并在同一个 app-owned concrete implementation 中同时提供两个接口：

```ts
interface AgentAssemblyRegistry {
  active(agentId): Promise<AgentAssembly>;
  require(agentId, agentVersion): Promise<AgentAssembly>;
}

interface AgentDiscoverySource {
  listBuiltinAgentAssemblies(signal): Promise<readonly AgentAssembly[]>;
  listTopLevelLocalAgentAssemblies(signal): Promise<readonly AgentAssembly[]>;
  listParentSubagentAssemblies(parentAgentScope, signal): Promise<readonly AgentAssembly[]>;
}
```

`AgentAssemblyRegistry` 继续作为 runtime lookup boundary；`AgentDiscoverySource` 只服务 `agent-capability` discovery 枚举。两个接口分开，避免把 runtime registry 扩展成 catalog enumeration API；但它们在 `agent-app` 中必须来自同一批 compiled `AgentAssembly` facts，不能各自解析或各自维护不一致的数据源。

`AgentDiscoverySource` interface MUST 由 `agent-capability/src/agents/agent-discovery.ts` 定义并从 `agent-capability` public export 暴露为 discovery 所需最小 port；implementation 只能在 `agent-app`。`agent-capability` 不得从 raw path、`workspaceDir` 或 `agent.yaml` 自行发现 Agent，也不得调用 Agent parser/compiler。

当前单 assembly registry 形态必须收敛为一个 app-owned compiled assembly implementation：输入为 trusted app composition 产出的全部 compiled `AgentAssembly` objects；输出的同一个 concrete object 同时满足 `AgentAssemblyRegistry` 与 `AgentDiscoverySource`。系统配置 `activeAgentId` 在当前单智能体实现中只是默认路由 Agent id；app composition MAY 在启动期用与 `AgentAssemblyRegistry.active(agentId)` 相同的规则做 fail-fast 路由校验，但 MUST NOT 把该 id 或对应 assembly 保存为 registry active 状态，也 MUST NOT 用它初始化 Agent-owned policy 的全局默认值。运行期 request admission MUST 通过 `Session.agentId -> AgentAssemblyRegistry.active(agentId)` 解析 `userInvocable=true` 且非 parent-local 的 routed/top-level assembly；accepted 之后 MUST 用 `require(agentId, agentVersion)` 按固化 identity 回查任意已编译 assembly，包括 builtin、顶层 local Agent 和 parent subagent。三个 `AgentDiscoverySource` list 方法只从同一份 compiled assembly set 中按 `sourceKind`、`agentInvocation` 和 `parentAgentScope` 过滤。

### D2.5: 所有 Agent 统一装配为 `AgentAssembly`

无论 Agent 来源是 framework builtin、`agents/{agentId}/agent.yaml` 顶层 local Agent，还是父 Agent package 下的 `subagents/{subagentId}/agent.yaml`，最终 runtime-facing 装配对象都必须是现有 `AgentAssembly`。系统不得为 builtin Agent 或 subagent 新增平行的 `BuiltinAgentAssembly`、`SubagentAssembly`、`InvokedAgentAssembly` 或 execution-only assembly DTO。

为保持 KISS，当前 app composition 内所有可发现 Agent 的 `agentId + agentVersion` MUST 全局唯一，包括 builtin Agent、顶层 local Agent 和 parent subagent。`subagents/` 是 packaging/ownership layout，不引入 parent-local Agent identity。后续从 `CapabilityDescriptor(kind="AGENT")` 回到可执行 Agent 时，只需要使用 descriptor 的 `capabilityId` 和 `version` 调用 `AgentAssemblyRegistry.require(agentId, agentVersion)`。

### D2.6: `AgentAssembly` 承载用户入口和 Agent 调用策略

`AgentAssembly` 必须承载最小调用策略事实：

```ts
interface AgentAssembly {
  readonly userInvocable: boolean;
  readonly agentInvocation: "NONE" | "BOUND" | "PARENT";
  readonly sourceKind?: "BUILTIN" | "LOCAL";
  readonly parentAgentScope?: {
    readonly agentId: AgentId;
    readonly agentVersion: AgentVersion;
    readonly agentAssemblyRef: string;
  };
  readonly workspacePolicy: AgentWorkspacePolicy;
}
```

`userInvocable` 表示该 Agent 是否可被 trusted direct/default-route selection 作为直接服务用户的 Agent。`agentInvocation` 表示该 Agent 是否、以及如何被其他 Agent 调用：

- `NONE`：不可被其他 Agent 调用。
- `BOUND`：可被其他 Agent 通过 explicit `capabilityBindings` 调用。
- `PARENT`：只能作为 owning parent 的本地 subagent 被调用。

`PARENT` 的 parent 归属写入被调用方 `AgentAssembly.parentAgentScope`，这是 subagent 自身的装配事实，不进入 `CapabilityDescriptor`。`listBuiltinAgentAssemblies()` 和 `listTopLevelLocalAgentAssemblies()` MUST NOT return `agentInvocation="PARENT"` assemblies。`listParentSubagentAssemblies(parentScope)` MUST only return assemblies whose `agentInvocation` is `PARENT` and whose `parentAgentScope` exactly matches the trusted parent scope. Assemblies with `agentInvocation="NONE"` MUST enter the global Catalog candidate set as unavailable/non-callable descriptors, and MUST NOT enter any parent Agent callable view.

Agent definition 中 `userInvocable` 和 `agentInvocation` 都是可省略配置项；`agent-app` assembly compiler 必须默认 `userInvocable=true`、`agentInvocation="BOUND"`。因此普通顶层 Agent 不需要显式写默认值，只有 invoked-only builtin Agent、parent-local subagent 或完全不可委托 Agent 需要 override。runtime-facing `AgentAssembly` 仍必须始终携带编译后的两个事实。

典型组合：

| Agent 类别 | userInvocable | agentInvocation |
|---|---:|---|
| 顶层可服务且可被绑定调用的 Agent | `true` | `BOUND` |
| 仅可被绑定调用的 builtin Agent | `false` | `BOUND` |
| parent-local subagent | `false` | `PARENT` |
| 完全内部 Agent | `false` | `NONE` |

Direct/default-route selection MUST require `userInvocable=true`。父 Agent explicit binding MUST only make targets callable when discovery published them from a non-parent-local source and their assembly has `agentInvocation="BOUND"`。当前父 Agent 的本地 subagent 默认可见 MUST come from `listParentSubagentAssemblies(currentParent)` and require `agentInvocation="PARENT"`。`enabled=false` binding hides a parent-local subagent in its owning parent view.

owner 分工固定为：

- `agent-contracts/agent-assembly` 拥有 `AgentAssembly` 和 `AgentAssemblyRegistry` 的 public contract shape。
- `agent-core` 拥有 builtin Agent package 资源和 trusted package root facts；这些 package roots 是业务资源，不是装配实现。
- `agent-app` 拥有同一个 concrete implementation，承载 `AgentAssemblyRegistry` 和 `AgentDiscoverySource` 两个接口，负责读取 `agent-core` builtin Agent package roots、local Agent package locating、`agent.yaml` parsing、assembly compile、安全校验和 registry publication。
- `agent-capability` 拥有 Agent capability provider identity、`CapabilityDiscovery` adapter、`CapabilityDescriptor(kind="AGENT")` discovery projection、Catalog integration 和安全 diagnostics；它必须定义 discovery 所需的最小 `AgentDiscoverySource` port，但不得实现 app-owned package locating、不得编译 `AgentAssembly`，也不得持有 raw package 内容作为 runtime assembly 替代物。
- `agent-runtime`、`agent-core`、`agent-context-engine` 和后续 Agent capability executor 只能消费已编译 `AgentAssembly` / `AgentAssemblyRegistry` lookup 结果，不得按 provider 类型重新解析 builtin config、`agents/` 或 `subagents/`。

Builtin Agent 也必须先由 `agent-core` 中的 trusted package source 表达为可装配 Agent package，再经同一 `agent-app` parser/compiler 生成 `AgentAssembly`。Builtin 与 local 的差异只在 package source owner 和 discovery provider identity，不在 runtime-facing assembly object。

### D3: `agent-capability` 新增 trusted builtin Agent discovery

`agent-capability` 必须注册 reserved trusted builtin Agent provider identity：

```text
providerId = "builtin-agents"
providerKind = "BUNDLED"
```

`builtin-agents` 承载框架内置 Agent capability candidates，只能由可信 app/capability composition 注册；外部 `CapabilityProviderConfig` 不得声明、覆盖或禁用该 provider id。首版内置 Agent candidates MUST 来自 `AgentDiscoverySource.listBuiltinAgentAssemblies(signal)` 返回的 compiled `AgentAssembly`，不再使用 `BuiltinAgentCandidate` / candidate metadata DTO，不扫描文件系统、不读取 remote registry、不读取模型输出，也不创建 execution route。

Builtin Agent 可以基于 default Agent 装配语义定制成多个稳定 Agent。部分 builtin Agent 可以 `userInvocable=true`，被 trusted app composition 选择为 direct/default-route Agent；部分 builtin Agent 可以 `userInvocable=false` 且 `agentInvocation="BOUND"`，不直接对用户服务，只允许被其他 Agent 通过 binding 调用。这个服务性判断属于 direct/default-route selection / runtime dispatch 逻辑，必要事实从 `AgentAssembly` 获取，`CapabilityDescriptor` 不体现 `userInvocable`、`agentInvocation` 或等价路由策略。

首版 canonical builtin invoked-only Agent 为 `network-explorer`。它用于电信网络信息收集：按明确问题收集拓扑、告警、KPI、日志、配置、工单、资源清单等只读证据，并整理为 evidence summary；它不得执行修复、配置变更、写入、审批、远端命令或 sandbox 动态执行。其 assembly MUST be `userInvocable=false` and `agentInvocation="BOUND"`。builtin tools 由 `builtin-tools` provider 默认生效；因此 `network-explorer` 不应通过显式 enabled binding 重复声明默认 read/search tool，而是必须在 `capabilityBindings` 中显式 `enabled=false` 禁用副作用 builtin tools such as `write`, `bash`, `python` and `skill`，并依赖 Catalog governance 保留默认可用的只读检索/读取能力。后续电信网络专用 query/inventory/log/KPI/alarm lookup provider 如明确声明 read-only，也可通过同一治理路径进入其可用能力集。It MUST NOT bind write tools, shell/python/script execution, sandbox execution, deployment, configuration mutation, ticket update, approval, or remediation capabilities as enabled capabilities. 这个边界必须由 assembly bindings 和 Catalog governance 强制，不能只写在 prompt 中。

`network-explorer` MUST have its own Agent-scoped `SYSTEM_PROMPT` template compiled through the current prompt-template baseline. The template is owned by trusted builtin Agent packaging in `agent-core` and published by `agent-app` as context-engine prompt template registry facts for `agentId="network-explorer"` and its `agentVersion`, from the trusted builtin Agent prompt root containing `prompts/SYSTEM_PROMPT/template.yaml`. App composition MUST register builtin Agent prompt templates by iterating the trusted builtin Agent package/source records and checking for a package-local `prompts/` directory; it MUST NOT hard-code one `promptTemplateRegistry.register()` call per builtin Agent in `createComposedApp`. It MUST NOT be referenced through `AgentAssembly.promptTemplateIds`, `AgentRuntimeSettings.defaultPromptTemplateId`, descriptor metadata, or any runtime-facing prompt allowlist field. It is rendered only when `network-explorer` itself runs in a later execution change, and MUST NOT be copied into parent Agent prompt disclosure. The initial template is a reference prompt, not a full business diagnosis prompt: it must define the Agent as a read-only evidence collector, require narrow and specific information-gathering questions, instruct it to use only governed read/search/query tools, prohibit remediation or writes, and require output as an evidence summary with source categories, confidence/limitations and missing-data gaps. Exact child-run invocation and result-return semantics remain deferred to the execution change.

The `network-explorer` prompt template MUST follow this subject structure:

1. **Role**: act as a read-only telecom network evidence collector for a specific parent Agent question; do not act as the final diagnostic or remediation authority.
2. **Input contract**: accept only narrow, well-scoped collection questions; if the requested scope is broad or ambiguous, report the missing scope instead of expanding it silently.
3. **Allowed actions**: use only governed read/search/query capabilities made visible to this Agent, such as topology lookup, alarm lookup, KPI query, log search, configuration read, ticket read and inventory read.
4. **Prohibited actions**: do not write, mutate configuration, remediate, approve, deploy, execute shell/python/scripts, call sandbox execution, trigger remote commands, or fabricate unavailable evidence.
5. **Output contract**: return an evidence summary with sections for `question`, `evidence found`, `source categories`, `confidence and limitations`, and `missing data / follow-up queries`.
6. **Safety and scope**: do not expose credentials, raw secrets, hidden provider ids, raw prompt body, source paths or internal assembly details; keep conclusions tied to cited evidence categories.

The template content MAY be concise, but implementation tests must prove these subject requirements are present in the compiled prompt template. This requirement is intentionally about the prompt's subject contract, not exact English wording.

所有 builtin Agent 都进入 Catalog；是否对当前父 Agent 可调用，由 `AgentAssembly.agentInvocation`、父 Agent binding、availability、conflict/shadowing 和 model visibility 决定。未被当前父 Agent 显式绑定的 builtin Agent 不进入该父 Agent 的 callable view。顶层 / 默认路由选择规则仍由 app composition / runtime dispatch 拥有，并且 MUST require `AgentAssembly.userInvocable=true`；Catalog 不替代 direct/default-route selection。

首版默认 builtin Agent 必须在自身 trusted config / fallback assembly 中声明一个 enabled `AGENT` binding：`providerId="builtin-agents"`、`capabilityId="network-explorer"`。这不是特殊 case；它使用与普通父 Agent 绑定 builtin Agent 相同的 `capabilityBindings` 语义，用来覆盖 builtin-agent-to-builtin-subagent 的黑盒路径。配置加载、fallback assembly、Catalog governed view 和 prompt disclosure 必须共同验证：默认 builtin Agent 运行时可以通过统一 Catalog 看到 `network-explorer`，而不是依赖 prompt 硬编码或 builtin-only shortcut。

Builtin Agent descriptor mapping 使用与 subagent 相同的 `CapabilityDescriptor(kind="AGENT")` contract。descriptor 只包含 safe display metadata、stable capability id、version、provider identity、availability 和 model visibility 输入；不得包含 prompt 正文、raw Agent definition、provider secret、executor wiring、child assembly 或内部 routing detail。

### D4: `agent-capability` 使用 `local-agents` 承载顶层 local Agent 和父 subagents

`agent-capability` 必须使用一个 reserved trusted local Agent provider identity：

```text
providerId = "local-agents"
providerKind = "LOCAL_DIRECTORY"
```

`local-agents` 承载 `agents/` 目录内的 Agent capability candidates，只能由 app composition / capability subsystem 注册。外部 `CapabilityProviderConfig` 不得声明、覆盖或禁用该 provider id。

本地 Agent discovery 使用唯一实现形态：`agent-capability/src/agents/agent-discovery.ts` 中的一个 `LocalAgentDiscovery` class，由 `DefaultCapabilityDiscoveryFactory` 按同一个 provider identity `local-agents` 创建两个实例。Discovery 不扫描 `agents/` / `subagents/`，而是通过 `agent-app` 注入的 `AgentDiscoverySource` 获取已编译的 `AgentAssembly`：

1. `sourceScope="top-level-local"`，`discoveryMode="EAGER"`：调用 `AgentDiscoverySource.listTopLevelLocalAgentAssemblies()`，把 `agents/{agentId}/agent.yaml` 已编译出的顶层 local Agent assemblies 投影为全局 Catalog candidates。该 source MUST NOT return `agentInvocation="PARENT"` assemblies。顶层 local Agent 不因进入 Catalog 而默认成为其他父 Agent 的 callable Agent；它必须被当前父 Agent 通过 `capabilityBindings` 显式绑定，并且 target `agentInvocation` 必须为 `BOUND`，才进入 callable view。
2. `sourceScope="parent-subagent"`，`discoveryMode="SEARCH"`：在 Catalog 构造父 Agent request-scope view 时，按 trusted parent Agent scope 调用 `AgentDiscoverySource.listParentSubagentAssemblies(parentScope)`，该方法从同一批 compiled assemblies 中筛选 `agentInvocation="PARENT"` 且 `parentAgentScope` 匹配当前父 Agent 的 assemblies，并投影为 candidates。这些 local subagent 像 agent-owned local Skills 一样，在所属父 Agent request scope 中默认可见；显式 disabled binding 可以隐藏。

`DefaultCapabilityDiscoveryFactory` MUST contain exactly these local Agent branches: `(providerId="local-agents", providerKind="LOCAL_DIRECTORY", discoveryMode="EAGER") -> LocalAgentDiscovery(sourceScope="top-level-local")` and `(providerId="local-agents", providerKind="LOCAL_DIRECTORY", discoveryMode="SEARCH") -> LocalAgentDiscovery(sourceScope="parent-subagent")`。旧的 `local-agents-parent-owned` provider id、`LocalAgentCapabilityDiscovery` 名称、`AgentPackageSourceLocator.listSubagentPackages` / `locateSubagentPackage` 和 `LocalAgentPackageCandidate` DTO MUST be removed or folded into the app-owned assembly implementation；implementation MUST NOT keep them as an alternate Agent discovery path.

这个设计和 Skill 当前治理策略保持一致：全局/顶层来源先进入 candidate set，是否对当前 Agent 可用由 binding 决定；agent-owned local source 在当前 Agent scope 内由 SEARCH discovery 找到并默认进入该 Agent 的 request-scope candidate set。Catalog 判断“这个 subagent 是否属于当前父 Agent”时不需要在 descriptor 增加 ownership 字段，而是通过 `AgentAssembly.parentAgentScope` 与 `parent-subagent` SEARCH provider 的 trusted scope 匹配决定。

`LocalAgentDiscovery` MUST NOT import `agent-app` or depend on app-owned implementation types. `agent-capability` owns the minimal `AgentDiscoverySource` interface it needs for discovery; `agent-app` provides the trusted implementation during app composition and injects it into the capability subsystem. `agent-core`, `agent-runtime` and `agent-context-engine` MUST only consume the governed Catalog view and MUST NOT access the discovery source directly.

Production composition MUST pass the trusted `AgentDiscoverySource` implementation to local Agent discovery. Registering `local-agents` without this source is not sufficient: the provider would exist in Catalog wiring but could only return source-unavailable evidence. A composition-level test must prove that a real top-level `agents/{agentId}/agent.yaml` compiled by `agent-app` can enter the catalog candidate set, and a real parent package `subagents/{subagentId}/agent.yaml` compiled by `agent-app` becomes visible through the app-owned Catalog path for its owning parent Agent.

This change modifies `agent-contracts/agent-assembly` to add `AgentAssembly.userInvocable` and `AgentAssembly.agentInvocation`, but MUST NOT add `signal` or any cancellation field to public `CapabilityCatalogRequest` / `CapabilityCatalog` contracts. Public Catalog calls use an internally created non-detached implementation signal. Trusted implementation-side cancellation MUST use the existing `StaticCapabilityCatalog.listAvailableWithSignal` / `resolveWithSignal` paths to pass `AbortSignal` through SEARCH discovery into `AgentDiscoverySource`. Tests MUST NOT smuggle `signal` through `CapabilityCatalogRequest`. Full request-lifecycle cancellation through the public Catalog contract is deferred to a later contract refinement change. Discovery MUST check abort before and after `AgentDiscoverySource` calls; cancellation returns a safe empty/degraded discovery result without publishing partial unsafe facts.

Local Agent readiness evidence MUST be scoped by source scope. Top-level EAGER evidence is keyed by `providerId + sourceScope + capabilityId + version`. Parent subagent SEARCH evidence is keyed by trusted parent Agent scope (`agentId`, `agentVersion`, `agentAssemblyRef`) plus `providerId + sourceScope + capabilityId + version`. Singleton discovery instances MUST NOT expose mutable state that can be cleared or overwritten by a concurrent request or by another parent Agent with the same subagent capability id.

首版只 EAGER 扫顶层 local Agent，不启动期扫描所有 Agent 的所有 subagent；父 Agent `subagents/` 使用 SEARCH，避免不同父 Agent 的同名 subagent 进入全局冲突域。Catalog 在父 Agent request scope 内触发 parent subagent discovery。

### D5: Descriptor mapping 只暴露安全事实

Agent capability discovery 将可信内置 Agent assembly、顶层 local Agent assembly 或 parent subagent assembly 映射为 `CapabilityDescriptor`：

- `kind = "AGENT"`
- `capabilityId` MUST 等于 `AgentAssembly.agentId`
- `version` MUST 等于 `AgentAssembly.agentVersion`
- `displayName` / `description` 来自已编译 `AgentAssembly` 的 safe display metadata
- `provider` 使用对应 reserved provider identity：builtin 使用 `builtin-agents`，本地顶层 Agent 和本地 subagent 均使用 `local-agents`
- `availabilityStatus` 表达 discovery 阶段的安全可用性输入；discovery MUST derive it from source validity and `AgentAssembly.agentInvocation` without copying invocation policy into descriptor metadata
- `modelInvocable` 按首版默认可委托目标披露策略设置
- `metadata` 只允许安全、非决策性摘要，Catalog/core/runtime 不得依赖 metadata 进行授权、路由、执行或恢复判断

Builtin Agent descriptor metadata MUST be omitted by default. If later product composition needs metadata, it must use an explicit allowlist of safe scalar fields and tests must prove raw Agent definition, prompt body, provider secret, path, executor wiring, loading key, child assembly, `userInvocable` and `agentInvocation` are not copied into the public descriptor.

Descriptor 不包含 raw path、raw `agent.yaml`、prompt body、workspace path、secret、loading key、child assembly 全量对象或 package 内部布局。

Discovery 阶段不保存 raw package path、raw `agent.yaml` 或 child assembly 全量对象作为 descriptor metadata。实现 MUST 保存 provider/source/scope 级 readiness evidence 用于诊断，但后续执行定位不依赖 descriptor metadata 或 discovery-private loading key。

从 `CapabilityDescriptor(kind="AGENT")` 回到可执行的 `AgentAssembly` 使用现有 `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)`。因此所有 Agent descriptors MUST carry `version`。Catalog 只返回治理后的 descriptor；执行前的 Agent capability resolver 不从 descriptor metadata、raw source path 或 discovery-private loading key 查找 assembly。

### D6: Catalog 拥有可见性、绑定、禁用、冲突和模型披露

Catalog candidate pipeline 固定为：

1. 收集所有 trusted EAGER Agent descriptors，包括 builtin Agent 和 `local-agents` 顶层 local Agent。这些 descriptors 进入全局 candidate set，但不因 provider trusted 而默认进入任意父 Agent callable view。EAGER Agent discovery MUST NOT publish `agentInvocation="PARENT"` assemblies from these sources.
2. 对 trusted `local-agents` / `sourceScope="parent-subagent"` SEARCH discovery 按当前父 Agent scope 调用 `search`，获得 `parentAgentScope` 匹配当前父 Agent 且 `agentInvocation="PARENT"` 的默认可见 candidates。
3. 按当前父 Agent 的 explicit enabled `AGENT` bindings，从 builtin Agent 和顶层 local Agent candidate set 中选择可调用目标；discovery MUST have published `agentInvocation="BOUND"` targets as `AVAILABLE` descriptors, while `agentInvocation="NONE"` targets remain unavailable/non-callable. 顶层 Agent 可以成为另一个 Agent 的 subagent，只需要 binding；不需要位于调用方的 `subagents/` 目录。
4. 汇总 explicit bound candidates 与当前父 Agent local subagent candidates 后，应用 explicit disabled bindings。
5. 应用 availability filter、conflict/shadowing、model visibility 和 invocation eligibility。

Model visibility is not satisfied by Catalog inclusion alone. `agent-context-engine` prompt shaping MUST render governed `AGENT` descriptors as delegable Agent targets when they are `AVAILABLE` and `modelInvocable=true`, using only `capabilityId` and safe description/display facts. The renderer MUST NOT expose provider-private ids, raw package paths, source identities, loading facts, prompt bodies, metadata secrets or child assembly details.

Prompt entry uses the existing capability disclosure path, not a new prompt contract. Current mainline system prompt assembly is template-based: `PromptTemplateAssembler` compiles `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/template.yaml` and any agent-owned `prompts/SYSTEM_PROMPT/template.yaml` registered in the context-engine prompt template registry into ordered `SystemPrompt.sections`; `DefaultModelInputRenderer` then calls `renderSystemPromptContent()` to render those sections with the cache boundary before appending capability disclosure. `DefaultContextEngine.resolveCapabilities()` already asks Catalog for `includeUnavailable=false` and `modelInvocable=true`; the resulting `visibleCapabilities` MUST be passed unchanged to render. `DefaultModelInputRenderer` MUST partition by `CapabilityDescriptor.kind`: `TOOL` descriptors continue to become model tool schemas, `SKILL` descriptors continue to be rendered in the fixed Skill disclosure, and `AGENT` descriptors are appended to the system message as a fixed render-stage disclosure block after `renderSystemPromptContent()` output and before the locale hint. Existing prompt-template variables such as `enabledSkills` do not become an Agent disclosure channel. This change MUST NOT add `enabledAgents`, `invokedAgents`, new `SystemPromptContext` fields, or a prompt-template variable for Agent lists.

The Agent disclosure block MUST use stable English headings:

```text
### Available agents
- <agent-capability-id>: <safe description>

### How to use agents
...
```

The block is omitted when no governed `AVAILABLE && modelInvocable=true` `AGENT` descriptors exist. In this discovery-only change, `AGENT` descriptors MUST NOT be projected into `RenderedModelInput.tools` and the prompt MUST NOT invent an invocation syntax. The block may describe them as governed delegation targets and must state that actual Agent execution can be unavailable until the execution change enables it.

The built-in base system prompt template must also be conditional. In the current mainline code this is the `agent_delegation` section in `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/agent-delegation.md`, not the removed `prompt-configs/telecom/system` tree or the removed `default-system-prompt.ts` fallback. That section must not unconditionally say "Use the Agent tool" or imply that an Agent execution mechanism exists. It should say that Agent delegation is only available when the rendered `### Available agents` section and a concrete Agent invocation mechanism are present, and that only listed Agent ids may be used. Exact invocation syntax, child run semantics and result handling remain owned by the later execution change. Agent-owned `SYSTEM_PROMPT/template.yaml` overrides may replace the `agent_delegation` text, but they cannot add new system section ids and must still rely on render-stage capability disclosure for the actual current Agent list.

父 Agent 可以通过 `capabilityBindings` 显式绑定 `agentInvocation="BOUND"` 的 builtin Agent 或顶层 local Agent capability，无论目标自身是否也可作为 direct/default-route Agent。builtin 父 Agent 与 local 父 Agent 使用同一绑定规则；默认 builtin Agent 绑定 builtin `network-explorer` 必须走这条通用路径。父 Agent 自己 package 下 `agentInvocation="PARENT"` 的 `subagents/` 自动成为当前父 Agent request scope 的默认候选，不要求写入 synthetic `AgentAssembly.capabilityBindings`。显式禁用使用同一 key：

```text
providerId + capabilityType=AGENT + capabilityId
```

AgentDefinition parser / compiler MUST preserve `capabilityType="AGENT"` enable/disable facts in runtime-facing `AgentAssembly.capabilityBindings`，并继续 fail closed 拒绝 unknown capability type。`AgentAssembly` public contract must be updated only for `userInvocable` and `agentInvocation`; `agent-contracts/capability` public Catalog request/descriptor contracts remain unchanged.

### D7: SEARCH criteria 不携带 binding-owned facts

`CapabilitySearchCriteria` 已经位于 `agent-capability` public surface。Agent capability SEARCH discovery 使用的 criteria 只能包含：

- `tenantId`
- `subjectId`
- `agentId`
- `agentVersion`
- `agentAssemblyRef`
- `requestedCapabilityId?`
- `modelInvocable?`

criteria 不包含 `AgentAssembly` 对象、`capabilityBindings`、`boundCapabilityIds`、availability verdict、conflict result 或 routing decision。Catalog 在 discovery 返回后应用 binding 和 governance。

当前代码已经大体符合该形状；任务仍需要增加 contract tests 防止 regression。

### D8: Discovery 阶段的失败和诊断

本 change 使用 implementation-local safe diagnostics，不新增 public readiness DTO。最小 outcome code 集合：

- `BUILTIN_AGENT_SOURCE_UNAVAILABLE`
- `BUILTIN_AGENT_CANDIDATE_INVALID`
- `BUILTIN_AGENT_REGISTERED`
- `LOCAL_AGENT_SOURCE_UNAVAILABLE`
- `LOCAL_AGENT_PARENT_PACKAGE_UNAVAILABLE`
- `LOCAL_AGENT_SUBAGENTS_ROOT_MISSING`
- `LOCAL_AGENT_CANDIDATE_IGNORED`
- `LOCAL_AGENT_DEFINITION_MISSING`
- `LOCAL_AGENT_DEFINITION_INVALID`
- `LOCAL_AGENT_DUPLICATE_REJECTED`
- `LOCAL_AGENT_SHADOWED`
- `LOCAL_AGENT_GOVERNANCE_UNAVAILABLE`
- `LOCAL_AGENT_REGISTERED`

Diagnostics 只包含 provider id、provider kind、parent agent id/version、capability id、safe outcome code 和 sanitized message。不包含 raw path、prompt、secret 或 package content。

### D9: Execution 明确后置

本 change 不创建 Agent capability executor。若现有 `CapabilityInvocationPort` 收到 `AGENT` capability invocation，而 executor 尚未实现，必须返回安全 unavailable/failed 结果，不创建 child run。

后续 `add-ts-local-invoked-agent-execution` 才定义：

- `task` 工具入口
- child run / branch
- cancellation cascade
- context inheritance
- result return
- parent timeline summary
- audit correlation

### D10: 实施完成必须收敛旧代码路径

本 change 的实现完成条件包含代码整洁度收敛，而不只是新黑盒路径可用。生产代码中 Agent discovery 必须只剩一条统一路径：

```text
agent-app compiled AgentAssembly set
  -> AgentDiscoverySource
  -> BuiltinAgentDiscovery / LocalAgentDiscovery
  -> CapabilityDescriptor(kind="AGENT")
  -> Catalog governance
```

实现不得保留旧 provider、旧 locator-backed Agent discovery、旧 candidate DTO 或兼容性旁路作为第二套生产路径。以下符号在完成后不得出现在生产源码中：`local-agents-parent-owned`、`localAgentsParentOwnedProvider`、`LocalAgentCapabilityDiscovery`、`BuiltinAgentCandidate`、`LocalAgentPackageCandidate`、`subagentPackageLocator`、`AgentPackageSourceLocator.listSubagentPackages`、`AgentPackageSourceLocator.locateSubagentPackage`。允许保留的是 local Skill 已有 package locating 所需的非 Agent-specific `AgentPackageSourceLocator.locate` 能力；Agent subagent 枚举和解析必须移入 `agent-app` owned assembly/source implementation。

实现也不得通过新名字重建等价第二套路径，例如 `SubagentDiscoverySource`、`SubagentDescriptor`、`InvokedAgentAssembly`、builtin-only assembly DTO、subagent-only assembly DTO、或 capability 之外的 Agent catalog。新增 helper、test fixture、diagnostic code 必须被当前产品路径或测试路径实际使用；本 change 产生的 unused export、重复 DTO、临时 fake、dead helper 和只为兼容旧实现存在的 adapter 必须在任务结束前删除。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | builtin Agent candidates 只来自 trusted composition；subagent raw package locating 只在 `agent-app` owned source boundary 内发生；descriptor/diagnostics 不泄露 raw path、prompt、secret、workspace path 或 loading key；非可信输入不能覆盖 parent Agent scope 或 subagent root；execution 不在 discovery 阶段发生。 | builtin provider tests、app-owned source negative tests、descriptor safety tests、diagnostics redaction tests、architecture forbidden checks |
| 性能/容量 | builtin Agent、顶层 local Agent 和 parent subagent 均由 `agent-app` 启动期统一 compile；`agent-capability` 的 builtin/top-level EAGER discovery 只枚举 compiled assemblies；parent subagent SEARCH 只按当前父 Agent scope 从 compiled source 中取所属 subagents；首版不定义 watcher、hot reload 或 request-path raw file scanning。 | discovery mode tests、Catalog SEARCH trigger tests、focused unit tests |
| 可靠性/恢复 | discovery failure 返回空 candidates 或 unavailable descriptors，并记录 safe diagnostics；不写 runtime/session/timeline/checkpoint，因此不引入恢复状态。 | failure/degradation tests、no side-effect tests |
| 可维护性 | 复用 Agent package assembly 和 Capability SPI；builtin Agent 业务 package 由 `agent-core` 统一承载，`agent-app` 只负责装配；使用 `builtin-agents` 与 `local-agents` 两个 provider identity，不新增通用 source framework 或第二套 Agent contract；实施完成后移除旧 provider、旧 candidate DTO、旧 locator-backed Agent discovery 和 unused compatibility adapter。 | dependency-cruiser / architecture tests、source grep negative checks、code review checkpoint |
| 可测试性 | app-owned source handling、descriptor mapping、Catalog visibility、disable、conflict 和 no-side-effect 都能用 deterministic unit/contract tests 覆盖。 | agent-app tests、agent-capability tests、contract tests |
| 审计/可追溯性 | 本 change 不新增 audit schema；通过 implementation-local diagnostics 提供 source/capability/outcome 证据。执行期 audit 由后续 execution change 定义。 | diagnostics tests、code review 确认无 audit/stream/API expansion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| subagent 使用 `subagents/{subagentId}/agent.yaml` 且复用 Agent package 校验 | 2.1, 2.2, 2.3, 11.7 | assembly/source tests |
| `workspaceDir` 不作为 subagent root | 2.4 | app-owned source negative test |
| `builtin-agents` 输出 `CapabilityDescriptor(kind="AGENT")` | 3.1, 3.2 | builtin discovery unit tests |
| `local-agents` EAGER 顶层 discovery 与 SEARCH parent subagent discovery 输出 `CapabilityDescriptor(kind="AGENT")` | 3.3, 3.4, 11.x | discovery unit tests |
| descriptor/diagnostics 不泄露 raw package facts | 3.5, 6.2 | descriptor safety / diagnostics tests |
| Catalog request-scope 可见性、explicit binding、本地 subagent 默认可见、disable、conflict、model visibility | 4.1, 4.2, 4.3, 4.4, 11.x | Catalog listAvailable/resolve tests |
| SEARCH criteria 不携带 binding-owned facts | 4.5 | contract tests / fake discovery tests |
| AGENT binding facts 被 assembly parser/compiler 保留 | 2.5, 4.2 | assembly parser/compiler tests |
| discovery 不执行子 Agent、不写 runtime facts | 5.1, 5.2 | no side-effect tests / architecture checks |
| remote AgentRegistry 后置 | 5.3 | provider unsupported tests |
| 旧 Agent discovery 双轨和冗余代码被移除 | 11.9, 11.11 | source grep negative checks、architecture/code review checkpoint |
| OpenSpec 和质量门禁 | 7.1, 7.2, 7.3 | `openspec validate`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/invoked-agent-discovery/spec.md` 主承载 builtin Agent 和 subagent discovery 行为；`agent-package-assembly/spec.md` 主承载 package input / app-owned source handling 行为；`capability-catalog/spec.md` 主承载 Catalog 可见性和 conflict 行为。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 Agent capability discovery 和 execution-deferred SPI 边界；`openspec/designs/architecture/core-contracts.md` 已承载 `AGENT` binding 目标契约，本 change 仅对齐实现。
- 模块设计：`openspec/designs/modules/agent-app.md` 主承载 Agent package source handling、assembly input、`AgentAssemblyRegistry` 与 `AgentDiscoverySource` implementation 职责；`openspec/designs/modules/agent-capability.md` 主承载 builtin Agent discovery、`local-agents` EAGER/SEARCH discovery、descriptor mapping 和 diagnostics。
- ADR：当前无新增 ADR。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `invoked-agent-discovery` 到相关 specs/designs/tests 的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] subagent discovery 被实现成执行入口。-> 在 spec、design 和 tasks 中明确 no side effect，并增加 no runtime facts tests。
- [风险] builtin Agent capability 被实现成第二套 descriptor 或 executor registry。-> 固定复用 `CapabilityDescriptor(kind="AGENT")`、reserved `builtin-agents` provider 和现有 Catalog governance；execution 仍后置。
- [风险] 为 subagent 新增 manifest，导致 Agent package 与 subagent package 双轨。-> 固定复用 `agent.yaml`，拒绝 `SUBAGENT.md`。
- [风险] 直接扫描 `workspaceDir/subagents` 很方便但会绕过 app-owned source 边界。-> 明确 subagent raw package inputs 只能在 `agent-app` source handling 内使用，`agent-capability` discovery 只消费 `AgentDiscoverySource` 返回的 compiled assemblies；本 change 不重新定义 `workspaceDir` 的核心契约语义。
- [风险] 本地 subagent 默认可见被实现为 synthetic `AgentAssembly.capabilityBindings`。-> Catalog request-scope `local-agents` parent-subagent SEARCH discovery 负责自动候选，assembly 只保留 explicit facts。
- [风险] request-scope SEARCH 可能重复查询 discovery source。-> 首版只要求查询 app-owned compiled assembly source，不做 raw file scanning；不定义 SEARCH cache、TTL 或 invalidation。
- [风险] `agent-app` 对 `AGENT` binding 的实现对齐影响既有 parser tests。-> 只做 `TOOL | SKILL | AGENT` 最小扩展，unknown type 继续 fail closed。

## 迁移计划（Migration Plan）

无数据迁移。现有 Agent package 没有 `subagents/` 时 discovery 返回空 candidates，不影响既有父 Agent request path。现有 `capabilityBindings` 中 `TOOL` / `SKILL` 行为保持兼容；新增 `AGENT` binding 仅用于显式启用/禁用 Agent capability candidates。未配置 builtin Agent assemblies 时，`builtin-agents` provider 返回空 candidates，不影响既有 Tool/Skill capability 行为。

回滚策略：移除 `local-agents` provider registration 后，顶层 local Agent 和父 Agent 本地 subagent 不再作为 Agent capabilities 被发现；既有 Tool/Skill capability 和主 Agent request path 不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/invoked-agent-discovery/spec.md`：归档 builtin Agent discovery、subagent discovery 行为、descriptor safety、no execution、remote out-of-scope。
- `openspec/specs/agent-package-assembly/spec.md`：归档 `subagents/{subagentId}/agent.yaml` candidate input、app-owned source handling、统一 assembly compile 和 identity uniqueness 规则。
- `openspec/specs/capability-catalog/spec.md`：归档 `AGENT` capability request-scope governance、disable、conflict 和 SEARCH criteria 规则。
- `openspec/overview.md`：补充本地 subagent 支持电信网络任务委派的长期背景。
- `openspec/designs/architecture/capability-spi.md`：归档 Agent capability discovery 复用统一 SPI、source facts 和 execution-deferred 边界。
- `openspec/designs/architecture/core-contracts.md`：核心契约已允许 `AGENT` binding；归档时仅确认实现对齐，无需新增 contract refinement。
- `openspec/designs/modules/agent-app.md`：归档顶层/local subagent source handling、同一 concrete implementation 提供 `AgentAssemblyRegistry` / `AgentDiscoverySource`、父 assembly 不嵌入 raw subagent facts。
- `openspec/designs/modules/agent-capability.md`：归档 builtin Agent discovery、`local-agents` EAGER/SEARCH discovery、provider identity、descriptor mapping 和 diagnostics。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。首版不定义 subagent 数量上限、目录大小上限、SEARCH cache TTL、执行预算或 child run 语义；这些不属于 discovery change 的可实施范围。
