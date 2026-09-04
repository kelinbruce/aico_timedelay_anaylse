## 背景和现状（Context）

本 change 要解决的是框架扩展注册边界，而不是 request lifecycle 或 capability 执行语义。当前代码基线中：

- `CapabilityDiscovery` 和 `CapabilityExecutor` 都暴露 `provider` 字段。Discovery 的 provider 目前是 catalog 既有治理输入；Executor 的 provider 需要收敛为 assembly-time binding，支持多个 provider 复用同一个 executor。
- `DefaultCapabilityDiscoveryFactory` 根据 provider id/kind 创建 discovery，属于 `agent-capability` 内部装配逻辑，但其中包含多个 framework/reserved provider 分支。
- `createCapabilitySubsystem()` 手工组合 builtin Tool catalog、Skill/Agent discovery、app tool catalog 和 executor list。
- `local-agents` 在稳定规格中使用同一 provider identity 承载顶层 local Agent EAGER discovery 和 parent subagent SEARCH discovery。该形态与“一个 provider 绑定一个 discovery”的目标模型存在 gap；本 change 将其拆分为 `local-agents` 和 `local-subagents` 两个 provider identity，避免一个 discovery 同时承担两种发现模式。

相关方和 owner：

- `agent-contracts/capability` 拥有跨包 capability contribution contract、provider-bound discovery public SPI 和 provider-neutral executor public SPI。
- `agent-capability` 拥有 agent-capability 内置/reserved provider assembly、config-driven provider contribution assembly、contribution validation/freeze、catalog assembly、executor factory assembly 和 invocation governance。
- 外部 capability owner package 负责构造自己的 provider/discovery/executor 组合，并导出 owner-owned contribution factory；app composition 调用 owner public factory 并作为 external contributions 传入 `agent-capability`。
- `agent-app` 负责配置解析、AgentAssembly 结构物化、依赖/adapter 注入、跨模块 external contribution 传递、owner-provided lifecycle/maintenance hook 注册和 ready gate startup graph validation；`agent-capability` 负责内置/reserved provider assembly、Tool-facing `WorkspaceFilePort`/sandbox filesystem preparation/cleanup 语义，并向 app composition 暴露 assembled `CapabilityProvider[]` facts。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 `agent-contracts/capability` 定义 owner-owned `CapabilityProviderContribution` public contract，每个 contribution 绑定一个 provider、一个 provider-bound discovery 和零到一个 provider-neutral executor。
- `agent-capability` 在装配阶段自装配 internal contributions、转换 config-driven contributions、合并 external contributions，并统一生成 `CapabilityProvider[]` facts、catalog discoveries 和 invocation executor factory；catalog 发现路径尽量复用既有 provider-bound discovery 输入。
- `agent-app` 将 AgentAssembly 装配拆成结构物化和 startup graph validation 两步：结构物化不依赖 capability provider facts；所有 model profile、capability provider、hook、routing target 和 Agent binding visibility 的有效性校验在 capability/resource/hook/workflow 等 startup resources 装配完成后统一执行。
- `agent-capability` 运行阶段只通过 catalog 做统一发现，只通过 executor factory 获取 executor 并调用。
- builtin Tool/capability 注册事实从 `agent-app` 中心装配收敛为 `agent-capability` internal owner-owned contribution 输入。
- framework/reserved provider 由 `agent-capability` assembled owner contribution 进入 startup resource inventory。

**非目标：**

- 不引入运行时插件热加载、watcher reload、动态安装、远端 marketplace 或任意目录扫描。
- 不改变 `CapabilityDescriptor.provider`；descriptor provider 仍是 catalog governance 和 invocation routing 的事实。
- 不改变 request lifecycle、Agent Scope、Owner Scope、session/run persistence、terminal commit、stream projection 或 capability invocation public contract。
- 不实现 `add-ts-agent-scoped-plugin-composition` 或 `add-ts-simple-agent-facade`。

## 设计决策（Decisions）

### D1: 以 `agent-contracts/capability` 的 `CapabilityProviderContribution` 作为 capability 扩展注册中心模型

`CapabilityProviderContribution` 是跨 package owner contribution contract，定义在 `agent-contracts/capability` 并通过该 subpath public export 暴露。`agent-capability` 作为该 contract 的 consumer，负责 validation、freeze、catalog assembly 和 executor factory assembly。由于 contribution contract 直接引用 discovery/executor public SPI，`CapabilityDiscovery` 和 `CapabilityExecutor` 也随本 change 收敛到 `agent-contracts/capability`：Discovery 保持 provider-bound，Executor 调整为 provider-neutral。`agent-capability` 保留具体实现、default executor 推导和内部 lookup table。

`agent-contracts/capability` 同时承载 `CapabilityProviderContribution`、`CapabilityDiscovery`、`CapabilityExecutor` 及其 public method signature 需要的 public types。`CapabilitySearchCriteria`、`SkillScanEvidenceItem` 等 discovery public input/output 类型归 `agent-contracts/capability`。Tool executable lookup 是跨 owner contribution 需要暴露的 default executor interface，因此 `ToolExecutableDiscovery` 及其 `ExecutableTool` return type 也归 `agent-contracts/capability`；具体 Tool 定义和执行实现仍由 owning package 提供。

选定接口形态：

```ts
export interface CapabilityProviderContribution {
  readonly provider: CapabilityProvider;
  readonly discovery: CapabilityDiscovery;
  readonly executor?: CapabilityExecutor;
}
```

`provider` 是 contribution 的权威身份。`discovery` 负责发现并产出 `CapabilityDescriptor`，且其 public `provider` 必须与 contribution provider 一致；`executor` 负责执行并保持 provider-neutral public SPI。一个 contribution 只允许绑定一个 discovery 和一个 executor；不同 provider 可以复用同一种 discovery/executor 实现。Discovery object 仍按 provider 绑定生成独立对象，Executor object 可以被多个 provider 复用并由 `agent-capability` 内部 lookup table 完成 provider 绑定。

`executor` 是可选的，因为不同 provider 的执行方式不同：local tool（builtin、memory 等）按 tool name 从 ToolCatalog 查找并调用 `tool.execute`，由 `BuiltinToolsExecutor` 作为纯路由器执行；MCP tool 需要调用 MCP Server；远程 provider 需要网络调用。当前架构中 `ToolDefinition` 已自带 `execute` 函数（`tool-spi.ts:184-191`），`BuiltinToolsExecutor` 从 catalog 按 `capabilityId` 查找 `ToolDefinition` 并调用 `tool.execute`。local tool provider 由 `agent-capability` 内部根据 discovery 的 `ToolExecutableDiscovery` interface 创建 `BuiltinToolsExecutor`；MCP、远程等 provider 显式提供 executor。

取舍结论：

- Owner package 自行构造 provider/discovery/executor 对象，`CapabilityProviderContribution` 直接表达组合关系，避免额外 binding 类型把 registry 扩大成 DI 容器。
- `CapabilityDiscovery.provider` 保持为 public SPI 字段。Catalog 现有治理路径消费 provider-bound discovery；contribution validation 校验 `contribution.provider == discovery.provider`，catalog 继续校验 discovery 产出的 descriptor provider。
- `CapabilityExecutor` 采用 provider-neutral public SPI。多个 provider 可复用同一个 executor，provider 到 executor 的关系由 contribution assembly 生成的内部 provider-aware lookup table 表达。
- Extension registry 采用 startup pull 模式。`agent-capability` 在 subsystem composition 内部汇总 internal/config-driven/external contributions 并冻结 snapshot，生命周期由 `createCapabilitySubsystem()` 统一承载。

### D2: `CapabilityDiscovery` 保持 provider-bound，`CapabilityExecutor` 调整为 contract-owned provider-neutral SPI

目标接口定义在 `agent-contracts/capability`：

```ts
export interface CapabilityDiscovery {
  readonly provider: CapabilityProvider;
  readonly discoveryMode: CapabilityDiscoveryMode;
  listAll?(signal: AbortSignal): Promise<readonly CapabilityDescriptor[]>;
  resolve?(capabilityId: CapabilityId, signal: AbortSignal): Promise<CapabilityDescriptor | undefined>;
  search?(criteria: CapabilitySearchCriteria, signal: AbortSignal): Promise<readonly CapabilityDescriptor[]>;
  getSkillScanEvidence?(): readonly SkillScanEvidenceItem[];
  getSkillScanRoot?(): string | undefined;
}

export interface CapabilityExecutor {
  readonly capabilityKinds: readonly CapabilityKind[];
  invoke(descriptor: CapabilityDescriptor, request: CapabilityInvocationRequest, signal: AbortSignal, runtimeContext?: CapabilityInvocationRuntimeContext): Promise<CapabilityInvocationResult>;
}
```

Discovery 保留 `provider` 和 `discoveryMode` 作为 public SPI 字段，一个 discovery object 只声明一种 provider 和一种发现模式。EAGER discovery 通过 `listAll/resolve` 进入启动期或缓存型发现路径；SEARCH discovery 通过 `search` 进入 request-scope 查询路径。Catalog 继续消费 provider-bound discovery，减少 catalog 主路径迁移。Contribution assembly 负责校验 discovery provider 与 contribution provider 一致；catalog 继续按既有规则校验 discovery 返回的 descriptor provider 与 discovery provider 一致。

### D3: Catalog 继续消费 provider-bound discovery，contribution assembly 负责投影

`StaticCapabilityCatalog` 的发现输入保持为 provider-bound discovery。`agent-capability` 在 subsystem assembly 阶段先校验并冻结 contributions，再把其中的 provider-bound discoveries 投影为 catalog 既有的 EAGER/SEARCH discovery 输入。Catalog 构建 request-scope view 时：

1. 对 `discoveryMode="EAGER"` 的 discovery 调用 `listAll/resolve` 收集 startup descriptors。
2. 对 `discoveryMode="SEARCH"` 且当前 Agent scope 需要 request-scope 查找的 discovery 调用 `search`。
3. 校验每个 descriptor 的 `provider` 与 discovery provider 一致。
4. 复用既有 Agent binding filtering、default-enabled provider policy、conflict resolution 和 availability filtering。

`local-agents` 的现有双路径拆分为两个 provider contribution：`local-agents` provider 绑定 EAGER discovery（启动时 `listAll/resolve` 顶层 local agents），`local-subagents` provider 绑定 SEARCH discovery（运行时 `search` parent-scoped subagents）。每个 discovery 只支持一种 mode，不混合 EAGER 和 SEARCH——EAGER 在启动时全量列出并缓存，SEARCH 在运行时按条件查询不缓存，两者调用时机、调用方式和缓存策略完全不同，混合在一个 discovery object 中违反单一职责。拆分后 Agent binding 和 routing constraints 可以分别控制顶层 local agents 和 parent subagents。本 change 通过 `invoked-agent-discovery` active spec delta 修改稳定规格中原有的同 provider 约束：`local-agents` 收敛为"顶层 local agent EAGER discovery"，新增 `local-subagents` 作为"parent-scoped subagent SEARCH discovery"的 reserved provider identity。

### D4: Executor factory 消费内部 provider-aware lookup table，并支持安全默认 executor

`StaticCapabilityExecutorFactory` 消费由 contributions 生成的 `agent-capability` 内部 provider-aware executor lookup table；该 table 是实现细节，跨模块 SPI 只暴露 provider-neutral executor contract。

如果 contribution 显式提供 executor，则直接绑定。若未提供 executor，`agent-capability` 只基于 discovery 的受控 executable interface 推导默认 executor。首版默认规则只支持 `ToolExecutableDiscovery`：

- discovery 满足 provider-bound `ToolExecutableDiscovery` / `ToolCatalog` 接口；
- 默认 executor 为 `BuiltinToolsExecutor`；
- executor 调用时必须校验 descriptor provider 与 contribution provider 一致；
- 不允许仅按 `CapabilityKind="TOOL"` 推导 executor。

目标 executable discovery 形态：

```ts
export interface ToolExecutableDiscovery extends CapabilityDiscovery {
  readonly discoveryMode: "EAGER";
  resolveExecutable(capabilityId: CapabilityId): ExecutableTool | undefined;
}
```

`ToolExecutableDiscovery` 继承 `CapabilityDiscovery.provider`。当前 `ToolCatalog` 可以演进为该接口的实现，并保留 public `provider` 字段以继续服务 catalog 和 descriptor projection。默认 executor 创建时使用 contribution/discovery provider 建立 provider-aware executable lookup，executor 对象保持 provider-neutral。

缺少显式 executor 或安全默认 executor 时，`agent-capability` assembly 记录 safe diagnostic；catalog 将对应 executable descriptor 标记为 unavailable；invocation 兜底返回 safe failure。该顺序是本 change 的唯一 outcome 路径。

### D5: `agent-capability` 拥有 capability subsystem contribution assembly

`createCapabilitySubsystem()` 是 public subsystem 装配入口，它内部创建 `agent-capability` owned internal contributions、把用户配置型 provider 转成 config-driven contributions，并合并外部 owner contributions。目标签名收敛为单一 options object，替代旧的 `createCapabilitySubsystem(providerConfigs, options)` 双参数形态和 app-composed tool catalog 注入；`CapabilitySubsystemOptions` 使用 `providerConfigs` 与 `externalContributions`，并移除 `appToolCatalogs`：

```ts
createCapabilitySubsystem({
  providerConfigs,
  externalContributions,
  toolDependencies,
  agentDiscoverySource,
  localSkillDiscoveryOptions,
  clipCommandRunner,
  clipDiagnostics,
  clipcDisclosureMode,
  skillHubRemoteAccessFactory,
  skillHubSourceAuthorization
})
```

这些运行时依赖仍由 `agent-app` 注入，因为它们来自 sandbox gateway、remote gateway、route assembly、system config 或授权上下文。迁移后的变化不是让 `agent-app` 继续解释 capability 业务对象，而是让 `agent-app` 只传入创建 capability-owned dependency 所需的可信 options/adapters。`WorkspaceFilePort` 属于 `agent-capability` 的 Tool-facing filesystem boundary，由 `agent-capability` 根据 app 注入的 runtime workspace root、execution workspace resolver、deployment mode、workspace policy provider 等 facts 装配；`agent-app` 不直接 import、创建、返回或调用 `WorkspaceFilePort`，也不调用 `workspaceFiles.clearRun()`、`workspaceFiles.sandboxFilesystem()` 或 `workspaceFiles.resolveView()`。

`createCapabilitySubsystem()` 返回值收敛为 capability 运行时端口、provider facts、capability-owned startup validation/reporting 入口，以及需要由 app 注册到 runtime/scheduler 的 owner-provided lifecycle/maintenance hooks：`catalog`、`invocationPort`、`capabilityProviders: readonly CapabilityProvider[]`、`validateStartupRegistration()`、`collectSkillScanReport()`，以及窄化的 cleanup/maintenance callbacks 或 jobs。它不返回 contribution snapshot、discovery、executor、`CapabilityProviderConfig[]`、`workspaceFiles` 或独立 diagnostics 字段。`capabilityProviders` 是 AgentAssembly startup graph validation 的权威输入，不要求 `agent-app` 通过 hard-coded provider list 或 owning package provider identity exports 重新拼装一份清单。

`agent-app` 的 `StartupResourceProviderRegistry` 可以继续保持 app-owned registry 类型，但其输入必须来自 `agent-capability` returned `capabilityProviders` 和其他已装配 startup resource facts，而不是由 `agent-app` 手写 framework/reserved provider 清单。AgentAssembly 结构物化阶段不读取该 registry；registry 只在全局 startup graph validation 和后续 ready graph 发布前使用。

`agent-capability` 自身不依赖其他模块的校验应在 capability 边界内完成：contribution shape、duplicate provider、provider/discovery mismatch、Tool-facing workspace/sandbox dependency option shape 等同步问题在 subsystem assembly 期间直接 fail closed；需要 EAGER discovery 或异步读取的 capability-owned readiness 检查由 `validateStartupRegistration()` 返回统一 capability startup validation outcome。`agent-app` 不重复执行 capability-owned validation，只负责 model profile、AgentAssembly、hook、workflow/skill/capability graph 等跨模块 startup graph validation。

`agent-capability` 内部可以保留窄 contribution helper：

```ts
createBuiltinToolsProviderContribution(...)
createBuiltinSkillsProviderContribution(...)
createBuiltinAgentsProviderContribution(...)
createLocalSkillProviderContributions(...)
createLocalAgentProviderContributions(...)
createConfigDrivenProviderContributions(...)
```

这些 helper 可以接收 `agent-capability` 自己需要的 config/options/dependencies，由 `createCapabilitySubsystem()` 内部调用。`agent-capability` 负责对 internal/config-driven/external contributions 做通用校验、冻结、catalog assembly 和 executor factory assembly。

外部模块（如 `agent-memory`）的 tools 贡献为新增 provider（如 `memory-tools`）+ 对应 discovery（ToolCatalog）。外部 contribution 的构造者是 owning module：`agent-memory` 应通过 public export 提供类似 `createMemoryToolsProviderContribution(port): CapabilityProviderContribution` 的 factory；`agent-app` 调用该 owner factory 并把结果作为 `externalContributions` 传入 `createCapabilitySubsystem()`。理由：`builtin-tools` 的语义是 `agent-capability` 的内置 tools；外部 tools 使用独立 provider identity，便于按 provider 单独治理（如 memory tools 与 builtin tools 分开启停）。Provider 是薄 identity，新增成本极低；每个 owning package 贡献自己的 provider identity + discovery，保持 provider 语义清晰和治理粒度细。

对于用户配置型 provider，`agent-capability` 保留内部 discovery factory 作为装配期实现细节，把 `CapabilityProviderConfig` 转换成 contribution。跨模块 public contract 收敛到 `CapabilityProviderContribution` 和 `createCapabilitySubsystem()`：`CapabilityDiscoveryFactory` / `createDefaultCapabilityDiscoveryFactory` 留在 `agent-capability` 内部，`CapabilitySubsystemOptions` 接收 config、依赖和 contributions。

### D6: Builtin Tool contribution 保持 owning package 内部管理

内置 Tool 使用 `agent-capability` owner-local stable list（当前为 `builtinToolDefinitions`）作为本 change 的唯一启动期确定性输入。新增 builtin Tool 在 `agent-capability` owning package 内新增 Tool 定义并更新该 stable list。该 stable list 作为 `agent-capability` internal contribution helper 的输入构造 `CapabilityProviderContribution`，保持启动确定性和可审计性。

### D7: `agent-app` 先物化 AgentAssembly，再在 ready gate 校验 assembled startup graph

`agent-app` startup composition 先解析配置和 Agent definitions，并将 Agent definitions 物化为现有 `AgentAssembly` shape。该阶段只做格式/结构安全校验：safe id、路径不逃逸、字段 shape、routing/hook 基础语法、workspace policy projection 等。该阶段不得校验依赖其他 startup resources 的有效性，也不得因为 capability provider、model profile、hook definition、workflow/skill routing target 等引用暂不可用而失败。

随后 `agent-app` 传递配置、依赖和可信外部 owner contributions 给 `agent-capability`：

```text
CapabilityProviderConfig[]
External CapabilityProviderContribution[]
Capability subsystem dependencies/options
```

随后由 `agent-capability` 形成 frozen contribution snapshot，并组装 catalog/invocation port。Framework/reserved provider id/kind 到 discovery/executor 的转换，以及外部 owner raw tool definition 到 contribution 的转换，分别由对应 owning package 承担。AgentAssembly 的跨资源有效性由 final startup graph validation 统一校验，校验输入包括 `agent-capability` returned `capabilityProviders`、model profile registry、lifecycle hook definitions、workflow/skill routing facts 和 materialized AgentAssembly graph。

`agent-app` 不承载 capability 业务语义。cleanup、snapshot invalidation、execution workspace root 解释、sandbox filesystem mount、Python temp script preparation、Skill resource projection cleanup 等规则属于 `agent-capability` / workspace-files owner；request/run terminal 时机属于 `agent-runtime`；`agent-app` 只把 capability owner 暴露的 cleanup callbacks / scheduled maintenance jobs 注册到 runtime observation 或 scheduler，并把 sandbox gateway execute adapter、risk policy evaluator、runtime workspace facts 等组合输入传给 capability subsystem。实现上不得通过把 `WorkspaceFilePort` 返回给 app 来让 app 调用具体方法完成 cleanup 或 sandbox request preparation。

startup graph validation 至少覆盖：

- active Agent 与 `systemConfig.activeAgentId` 一致，且 active Agent user-invocable。
- `modelProfileIds`、default model profile 和 selected model profile 存在、enabled，并满足当前 model provider policy。
- `capabilityBindings` 引用的 provider 来自 `agent-capability` returned `capabilityProviders`。
- lifecycle hook activation 引用已装配 hook definition，stage/order/effect group 和 stage 数量上限满足 hook governance。
- routing policy 目标引用已装配 skill/workflow/capability graph 中的有效目标。
- builtin/local/top-level/subagent Agent binding visibility、parent scope 和 invocation policy 满足 Agent discovery governance。

任一 startup graph validation 失败均产生 blocking readiness outcome，app 不进入 ready，也不接收 request、stream、history 或 control traffic。

现有 app-composed `appToolCatalogs` 路径在本 change 中收敛为 external contribution 路径：`agent-memory` 导出 `createMemoryToolsProviderContribution(...)`，`agent-app` 调用该 factory 并把返回值加入 `externalContributions`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 注册发生在启动期；contribution 来源为 trusted package export / owner-local stable list / app composition input。ready 前允许 materialized AgentAssembly graph 作为 startup 内部中间态存在，但 runtime、channel 和 request path 只能使用已通过 startup graph validation 的 ready graph。safe diagnostics/outcomes 只包含 provider id、capability id、agent id/version、reason code 等低敏字段。 | `extension-registration` contract tests；safe diagnostic validation tests；startup graph validation tests；architecture grep 覆盖 startup-only contribution source |
| 性能/容量 | contribution snapshot 在启动期冻结；request path 复用 catalog 和 executor factory 中的 frozen facts。Builtin Tool owner-local stable list 使用静态 import。 | startup/invocation characterization tests；unit tests 断言 request path 使用 frozen contribution snapshot |
| 可靠性/恢复 | 重复 provider/capability、descriptor provider mismatch、缺 executor 进入 blocking readiness outcome 或安全失败结果；本 change 只使用 restart-scoped snapshot 状态。 | fail-closed unit/contract tests；executor factory conflict tests |
| 可维护性 | provider/discovery/executor 组合关系由 `agent-contracts/capability` 的 contribution contract 显式承载；`agent-capability` 自装配自己的 internal/config-driven contributions 并治理全部 contribution snapshot；`agent-app` 只传配置、adapter/options 和 external contributions，只注册 owner-provided lifecycle/maintenance hooks，并把跨资源有效性集中到 startup graph validation。 | dependency-cruiser / architecture tests；code review 检查 `agent-capability` assembly 和 app composition 边界 |
| 可测试性 | contribution factory、catalog assembly、executor factory 都可单元测试。 | `packages/agent-capability/tests/*extension-registration*.test.ts` |
| 审计/可追溯性 | startup contribution validation 产生 safe diagnostic；运行期仍使用既有 capability observability，不新增 timeline 事实。 | diagnostic tests；observability code review 检查不新增 request timeline 事实 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Extension registration startup-only and frozen | 1.1, 1.4, 5.1 | extension registration contract tests；request-time immutability tests |
| Builtin capability contributions are owner-owned startup facts | 2.1, 2.2, 5.2 | builtin Tool contribution tests |
| Startup provider contribution binds one provider, one discovery, optional executor | 1.1, 1.2, 3.1 | contract build；contribution validation tests；catalog assembly tests |
| AgentAssembly 装配与有效性校验分离 | 4.3, 4.5, 5.6 | startup graph validation tests；config assembly tests；architecture tests |
| Discovery public SPI 保留 provider 和单一 `discoveryMode`，Executor public SPI 保持 provider-neutral | 1.2, 1.3, 5.4 | TypeScript build；architecture tests |
| Executor default derivation only from `ToolExecutableDiscovery` | 1.3, 3.2 | executor factory unit tests；executable-interface validation tests |
| User config cannot spoof reserved provider | 3.3, 5.3 | capability source configuration tests |
| Top-level local agents and parent-scoped subagents use separate reserved providers | 2.4, 5.4 | invoked-agent-discovery active spec delta；invoked-agent-discovery tests |
| Extension registration does not redefine execution semantics | 4.1, 5.5 | integration tests；architecture lint；code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/extension-registration/spec.md` 主承载 startup contribution registry 行为；相关稳定事实归档时分发到 `builtin-tool-framework`、`capability-catalog`、`capability-source-configuration` 和 `app-config-schema`。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 `agent-contracts/capability` provider/discovery/executor contribution SPI 和 catalog/invocation 关系；`openspec/designs/architecture/configuration-boundary.md` 主承载 startup-only/frozen 配置和 reserved provider 关系。
- 模块设计：`openspec/designs/modules/agent-capability.md` 主承载 capability contribution assembly、catalog、executor factory、Tool-facing workspace/sandbox dependency assembly 和 capability-owned cleanup semantics；`openspec/designs/modules/agent-app.md` 主承载 app composition 只传配置、adapter/options、external contributions，并注册 owner-provided lifecycle/maintenance hooks。
- ADR：如实施中仍需要记录“保留 discovery provider、删除 executor provider”的长期取舍，可新增 `openspec/designs/adr/adr-capability-provider-contribution-binding.md`。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 extension-registration 到 capability SPI、agent-capability、agent-app 的导航。

## 风险与取舍（Risks / Trade-offs）

- [迁移注意] `CapabilityExecutor.provider` 收敛会触达 executor factory 和 executor implementations。-> 分任务迁移，先引入 contribution binding 和测试，再逐步改 executor factory/owner implementations；保留 `CapabilityDiscovery.provider` 和 `CapabilityDescriptor.provider`，控制 catalog 迁移范围。
- [迁移注意] `local-agents` 当前稳定规格要求同一 provider 同时支持 EAGER 和 SEARCH。-> 本 change 增加 `invoked-agent-discovery` active spec delta，拆分为 `local-agents`（EAGER）和 `local-subagents`（SEARCH）两个 provider，每个 discovery 只支持一种 mode；实施和测试以 active spec delta 为准，归档时再提升长期基线。
- [迁移注意] 默认 executor 推导保持窄口径。-> 默认规则只支持受控 executable discovery interface，并校验 contribution/discovery/descriptor provider 一致。
- [迁移注意] AgentAssembly 先结构物化再全局校验会改变失败时机。-> startup validation 必须在 app ready 前运行；失败仍是 blocking readiness outcome，不得让未通过校验的 assembly 进入 runtime request path。
- [迁移注意] `agent-app` capability wiring 收敛到配置、adapter/options、external contributions 和 owner-provided lifecycle/maintenance hook 注册。-> 增加 architecture tests，覆盖 app composition 与 `agent-capability` internal provider contribution helpers 的边界，防止 `agent-app` 重新维护 framework/reserved provider 清单，并禁止 `agent-app` 直接 import/create/call `WorkspaceFilePort` 或实现 cleanup/sandbox filesystem preparation 语义。

## 迁移计划（Migration Plan）

无数据迁移和持久化迁移。实施按以下代码迁移顺序推进：

1. 在 `agent-contracts/capability` 增加 contribution contract、provider-bound discovery public SPI、provider-neutral executor public SPI，以及这些 SPI method signature 需要的 public support types；在 `agent-capability` 增加 validation 和 frozen snapshot assembly，不接入产品路径。
2. 将 contribution snapshot 投影为既有 catalog discovery 输入，并将 executor factory 改为消费 `agent-capability` 内部 provider-aware executor lookup table，保持现有 providers 行为不变，并移除 app-facing discovery factory injection point。
3. 将 builtin Tool、Skill、Agent、local Skill/Agent、Clip/SkillHub 和用户配置型 provider 逐步迁移为 `agent-capability` internal/config-driven contribution assembly。
4. 为外部 owner contributions 增加 `createCapabilitySubsystem()` 输入，移除 `appToolCatalogs`，并将现有 app-composed memory ToolCatalog 迁移为 `agent-memory` owner-exported contribution factory。
5. 将 AgentAssembly 装配拆成格式/结构物化和 startup graph validation；移除 compile 阶段对 model profile、provider、hook、routing target、Agent binding visibility 等跨资源有效性依赖。
6. 收敛 `agent-app` wiring 为配置、adapter/options、external contributions 传递和 owner-provided lifecycle/maintenance hook 注册；`agent-capability` 内部装配 owned builtin/reserved providers、Tool-facing `WorkspaceFilePort`、sandbox filesystem preparation 和 cleanup hooks/jobs，并向 app ready gate 暴露 startup graph validation 所需的 `CapabilityProvider[]` facts。

回滚策略：如果迁移中发现 provider contribution assembly 阻断主路径，可在本 change 完成前回退到旧的 subsystem composition；完成后不保留双路径。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/extension-registration/spec.md`：归档 startup extension registration 行为。
- `openspec/specs/builtin-tool-framework/spec.md`：归档 builtin Tool owner-owned contribution 约束。
- `openspec/specs/capability-catalog/spec.md`：归档 provider contribution、catalog assembly、executor factory 和 provider mismatch fail-closed 规则。
- `openspec/specs/capability-source-configuration/spec.md`：归档用户配置消费已注册 support facts，reserved provider 由 trusted startup contributions 声明。
- `openspec/specs/app-config-schema/spec.md`：归档 app composition 只传配置、依赖和 external contributions 的边界。
- `openspec/specs/invoked-agent-discovery/spec.md`：归档 `local-agents` / `local-subagents` provider identity 拆分。
- `openspec/designs/architecture/capability-spi.md`：归档 provider/discovery/executor contribution SPI、descriptor provider 保留和 executor default derivation。
- `openspec/designs/modules/agent-capability.md`：归档 contribution assembly、catalog 和 executor factory。
- `openspec/designs/modules/agent-app.md`：归档 app composition 不拥有 capability contribution snapshot assembly 的边界。
- `openspec/designs/spec-to-design-map.md`：补充导航。

## 待确认问题（Open Questions）

无。
