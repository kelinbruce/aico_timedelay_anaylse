## 背景与问题（Why）

变更前 TS 最小内核已经有一条可工作的 capability 路径：

- `agent-contracts/capability` 定义 `CapabilityDescriptor`、`CapabilityProvider`、`CapabilityCatalog`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort`
- `agent-capability` 提供 `StaticCapabilityCatalog`
- `agent-capability` 内置 `read` capability descriptor 和 invocation port
- `agent-app` 通过 `createStaticCapabilityCatalog([readDescriptor])` 装配
- `agent-context-engine` 和 `agent-core` 通过 `CapabilityCatalog` 查询和解析 capability

缺口不是缺少所有具体来源实现，而是缺少一条可扩展但足够小的统一骨架，使后续 builtin、local directory、SkillHub、MCP server、Agent registry 和 custom provider 能按同一条路径接入，而不是各自建立 discovery、catalog、execution 或 result 语义。

`add-ts-capability-core-governance` 旨在建立统一的 capability provider -> discovery -> catalog governance -> execution -> result consumption 骨架，并定义 `CapabilityProviderConfig` 的 validation/normalization 边界；默认内置 provider 路径必须暴露 `read` capability。

## 变更范围（What Changes）

- **复用/收敛** `agent-common` 和 `agent-contracts/capability` 公共契约：`CapabilityKind`、`CapabilityProviderKind`、`CapabilityReplayPolicy`、`AvailabilityStatus`、`CapabilityProvider`、`CapabilityDescriptor`、`CapabilityCatalog`、`CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort`
- **新增** `agent-contracts/capability` provider config 核心契约：`CapabilityProviderConfig`、`CapabilityDiscoveryMode` 和 `CapabilityProviderOptions`；`CapabilityProviderConfig` 统一使用 `{ provider, discoveryMode, options }`，`CUSTOM` 使用 `provider.providerType + CustomProviderOptions.customOptions`
- **新增/收敛** `agent-capability` 实现侧 provider skeleton：
  - `createCapabilitySubsystem(capabilityProviderConfigs)` 内部校验 `CapabilityProviderConfig[]`，并创建 trusted builtin provider
  - trusted builtin provider：`BUNDLED` provider 由 `agent-capability` 子系统固定注册，不受外部 provider config 控制
  - `CapabilityDiscovery` / `CapabilityDiscoveryFactory`：单一 factory 以 provider 为输入，创建 provider 实例 discovery
  - `CapabilityExecutor` / `CapabilityExecutorFactory`：单一 factory 以 resolved capability descriptor 为输入，输出 executor
- **修改** `agent-capability` catalog 实现：在 `StaticCapabilityCatalog` 路径上补齐注册、可用性 gate、Agent assembly binding 过滤和 resolve gate
- **修改** `agent-app` capability composition：Agent assembly 编译不再要求 capability descriptors 预发现；通过 `createCapabilitySubsystem(capabilityProviderConfigs)` 获取 `CapabilityCatalog` 和 `CapabilityInvocationPort`；capability 子系统装配影响仅限 capability port 创建；本 change 另行明确纳入 `ContextAssemblyRequest.identityContext` owner-scope 传递、runtime-owned `AgentRunStatePort` 构造注入，以及 `AgentConstructor[]` 注册，不重排或重新绑定其他无关子系统
- **修改** `agent-runtime` Agent 实例管理：runtime 拥有 `AgentInstanceManager`，创建 runtime-owned `AgentRunStatePort`，根据 `AgentAssembly.agentType` 从 app 注入的 `AgentConstructor[]` 选择实现，并按 `agentId + agentVersion + agentAssemblyRef` 缓存 Agent；runtime 不依赖 `agent-core` 或 `agent-app`
- **修改** `agent-core` Agent 实现形态：提供可选 `BaseAgent` 基类和 `DefaultAgent` constructor metadata；`DefaultAgent` 实现标准 `Agent` / `AgentConstructor` 契约，具体执行逻辑仍归 core
- **修改** `agent-core` result consumption：通过统一 `CapabilityInvocationResult` 显式消费 status、structured payload、generated messages、context patch、refs 和 safe error；`generatedMessages` 只进入当前 request/run 的后续模型输入，`contextPatch.allowedTools` 只能收窄当前可见 capability，`contextPatch.modelName` / `contextPatch.modelOptions` 必须经过 model selection/governance validation 后才能应用于当前 request/run 后续模型步骤，`resultRef` / `artifactRefs` 只作为安全引用传递；executor 和 core 不直接写 capability audit，而是发出可由 observability 派生 audit 的 canonical capability lifecycle event
- **修改** `agent-observability` audit derivation：从 runtime canonical `CAPABILITY_COMPLETED` timeline event 派生 `capability.completed`、`capability.failed` 和 `security.rejected` audit event；audit 派生不改变 request lifecycle

## Capability 影响（Capabilities）

### 修改的 Capability

- `agent-capability` - 提供 provider discovery/executor skeleton、catalog governance 和 read capability 骨架接入
- `agent-app` - 替换 capability 装配入口，并继续向 context/core 注入 `CapabilityCatalog` / `CapabilityInvocationPort`；同时按 6.4.1/6.6/6.7 注入 request-carried owner scope、Agent runtime dependencies 和 `AgentConstructor[]`
- `agent-runtime` - 拥有 runtime-owned `AgentRunStatePort` 和 Agent instance lifecycle/cache，通过标准 constructor 契约实例化 Agent
- `agent-core` - 完整消费统一 capability invocation result，并提供 `BaseAgent` / `DefaultAgent` 标准实现
- `agent-observability` - 从 canonical capability lifecycle event 派生 capability audit

### 新增的公共 Capability 配置契约

- 本 change 包含 `ts-core-contracts` contract refinement：catalog 公共契约名收敛为 `CapabilityCatalog`；provider config DTO/schema 由 `agent-contracts/capability` owning，用于锁定后续配置 change 的目标对象；该 config 只控制非 `BUNDLED` provider
- `CapabilityProviderConfig` 的 owning export surface 是 `agent-contracts/capability`；`agent-contracts/app` 不定义同名 provider config DTO，后续 app configuration 只引用 capability-owned config contract
- 本 change 不重命名已冻结 descriptor、invocation 或 result 字段，不新增第二套 descriptor、catalog、invocation envelope 或 result DTO
- 本 change 不把 catalog、discovery、executor 或 factory 实现类放入 `agent-contracts`

## 影响范围（Impact）

- `packages/agent-capability` - 在 catalog/read capability 基础上增加 provider discovery/executor skeleton
- `packages/agent-app` - 调用 `createCapabilitySubsystem(capabilityProviderConfigs)` 并注入返回的 `CapabilityCatalog` / `CapabilityInvocationPort`；同时承接 request-carried owner scope、Agent constructor registration 和 Agent runtime dependency injection；不重排或重新绑定其他无关子系统装配
- `packages/agent-runtime` - 新增 Agent instance manager，按 assembly-scoped key 缓存 Agent，并保持 runtime 不依赖 `agent-core` / `agent-app`
- `packages/agent-core` - 明确 capability result 消费规则，并提供 `BaseAgent` / `DefaultAgent` constructor implementation
- `packages/agent-observability` - 新增 capability timeline audit observer，从安全 timeline payload 派生 audit event
- `tests/contract` / `tests/architecture` / package tests - 补充 catalog、discovery skeleton、executor routing 和 result consumption 验证

## 与冻结契约的一致性（Contract Consistency）

- `CapabilityProvider` 仍是 descriptor 中的轻量 provider identity，只包含 `providerId`、`providerKind`、`providerType?`
- `CapabilityProviderKind` 继续复用冻结值：`BUNDLED`、`LOCAL_DIRECTORY`、`SKILL_HUB`、`MCP_SERVER`、`AGENT_REGISTRY`、`CUSTOM`
- 同一 `providerKind` 可以有多个 provider 实例；`providerId` 是实例标识，并用于 descriptor、Agent binding、diagnostics 和 executor/discovery instance 关联
- `CapabilityProviderConfig` 是 provider instance 配置契约，配置项不进入 `CapabilityDescriptor`，不得把 endpoint、credential reference、local path、cache dir 或 provider-private options 放入 descriptor；schema/normalization 必须拒绝 `provider.providerKind=BUNDLED`
- `BUNDLED` provider 不由外部配置声明或实例化；实施路径必须覆盖 trusted builtin provider -> EAGER discovery -> catalog -> executor -> result
- 目标 builtin tool provider id 是 `builtin-tools`；`read` 是该 provider 下首个、也是本 change 唯一发现的 builtin tool
- `CapabilityProviderConfig` 必须提供 config validation/normalization 边界；不得只定义类型而不定义校验和 factory 输入规则
- `CUSTOM` provider 必须使用 `provider.providerType`，并由 capability subsystem 的 discovery/executor factory 显式支持该 type
- `CapabilityInvocationRequest` 和 `CapabilityInvocationResult` 继续复用冻结契约；本 change 不新增第二套 invocation envelope 或 result DTO

## 非目标（Non-Goals）

- 不实现具体 builtin tool 全量清单，由 `add-ts-builtin-tool-discovery` 承接
- 不实现具体 Skill manifest、Skill content loading、INLINE/FORK、nesting facts 或 Skill invocation handler，由 `add-ts-skill-manifest-contract`、`add-ts-builtin-skill-source`、`add-ts-local-skill-source`、`add-ts-skillhub-source` 和后续 Skill invocation governance change 承接
- 不实现 MCP、SkillHub、local directory、Agent registry 或 custom provider 的具体 discovery/executor 逻辑
- 不实现外部 provider 配置文件格式、配置加载、配置层级合并、租户/Agent 级覆盖、热更新或 secret resolver；这些由 `add-ts-capability-source-configuration` 承接，并必须产出本 change 定义的 `CapabilityProviderConfig[]`，且该 schema 拒绝 `provider.providerKind=BUNDLED`
- 除本 change 明确规定的 `ContextAssemblyRequest.identityContext` owner-scope 传递、runtime-owned `AgentRunStatePort` 构造注入、以及 `AgentConstructor[]` 注册/Agent runtime dependency injection 外，不重构、重新排序或重新绑定 `agent-app` 中 runtime、context、model、gateway、observability、attachment、memory 或其他非 capability 子系统装配；capability 子系统影响只替换 capability catalog/invocation ports 的创建方式
- 不要求 Agent assembly 编译前完成 capability discovery；descriptor 存在性、availability、conflict 和 executable uniqueness 由 catalog 在 `listAvailable` / `resolve` 时治理
- 不实现远端 search cache、refresh API、下载、安装、TTL 或远端健康检查；只保留 `SEARCH` discovery skeleton
- 不实现具体冲突优先级、shadowing 或 override 策略，由 `add-ts-capability-conflict-resolution` 承接
- 不实现 invocation audit，由 `add-ts-capability-invocation-audit` 承接
- 不实现 idempotency/recovery 判断，由 `add-ts-capability-idempotency-contract` 和 `add-ts-runtime-recovery-idempotency-guard` 承接
- 不实现 sandbox 执行，由 `add-ts-executable-tool-sandbox-runtime` 承接
- 不重命名已冻结 public contract 字段；除本 change 明确新增的 provider config DTO/schema 外，其他 contract 变更必须先提出 contract refinement change
