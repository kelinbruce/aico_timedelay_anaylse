## 背景与问题（Why）

当前 NextAgent 已经具备 Agent package assembly、统一 Capability Catalog、Capability kind `AGENT`、builtin/local Skill source 和 capability conflict governance 等稳定边界。产品黑盒目标不是只发现父 Agent package 下的 `subagents/`，而是让所有 Agent 都进入统一 Catalog：可直接服务的顶层 Agent、只能被委派调用的内置 Agent、以及父 Agent package 自定义的 subagent 都应成为可治理的 `AGENT` capability candidate。`subagent` 是父 Agent 对另一个 Agent 的调用关系，不只等价于 `subagents/` 物理目录；顶层 Agent 或 builtin Agent 也可以通过 binding 成为另一个 Agent 的可调用 Agent。`agent-package-assembly` 已经把 `subagents/` 识别为 Agent package 的 package-scoped candidate input，但尚未定义这些 candidate 如何成为父 Agent 可见、可治理、可诊断的 `AGENT` capability。

这会导致两个问题：

- 父 Agent package 可以表达 `subagents/` 目录意图，但系统没有稳定规则把其中的子 Agent 发现为可委派目标，context engine 和 core 无法通过统一 catalog 获取可委托 Agent 清单。
- 后续本地子 Agent 执行、上下文继承和结果返回 change 缺少可复用的 discovery 前置事实，容易把子 Agent 执行语义、目录扫描和 catalog 可见性混在同一个 change 中。

本 change 的完整黑盒目标是补齐 Agent capability discovery 层：把可信内置 Agent、顶层 Agent，以及父 Agent package 下的本地 subagent 都映射为现有 `CapabilityDescriptor(kind="AGENT")`，并进入统一 Capability Catalog 治理。运行时再按当前父 Agent 的 binding、本地 subagent 默认可见、availability、conflict 和 model visibility 计算“当前 Agent 可调用的 Agent”，并把该 governed view 交给 prompt shaping。子 Agent 执行、child run、上下文继承、结果返回和远端 AgentRegistry discovery 均后置。

## 黑盒目标（Black-box Goals）

1. 内置 Agent：系统可以基于 default Agent 定制多个 builtin Agent；每个 builtin Agent 都进入 Catalog。builtin Agent 业务 package 由 `agent-core` 拥有，布局与开发者 Agent package 同形：`builtin-agents/{agentId}/agent.yaml` 和可选 `prompts/`。`agent-core` 只暴露 trusted `builtin-agents` 根目录；`agent-app` 负责扫描其直接子目录、读取 `agent.yaml`、装配和发布 compiled assembly，不维护手写 builtin Agent 列表。builtin Agent package 不配置旧 `workspaceDir` / `workspaceFiles`，运行态目录布局和文件能力策略统一由 compiled `AgentAssembly.workspacePolicy` 承载，其中 `workspacePolicy.files` 表达 read/write directory 和大小限制，不从当前默认路由 Agent 初始化全局文件权限。是否允许直接作为顶层 Agent 服务由 `AgentAssembly.userInvocable` 决定；是否允许被其他 Agent 绑定调用由 `AgentAssembly.agentInvocation` 决定；这些装配事实不进入 `CapabilityDescriptor`。Agent definition 可以省略这两个配置项，编译默认值为 `userInvocable=true`、`agentInvocation="BOUND"`。首版定义 canonical builtin invoked-only Agent `network-explorer`，用于网络运行证据收集、检索、读取和上下文整理；它必须编译为 `userInvocable=false`、`agentInvocation="BOUND"`。builtin tools 默认可用，因此它的 `capabilityBindings` 只配置对副作用 builtin tools 的显式禁用，并拥有自己的 `SYSTEM_PROMPT` 模板，将自身限定为只读 evidence collector。
2. Agent 自定义 subagents：父 Agent package 可以通过 `subagents/{subagentId}/agent.yaml` 定制多个 subagent；这些 subagent 自动成为当前父 Agent request scope 下的可治理 `AGENT` capability candidates。
3. Agent 绑定可调用 Agent：父 Agent 可以通过 `capabilityBindings` 绑定 `agentInvocation="BOUND"` 的 builtin Agent 或 `agents/` 顶层 local Agent；被绑定目标无论自身是否也可作为顶层 Agent，都可以成为当前父 Agent 的 invoked Agent。builtin Agent 的配置也使用同一 `capabilityBindings` 机制绑定 builtin subagent；首版默认 builtin Agent 显式绑定 builtin `network-explorer`，用于验证 builtin-agent-to-builtin-subagent 路径。父 Agent 自己 `subagents/` 下 `agentInvocation="PARENT"` 且 `parentAgentScope` 指向该父 Agent 的 local subagent 默认进入当前父 Agent callable view，显式 disable binding 可以隐藏。
4. 统一 Catalog：所有 Agent 类别，包括顶层 Agent、builtin Agent 和本地 subagent，都以现有 `CapabilityDescriptor(kind="AGENT")` 进入统一 Capability Catalog，并复用现有 Capability governance。
5. 模型可见：运行时通过 Catalog 查询当前 Agent 可以调用的 Agent；只有经过 governance 且 `AVAILABLE && modelInvocable=true` 的 Agent capability 进入 prompt。

## 变更范围（What Changes）

- 定义所有 Agent 都进入 Catalog：顶层 Agent、可信内置 Agent、以及父 Agent package 下的局部 subagent 都以 `CapabilityDescriptor(kind="AGENT")` 表达。
- 定义 subagent 是父 Agent package 下的局部 Agent package candidate，首版来源为 `agents/{parentAgentId}/subagents/{subagentId}/agent.yaml`。
- 明确 subagent package 复用现有 Agent package / `agent.yaml` 装配语义。
- 新增 Agent capability discovery 行为：可信内置 Agent capability、顶层 Agent capability 和父 Agent package 下的 subagent MUST 被发现为 `CapabilityDescriptor(kind="AGENT")`。
- 可信内置 Agent capability 首版由 `agent-capability` 通过 reserved `providerId="builtin-agents"`、`providerKind="BUNDLED"` 暴露为框架内置候选；它来自 `agent-core` 拥有的 trusted `builtin-agents` root 下的直接子目录和可信 app/capability composition。内置 Agent 是否可作为用户直接服务 / 默认路由 Agent 不是 `CapabilityDescriptor` 事实，由 `AgentAssembly.userInvocable` 判断；是否可被其他 Agent 调用由 `AgentAssembly.agentInvocation` 判断。
- 默认 builtin Agent 配置首版必须通过 `capabilityBindings` 显式绑定 builtin `network-explorer`，从而证明 builtin Agent 与 builtin subagent 之间不需要第二套绑定或发现机制。
- 本地 Agent capability 首版由 reserved `providerId="local-agents"`、`providerKind="LOCAL_DIRECTORY"` 承载；同一 provider 同时覆盖 `agents/{agentId}/agent.yaml` 顶层 local Agent 的 EAGER discovery，以及当前父 Agent `subagents/{subagentId}/agent.yaml` 的 SEARCH discovery。
- Agent capability discovery MUST 复用现有 `CapabilityDiscovery` / `CapabilityCatalog` 边界，输出 descriptor candidates 和 safe diagnostics；最终可见性由 Catalog 的 explicit binding、local subagent 默认可见、availability、binding disable、conflict resolution、model visibility 和 request-scope Agent Scope 判断。
- `agent-app` 负责可信 Agent package / subagent package locating、assembly input 和 compiled Agent assemblies；`agent-capability` 负责 Agent capability discovery adapter、descriptor mapping 和 catalog integration；`agent-core`、`agent-runtime` 和 `agent-context-engine` 只消费 compiled assembly facts 与 Catalog governed view。

## 边界与非目标（Boundaries / Non-goals）

- 不新增 `SUBAGENT.md`、subagent-only manifest、第二套 Agent descriptor、第二套 Agent catalog 或第二套 invocation envelope。
- 外部 `CapabilityProviderConfig` 不得声明、覆盖或禁用 reserved `builtin-agents` / `local-agents` provider identity。
- `agent-capability` 不解析 raw `agent.yaml`、不扫描 raw `agents/` 或 `subagents/`，只消费 `agent-app` 注入的 compiled `AgentAssembly` source。
- Discovery 阶段 MUST NOT 执行子 Agent、创建 child run/branch、调用模型、调用 Tool/Skill、读取子 Agent prompt 正文用于模型上下文，或写入父 run timeline/checkpoint/session history。
- Remote AgentRegistry discovery 和 remote invoked Agent execution 不纳入本 change。
- 本 change 不新增 Web API、stream event、audit schema、runtime command、persistence table 或 public readiness DTO。

## Capability 影响（Capabilities）

### 新增 Capability

- `invoked-agent-discovery`: 定义顶层 Agent、可信内置 Agent capability 和父 Agent package `subagents/` 如何被发现为统一 `AGENT` capability descriptor，并通过现有 Capability Catalog 治理 request-scope 可调用性、禁用、冲突、安全诊断和模型披露。

### 修改的 Capability

- `agent-package-assembly`: 补充 `subagents/` candidate input 的首版 layout、app-owned source handling、compile-time / discovery-time 职责边界、统一 assembly compile、identity uniqueness，以及 subagent 不直接成为 runtime-facing parent `AgentAssembly` 的规则。
- `capability-catalog`: 补充 `AGENT` capability candidates 的 request-scope discovery、explicit binding、本地 subagent 默认可见、binding disable、conflict/shadowing 和 model visibility 规则；继续复用现有 descriptor/catalog/invocation public surface。

## 影响范围（Impact）

- `agent-core`：拥有框架 builtin Agent 的业务 package 资源，包括 `builtin-agents/{agentId}/agent.yaml` 和可选 `prompts/`。它只暴露 trusted package root facts，不拥有 parser/compiler/discovery/catalog 装配。
- `agent-app`：统一拥有 builtin Agent package source 读取、`agents/` 顶层 local Agent 和父 Agent `subagents/` 的 Agent package source 选择、`agent.yaml` parsing、assembly compile、安全校验和 `AgentAssemblyRegistry` publication；所有来源最终都装配为现有 runtime-facing `AgentAssembly`，并在 assembly 中携带 `userInvocable`、`agentInvocation`、`sourceKind`、parent-only subagent 的 `parentAgentScope` 以及 `workspacePolicy.files`。同一个 app-owned concrete implementation MUST 同时提供 `AgentAssemblyRegistry` 和 `agent-capability` discovery 所需的 `AgentDiscoverySource`，两者来自同一批 compiled assemblies。
- `agent-capability`：新增/调整 Agent capability discovery adapter、内置/本地 Agent provider identity、descriptor mapping、safe diagnostics 和 catalog request-scope integration；必须定义最小 `AgentDiscoverySource` port，但不得拥有或编译 `AgentAssembly`，不得解析 raw `agent.yaml`，不得新增 builtin/subagent 专用 assembly 对象。
- `agent-contracts` / `agent-common`：复用现有 `CapabilityKind="AGENT"`、`CapabilityDescriptor` 和 `CapabilityCatalog` public surface；`AgentAssembly` 需要承载 `userInvocable`、`agentInvocation`、source/parent ownership 装配事实和 workspace file authority。本 change 不新增平行 Agent descriptor；`agent-app` parser/compiler 必须保留 `AGENT` binding 字面值，并继续 fail closed 拒绝 unknown capability type。
- `agent-core` / `agent-context-engine`：只通过 Catalog governed descriptors 消费可委托 Agent capability；不得直接读取 `subagents/` 或子 `agent.yaml`。
- 测试影响：需要增加 builtin Agent discovery、subagent assembly source handling、Agent capability discovery、catalog visibility、binding disable、conflict/shadowing、descriptor safety 和 architecture boundary tests。
- 运维和可诊断性：implementation-local diagnostics 需要能安全解释 source unavailable、invalid subagent package、duplicate/shadowed Agent capability、governance unavailable 和 successful registration，不暴露 raw path、prompt、secret 或 package content。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/invoked-agent-discovery/spec.md`：新增 stable capability contract，承载可信内置 Agent discovery、subagent discovery、descriptor mapping、Catalog governance、安全诊断和非执行边界。
- `openspec/specs/agent-package-assembly/spec.md`：补充 `subagents/` layout、app-owned source handling、统一 assembly compile 和 candidate input 职责。
- `openspec/specs/capability-catalog/spec.md`：补充 `AGENT` capability discovery candidates 的 request-scope 可见性和 binding/conflict 规则。

长期背景：
- `openspec/overview.md`：补充本地 subagent 作为电信网络智能体任务委派能力的长期目标；不记录临时实现步骤。

设计视图：
- `openspec/designs/architecture/capability-spi.md`：补充 Agent capability discovery 复用统一 Capability SPI、Catalog governance 和 execution-deferred 边界。
- `openspec/designs/architecture/core-contracts.md`：核心契约已允许 `AgentCapabilityBinding.capabilityType=AGENT`；归档时仅按需记录实现对齐结果，不新增 contract refinement。
- `openspec/designs/modules/agent-app.md`：补充同一 concrete implementation 提供 `AgentAssemblyRegistry` 和 `AgentDiscoverySource`、`subagents/` candidate input 和父 assembly 不嵌入 raw subagent package 的职责。
- `openspec/designs/modules/agent-capability.md`：补充 Agent capability discovery adapter、`AgentDiscoverySource` port、descriptor mapping 和 safe diagnostics。
- `openspec/designs/adr/<id>.md`：当前无新增 ADR；若实施中改变 Agent package layout 或 Capability provider vocabulary，再补 ADR。
- `openspec/designs/spec-to-design-map.md`：新增 `invoked-agent-discovery` 到相关 architecture/modules 设计入口的导航。

验证入口：
- `openspec validate add-ts-invoked-agent-discovery --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- focused tests for builtin Agent discovery, subagent discovery, catalog visibility, binding disable, conflict/shadowing, descriptor safety and no runtime/core/context source scanning.
