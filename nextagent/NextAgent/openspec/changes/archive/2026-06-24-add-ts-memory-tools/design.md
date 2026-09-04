## 背景和现状（Context）

`add-ts-memory-core` 负责定义长期记忆的核心 DTO、检索/存储端口、owner scope 隔离、L1/L2 渐进披露、禁用降级和混合排序语义。core local store/retriever 参考 session 机制直接由 gateway-local 实现并由 app composition 注入；长期记忆业务 lifecycle 由 selected memory backend 拥有：local backend 的后续业务编排可位于 `agent-memory` 边界，remote complete-service backend 位于远端长期记忆服务。Capability 通过统一 capability execution 边界执行，runtime 拥有 request lifecycle、cancellation、timeline 和 terminal commit。

本变更位于这些边界之上，只提供模型执行期可调用的长期记忆工具。它不创建新的 request lifecycle，不修改 context assembly，不定义后台 job，不定义 REST API，也不定义存储表结构。主要相关方是 Memory/Learning owner、Capability owner、Runtime/Core owner、Audit/Observability owner 和后续实现 memory-core 的团队。

### 存量代码基线

- `agent-capability` 当前提供统一 Tool SPI、catalog、discovery、executor、JSON Schema validation 和 capability invocation；`read`、`write`、`glob`、`bash`、`python` 和 `skill` 等通用内置工具通过该机制注册。本 change 复用同一机制，但 3 个 memory tool definitions/provider 由 memory owning boundary 提供，而不是扩展 `agent-capability` 核心或通用 builtin 工具集合。
- `agent-capability` 的 `CapabilityCatalog` 和 `CapabilityInvocationPort` 已存在，memory tools 复用既有 capability 执行通道。
- 当前代码基线尚未提供 `add-ts-memory-core` 的 public memory gateway boundary；gateway store/retriever、SafeError code 和 L1/L2 projection contract 需要先由 core change 落地。`agent-memory` 不属于 core store/retriever 的必经层，只在后续 local lifecycle 编排需要时由对应 change 接入。
- 当前 `agent-app` composition root 尚未在 capability subsystem 初始化前从 memory tool provider 获取 long-term memory tool definitions，也尚未创建 long-term memory tool adapter；本 change 只能在 core public boundary 和 app composition 接线具备后实施。

`add-ts-memory-tools` 的 tool provider 可以在 `agent-memory` 中作为 memory owning boundary 的 public factory 静态存在，但 capability registration、tool discovery 和运行期调用必须动态受控：只有 `add-ts-memory-core` 在目标 release scope 内可用、`add-ts-memory-configuration` 已冻结 `VALID` 的 `MemoryConfig`、当前 AgentAssembly 选择启用 memory tools，并且 app composition 提供有效的 selected memory gateway ports / memory tool adapter 时，`agent-app` 才把该 provider 返回的 tool definitions 以稳定 `providerId="memory-tools"` 交给现有 capability catalog，memory tools 才能进入模型可见 tool discovery、effective capability catalog 和可执行调用路径。该 provider identity 只标识 capability catalog 中的 model-facing memory tools，不选择 local/remote memory backend；backend 由 app composition 选择后注入最小 `LongTermMemoryToolPort`。本变更不得声明为独立交付；在当前代码基线下应视为待实施设计，不能按已完成实现归档。

## 第一性原理和业务边界（First Principles / Business Boundary）

本 change 的第一性原理是：Agent 在一次请求执行中需要一种安全、可审计、按需的方式访问和管理跨会话长期记忆；这个入口必须由模型显式触发，并且不能绕过 capability、owner scope、memory core 和 audit 边界。

业务边界固定为“模型可调用的长期记忆工具契约”：

- 对模型暴露 3 个黑盒工具能力，而不是暴露 memory store、retriever、索引、表结构、删除/维护接口或后台生命周期。
- 工具只在 capability invocation 阶段执行，不参与 request acceptance、context assembly、terminal commit 或后台调度。
- 工具只服务模型驱动 loop；非模型模块、后台任务、维护流程、context assembly、runtime、channel、`agent-memory` extraction/aging/maintenance 编排和 gateway adapter 不得调用 memory tools、tool descriptor、capability executor 或 `LongTermMemoryToolPort` 作为内部服务 API。
- 工具只接收业务参数，不接收身份参数；owner scope 来自可信 `RequestContext.identityContext`，agent scope 来自可信 `RequestContext.agentId`。
- 工具只产生 capability result、memory record side effect、安全 capability/gateway/observability facts 和后续模型可消费的 tool result；不产生用户管理 API、Web 页面、后台 job 或新的 runtime 状态机。
- 工具只消费 `add-ts-memory-core` 的目标契约，通过 `store` 委托调用；如果 memory core 未提供某个行为，工具不得在本 change 中私自定义竞争性实现。

黑盒效果是：模型能够搜索 L1 记忆候选（包含按 purpose 过滤当前用户特征）、受限批量读取 L2 详情，以及新增当前用户记忆；失败时返回明确 SafeError，不静默截断、不静默丢弃、不泄露跨 owner 信息。更新、删除、维护和用户管理仍由 memory core/maintenance/user-facing 边界保留，不作为首版 model-facing tools 暴露。

核心业务实现逻辑保持一条线：

```text
model tool call
  -> capability invocation (only after dynamic exposure gate)
  -> existing JSON Schema validation (metadata.inputSchema with additionalProperties=false)
  -> inject tenantId / subjectId / agentId
  -> check budget / timeout / cancellation
  -> call memory tool definition from agent-memory provider
  -> use app-composed LongTermMemoryToolPort backed by selected gateway store/retriever
  -> project L1 / L2 / write outcome
  -> record capability/gateway/observability fact
  -> return capability result to next model turn
```

## 本版本取舍（Version Scope）

本版本要求来自 `nextagent-ts-requirements-v2.md` 的长期记忆最小边界和按需用户上下文检索目标：长期记忆必须能够被检索、引用、更新和遗忘，并保持 owner 隔离；用户画像和相关记忆必须按当前请求需要显式检索，不能默认注入模型输入。

因此本 change 只继承既有长期记忆能力中与模型工具黑盒效果直接相关的行为：

- 继承：显式工具调用、L1/L2 渐进披露、owner scope 隔离、写入副作用、`search_memory` 上的 purpose-scoped `USER_CHARACTERISTICS` 检索、安全观测和可观察降级。
- 不继承：REST/Web 管理入口、分享/publish/fork、后台 aging/curator/dreaming、自动恢复归档条目、存储引擎、FTS/embedding 实现、混合排序公式和配置 namespace。
- 收敛：`get_memory_detail` 支持受限批量 `longTermMemoryIds[]`（上限 20）并逐条返回结果；`add_memory` 是请求执行期 fast path，只处理用户明确要求立即记住的知识并写入 ACTIVE 记忆；相似检测、冲突消歧、证据融合和 confidence corroboration 全部由 dreaming / extraction 后台路径拥有；审计/观测事件写入失败不扩展工具业务结果状态机。

该取舍让工具层保持最小职责：验证输入、注入可信 owner scope 和 agent scope、检查预算/取消/超时、通过 app composition 提供的 tool port 委托到 selected gateway store/retriever、投影安全结果并产生 capability/gateway/observability facts。

发布取舍同样遵循该边界：如果 `add-ts-memory-core` 启动时不可用、`MemoryConfig` 为 `DISABLED` 或 `INVALID`、当前 AgentAssembly 未启用 memory tools，memory tools 不得注册到模型可见工具列表；如果预计算 binding 在运行期遇到 memory core 不可用或 disabled 快照，工具必须返回显式 unavailable/disabled SafeError 或按本 spec 定义的受控降级，不能落入工具层本地存储或部分实现。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 固化交付依赖和配置开关语义：只有 `add-ts-memory-core` 在目标 release scope 内、`MemoryConfig.status === VALID`、当前 AgentAssembly 选择启用 memory tools，且 app composition 提供有效 selected memory gateway ports / memory tool adapter 时，memory tools 才能暴露；memory tools 随 core 一同交付，但不得先于 core 或脱离 core 独立交付。
- 提供 3 个通过统一 capability tool 通道暴露的长期记忆工具：`search_memory`、`get_memory_detail`、`add_memory`。
- 固化工具触发阶段：只能由模型执行过程在 capability invocation 阶段同步调用，不由后台 job、context assembly 或 request acceptance 自动触发。
- 固化 scope 安全边界：工具输入不得接受 `tenantId`、`subjectId`、`agentId`、owner 或等价字段；实际 owner scope 来自 `RequestContext.identityContext`，agent scope 来自 `RequestContext.agentId`。
- 固化 L1/L2 渐进披露：搜索和用户上下文返回 L1；详情工具返回 L2。
- 固化写入和用户特征检索审计的可验证结果和失败语义；`update_memory`、`forget_memory` 不作为 model-facing tools 暴露。
- 固化 `category` 与写入触发语义正交：`FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS` 只描述知识类型；是否允许立即生效只由用户是否明确要求记住决定。
- 保证 memory disabled、依赖缺失、预算不足、存储不可用、权限不匹配时都有显式 SafeError、空结果或可观察诊断。

**非目标：**

- 不提供可脱离 `add-ts-memory-core` 独立交付、独立启用或独立运行的 memory tools。
- 不定义长期记忆核心 DTO、存储端口、检索端口或混合排序公式。
- 不定义自动提取、后台学习、aging、promotion、curation 或 dreaming。
- 不定义 REST API、Web UI、用户维护入口、共享协作、publish/fork 或团队/全局可见性。
- 不定义配置 namespace、provider 选择、存储 schema、FTS 实现或 embedding 实现。
- 不修改 context assembly、system prompt 组装或 request terminal commit 语义。

## 设计决策（Decisions）

### 决策 1：工具调用只走 capability invocation

选定路径：3 个 memory tools 作为标准 capability tool descriptors 暴露，tool definitions/provider 位于 `agent-memory` 的 memory tools submodule（例如 `createMemoryToolDefinitions()`），并由 `agent-app` 在 exposure gate 通过后作为 app-composed tool catalog 传入 `agent-capability`。该 catalog/executor 接入点必须是通用 Tool 能力：它接收 provider-scoped `ToolDefinition[]`，复用既有 Tool SPI、JSON Schema validation 和 capability invocation；`agent-capability` 不导入 `agent-memory` 或 memory DTO。模型在执行过程中显式调用这些工具；runtime/core 按既有模型工具调用流程进入 capability invocation，工具执行完成后结果作为 assistant/tool result 进入后续模型轮次。

本决策对 implementation package dependency rule 做一个受限 refinement：`agent-memory` 的 memory tools submodule 可以通过 `@nextagent/agent-capability` public package export 进行 type-only import，只导入 Tool SPI 类型（例如 `ToolDefinition`、`ToolExecuteOptions` 等）来声明标准 tool definitions。该授权不允许导入 `agent-capability` 的 catalog、discovery、executor、builtin tool definitions、private source path 或任何 memory-specific 分支；`agent-capability` 也不得反向导入 `agent-memory`、memory DTO 或 memory gateway ports。实现阶段必须同步更新模块文档和 architecture/dependency boundary tests，使该例外可见、可测、不可扩散。

放弃路径：
- 不在 context assembly 中自动注入长期记忆，避免绕过模型显式决策和 purpose/audit 边界。
- 不把长期记忆管理做成 REST/Web 管理入口，本 change 聚焦模型驱动工具。
- 不由后台 job 调用这些工具；后台学习和维护通过后续 memory lifecycle change 直接消费 memory core 端口。
- 不把 memory tools 实现在 `agent-capability` 核心或默认 enabled builtin 工具集合中，避免 capability package 知道 memory 业务依赖，也避免绕过 AgentAssembly opt-in。
- 不让其他 package 把 memory tools、`LongTermMemoryToolPort` 或 capability executor 当成长期记忆 service API；非模型消费者必须通过 gateway public ports 或 owning-change application service boundary 访问记忆能力。

### 决策 1A：工具定义静态存在，模型可见暴露动态受控

选定路径：memory tool provider 可以在 `agent-memory` package 中静态存在，表示 memory boundary 提供这 3 个工具的 schema、metadata 和执行入口 factory；但 provider 存在不等于模型可见注册。模型可见 descriptor、effective capability catalog 暴露和 executable dependency 必须同时满足四个 gate：

1. 目标 release scope 包含 `add-ts-memory-core` 和 `add-ts-memory-tools`。
2. `add-ts-memory-configuration` 已在 app composition ready 前冻结 `MemoryConfig`，且状态为 `VALID`。若源配置省略 `nextAgent.memory.enabled`，默认值由 configuration change 定义；tools change 不重新定义默认值。
3. 当前 AgentAssembly 显式选择启用 memory tools。
4. app composition 创建有效的 memory tool adapter：`agent-app` 调用 `agent-memory` 暴露的 `createMemoryToolDefinitions()`，memory tool implementation 通过闭包捕获 `LongTermMemoryToolPort`；`agent-app` 将这些 definitions 挂到稳定 `providerId="memory-tools"` 的非默认 builtin app-composed memory tool provider/catalog，并只通过显式 AgentAssembly binding 进入 effective catalog；安全日志、metric、audit 投影和 diagnostics 只通过现有 capability invocation / observability 路径产生，不作为 memory tool adapter dependency 注入，且 adapter 背后是 selected memory core public boundary。

`MemoryConfig` 为 `DISABLED` / `INVALID`、AgentAssembly 未 opt-in 或 selected gateway ports / memory tool adapter 缺失时，memory tools 不得进入模型可见 tool discovery、effective capability catalog 或可执行调用路径。AgentAssembly 的原始 `capabilityBindings` 只是 agent.yaml / Agent definition 的静态 opt-in 信号，不由 memory config 动态改写。实现可以保留内部诊断状态，但该诊断不得让模型看到 memory tool descriptor。只有已经暴露后的 stale/precomputed binding、运行期 adapter loss 或 disabled 快照被调用，才进入 SafeError/受控降级路径。

AgentAssembly 的 opt-in 形态固定为已有 capability binding 语义：每个 memory tool 使用自身 `capabilityId`（`search_memory`、`get_memory_detail`、`add_memory`）、`capabilityType="TOOL"`、`providerId="memory-tools"` 和 `enabled=true`。`providerId="memory-tools"` 不得被实现为 memory backend provider selector，也不得承载 gateway adapter 配置。

本 change 不扩展当前 `agent-capability` 的公共 `ToolDependencies` / `ToolDependencyName` SPI。当前 SPI 只允许既有 dependency 名称；memory tool 所需的 memory 访问由 `agent-app` 调用 `agent-memory` 的 tool provider factory 时以闭包或 factory config 方式注入。也就是说，`longTermMemory` 不是 `ToolDependencies` 的新增字段，不得出现在 `requiredDependencies` 中；memory tool adapter 只捕获最小 `LongTermMemoryToolPort`。本 change 不为 memory tools 新增任何独立 observability adapter dependency；安全日志、metric、audit 投影和 diagnostics 只复用现有 capability invocation / observability 路径。

当前代码适配约束：`ToolCatalogConfig` 只能配置已知工具，不能新增工具；当前 builtin tool catalog 使用 `builtinToolDefinitions` 且 builtin provider 是默认 enabled。因此实现时不得把 memory tool definitions 追加到默认 `builtinToolDefinitions` 后依赖 `UNAVAILABLE` descriptor 或描述覆盖来表达关闭。若当前 `createCapabilitySubsystem()` 没有 app-composed tool catalog 输入，本 change 应在 `agent-capability` 中补一个通用 provider-scoped tool catalog / provider-parameterized executor 接入点，由 `agent-app` 传入 memory tool definitions；该通用接入点不得出现 memory-specific 分支、memory-specific dependency name 或 `agent-memory` import。

放弃路径：
- 不把 memory tools 简单追加到默认 enabled builtin tool 集合后依靠 `UNAVAILABLE` descriptor 表达配置关闭状态；`MemoryConfig` 为 `DISABLED` 或 `INVALID` 时模型工具列表应完全没有 memory tools。
- 不用 runtime、context engine 或 web channel 参与 memory tool 注册；动态暴露由 app composition、AgentAssembly 和 capability catalog 边界共同完成。
- 不新增一套独立 memory tool provider 配置语言；首版只表达显式启用/未启用和 adapter readiness gate。
- 不让 memory tool implementation、executor 或 capability catalog 读取 `agent.yaml`；只有 app composition 可以把已校验 Agent definition 投影为 trusted app-composed Tool catalog config。
- 不修改 `ToolDependencies`、`ToolDependencyName`、`BuiltinToolsExecutor` 或 `allowedDependencyNames` 来承载 memory 依赖；memory tools 的启用/禁用应通过 app composition 的 provider/definition 注册选择完成。
- 不新增 `MemoryToolRegistry`、`MemoryToolExecutor` 或 memory-specific discovery/invocation path；注册、发现、调用仍完全复用 `agent-capability`。

`add-ts-memory-configuration` 还可从已验证、已绑定的 `capabilityBindings[].description` 生成 trusted `ToolCatalogConfig.safeDescriptionOverride`。Memory tools 只消费该 trusted catalog 投影作为 CapabilityDescriptor 描述覆盖；它不得参与 exposure gate，也不得改变 provider identity、capability enablement、schema、scope、权限或执行语义。

因此 memory tools 不新增自己的产品配置文件或 description 配置入口。用户定制描述只属于 `agent.yaml` / Agent definition 的 capability binding；tools change 只声明如何消费 configuration change 已经生成的 trusted `ToolCatalogConfig.safeDescriptionOverride`。当 `MemoryConfig.status` 为 `DISABLED` 或 `INVALID` 时，该 description override 即使存在也不得导致 memory tools 进入模型可见列表；disabled/invalid 的不可见 gate 优先于任何描述覆盖。

### 决策 2：工具层不拥有存储和排序算法

选定路径：工具只验证输入、注入 scope、通过 app-composed tool port 委托到 selected gateway store/retriever，并把返回结果映射为 capability result。搜索排序、L1/L2 disclosure、accessCount 副作用和状态变更以 `add-ts-memory-core` 的语义为准；`agent-capability` 不直接导入 memory gateway ports、adapter-private store 或 `agent-memory` implementation。`agent-memory` 的 memory tools submodule 只允许通过 public package export type-only 导入 `agent-capability` 的 Tool SPI 类型来返回 standard tool definitions，不拥有 catalog、discovery、executor 行为。

放弃路径：
- 不在工具实现中重新实现搜索排序、相似检测、冲突检测、候选融合或 confidence corroboration；这些重逻辑由 dreaming / extraction 后台路径负责，不进入请求执行期工具调用。
- 不让 capability package 直接访问 adapter-private store、索引或数据库。
- 不让 `agent-memory` extraction/aging/maintenance 编排、context、runtime、channel 或 gateway adapter 反向调用 `LongTermMemoryToolPort`；这些模块应直接消费 gateway public ports 或自身 owning boundary。`agent-memory` 中由本 change 拥有的 memory tools provider/factory 只在 `agent-app` composition 为模型工具暴露时接收该 port，不作为内部服务 API。

### 决策 3：`get_memory_detail` 支持受限批量详情

选定路径：`get_memory_detail` 输入为 `longTermMemoryIds[]`，上限 20，返回 `{results: [{longTermMemoryId, entry?, error?}]}`。每条独立执行 owner-scoped L2 lookup；not found、not owned 和不可披露统一映射为 per-entry SafeError。

放弃路径：
- 不使用单条返回 + 整体失败。批量中单条失败不影响其他条目返回。
- 不限制 batch 上限为 1 条；上限 20 平衡结果大小预算和调用效率。

### 决策 4：更新和遗忘接口保留在 memory core/maintenance，不作为首版模型工具

选定路径：首版 model-facing tools 不暴露 `update_memory` 和 `forget_memory`。底层长期记忆接口仍保留 `saveLongTermMemory` 的 scoped partial update、`deleteLongTermMemory` 的 physical delete 以及后续 maintenance/user-management 所需的生命周期能力；这些能力由 memory core、maintenance、用户管理或独立 change 消费，而不是由模型直接调用。

放弃路径：
- 不让模型直接 patch 记忆条目，避免模型在证据不足时修改长期事实。
- 不让模型直接删除记忆条目，避免把用户维护/遗忘治理混入工具层。
- 不删除 `add-ts-memory-core` 的 update/delete port 能力；本 change 只减少模型可见工具面。

### 决策 6：观测/审计投影失败不扩展工具业务结果状态机

选定路径：memory tool 在成功产生 memory side effect 后，capability result 表达 memory outcome；capability invocation、gateway 或后续 owning observability path 产生的安全观测/审计投影若失败，进入现有 observability failure channel，并通过结构化日志或 metric 暴露，不把 `auditStatus` 作为所有工具的业务 result 字段。memory tool adapter 不接收独立 `auditWriter`、`diagnosticSink` 或 observability dependency。

放弃路径：
- 不让 capability executor 输出 audit linkage、持久化 audit id 或审计子状态机。
- 不因为观测/审计 sink 的后置失败把已经成功的 memory side effect 报告为未发生。

### 决策 5：用户上下文检索合并到 `search_memory`

选定路径：不单独暴露 `get_user_context`。`search_memory` 在 `categoryFilter="USER_CHARACTERISTICS"` 时接受 `purpose` 参数，返回 purpose-scoped L1 trait projection。memory disabled/invalid 时遵循统一 exposure gate 和 stale-binding SafeError；无匹配用户特征时返回空 `entries[]`，不视为错误。

放弃路径：
- 不把用户特征写入 system prompt。
- 不允许模型传入用户身份字段。
- 不把敏感 trait value 写入审计事件。
- 不保留 `get_user_context` 的 disabled empty-traits 特例，避免同一能力出现双重降级语义。

### 决策 7：输入校验复用现有 JSON Schema validation

选定路径：memory tools 不扩展公共 `ToolMetadata`，也不修改 `BuiltinToolsExecutor.invoke()` 的输入校验流程。每个 memory tool 的 `inputSchema` MUST 使用 `additionalProperties: false`，只声明模型允许提供的业务参数；`tenantId`、`subjectId`、`agentId`、`ownerSubjectId`、`owner`、`userId` 或等价 scope 字段不得出现在 schema 中。现有 executor 会在工具执行前用 `metadata.inputSchema` 统一校验输入，含 owner/agent scope 字段的调用自然失败为现有 `CAPABILITY_INPUT_INVALID`。

理由：当前代码基线的 builtin tools 已经通过 `additionalProperties: false` 表达严格输入契约，`BuiltinToolsExecutor` 已统一执行 JSON Schema validation。memory tools 的核心安全目标是“不接受客户端/模型传入 owner/agent scope，scope 只能来自 trusted request context”；该目标由严格 schema 即可满足。为了更细的 memory-specific validation error code 扩展公共 Tool SPI，会扩大 `agent-capability` 契约、`defineTool`、executor 和测试面，不符合 KISS。

放弃路径：
- 不新增 `ToolMetadata.forbiddenInputFields`、`forbiddenFieldErrorCode`、`forbiddenFieldErrorMessage` 或 `inputValidationErrorCode`。
- 不把 `BuiltinToolsExecutor` 改成 memory-aware 或 metadata-driven two-phase validation。
- 不在 executor 中实现 `normalizeInput` hook、`normalizeMemoryToolArguments()`、`ownerFieldNames`、`MEMORY_TOOL_*` 错误码或 memory tool 名称判断。
- 不为 owner field rejection 引入 memory-specific SafeError；schema validation 失败统一返回现有 `CAPABILITY_INPUT_INVALID`。

`add_memory` 对 `USER_CHARACTERISTICS` string content 的容错不进入公共 executor：该工具的 input schema 显式允许 `content` 为 `string | structuredContent`，然后在 `add_memory.execute()` 内把 string 转为结构化 content。这样容错是 memory tool 自身契约的一部分，不扩大公共 Tool SPI。

### 决策 8：`add_memory` 只做显式用户指令的 ACTIVE fast path

选定路径：`add_memory` 不通过相似搜索判断重复或冲突，不写入 candidate/evidence，也不调整已有记忆 confidence。模型只有在当前用户明确要求“记住/以后使用/默认采用/按此偏好”等立即生效的记忆指令时才调用 `add_memory`；工具在校验 category/content/briefIndex/confidence 后通过 `saveLongTermMemory` 创建 ACTIVE `LongTermMemoryRecord`。模型观察、推断、一次性经验、相似但不确定或可能冲突的知识不应通过 `add_memory` 写入；这些信息由 dreaming / extraction 从已持久化 `TaskTrajectory` 中异步提取为 candidate，并在后台做融合或消歧。

理由：`add_memory` 位于端到端请求执行链路，任何相似检索、语义等价判断、冲突分析或 confidence 提升都会直接增加用户可感知时延，并把学习策略放进 model-facing tool。把重逻辑交给 dreaming 可以保持工具 KISS，同时避免未消歧知识污染 `search_memory`。

放弃路径：
- 不在 `add_memory` 中新增 `CANDIDATE`、`PENDING_RECONCILIATION` 或 `searchable=false` 状态。
- 不让 `add_memory` 写入 extraction-owned candidate/evidence 表；tools change 不新增 candidate contract。
- 不因为重复调用 `add_memory` 而提升已有记忆 confidence；confidence corroboration 只由 extraction 在确认独立 evidence 后通过 memory core mutation path 执行。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 工具输入 schema 拒绝 `tenantId`、`subjectId`、`agentId`、owner、workspace path、raw credential 等字段；工具执行只使用可信 `RequestContext.identityContext` 和 `RequestContext.agentId`；未授权详情和不存在统一返回 `LTM_ENTRY_NOT_FOUND`，防止对象存在性泄露；SafeError、日志、metric、audit 或 diagnostic 不包含 raw tool args/result、敏感 trait value 或结构化 content。 | Security tests、contract tests、redaction assertions |
| 性能/容量 | 搜索默认 `limit=20`、最大 `limit=100`；`search_memory(categoryFilter="USER_CHARACTERISTICS", purpose=...)` 返回 purpose-filtered L1 projection；详情读取使用 `longTermMemoryIds[]` 受限批量（上限 20）；所有工具结果必须受 capability result 大小限制，超出时返回 SafeError 或受控 content ref，不得静默截断。 | Contract tests、integration tests、capacity boundary tests |
| 可靠性/恢复 | 工具调用是同步 capability invocation，接受 runtime cancellation/timeout；`add_memory` 只做显式用户指令 fast path，产生 durable ACTIVE memory record 后才返回成功；`MemoryConfig` 为 `DISABLED` / `INVALID` 时工具不暴露；stale binding 或运行期存储不可用返回显式 SafeError。 | Resilience tests、disabled-path tests、timeout/cancel tests |
| 可维护性 | memory tool provider 位于 memory owning boundary，但注册/发现/调用复用 public capability；memory tools 只依赖 app-composed memory tool adapter；不扩展公共 `ToolDependencies` SPI；如需补 capability 接线，只补通用 app-composed Tool catalog/executor，不新增 memory-specific registry/executor/discovery；排序和存储由 selected memory gateway/backend 承载；local backend 的 lifecycle 编排可由 `agent-memory` 承载，remote complete-service backend 由远端长期记忆服务承载；tools 不拥有状态机，不修改 context assembly 或 runtime lifecycle。 | Architecture boundary tests、module dependency checks |
| 可测试性 | 3 个工具均有稳定 input/result schema、错误码和验收样例；memory core 可用测试替身模拟 enabled、disabled、not found、cross-owner、timeout 和 write failure；相似/冲突/融合测试属于 extraction。 | Unit tests、contract tests、integration tests |
| 审计/可追溯性 | memory tool invocation 通过既有 capability invocation / timeline / observability path 可追踪；`add_memory` 和 `search_memory` 用户特征检索的 domain-specific write/search 观测只通过 gateway/observability owning path 或后续 owning change 定义，不通过 memory tool adapter 注入独立 sink；用户特征检索只记录 purpose 和 trait name/ref，不记录 trait value；观测/审计投影失败通过 observability failure channel 暴露，不扩展工具业务结果状态机。 | Observability tests、structured log/metric assertions |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/memory-tools/spec.md` 主承载 3 个工具的可验证行为。
- 跨模块架构：`openspec/designs/architecture/memory.md` 主承载 model-driven memory tool flow、owner scope、audit、capability/runtime/context 边界。
- 领域模型/状态机：`openspec/designs/domain/memory.md` 主承载 memory record 生命周期、physical delete 语义和 tool 写入对记忆事实的影响；更新/遗忘由 core/maintenance/user-management 边界承载。
- API/SPI/event/schema：`openspec/designs/contracts/capability.md` 主承载 tool descriptor、input/result schema 和 SafeError/result 消费语义。
- 模块职责：`openspec/designs/modules/agent-memory.md` 主承载 memory tool provider/factory 及其非职责边界；`openspec/designs/modules/agent-app.md` 主承载 exposure gate 和 adapter composition；`openspec/designs/modules/agent-capability.md` 主承载通用 Tool SPI、catalog/discovery/invocation 职责。
- ADR：`openspec/designs/adr/memory-tools-boundary.md` 主承载“长期记忆访问采用模型工具而非自动注入”的决策。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `memory-tools` 导航。

## 风险与取舍（Risks / Trade-offs）

- [模型过度调用记忆工具] -> 通过 capability visibility、tool description、调用预算、结果大小限制和指标监控约束。
- [用户特征泄露到不合适上下文] -> `search_memory` 的 `USER_CHARACTERISTICS` 检索必须 purpose-filtered，且结果不进入 system prompt；审计不记录 trait value。
- [工具层和 memory-core / extraction 语义重复] -> 工具只定义输入/输出和调用顺序；存储、排序、state 过滤继续由 memory core 承载；相似、冲突、candidate、fusion 和 confidence corroboration 继续由 extraction/dreaming 承载。
- [批量详情结果过大] -> `get_memory_detail` 限制 `longTermMemoryIds[]` 上限为 20，并通过 capability result size budget 返回显式 `MEMORY_TOOL_RESULT_TOO_LARGE`，不得静默截断。

## KISS 审视（KISS Review）

当前设计满足 KISS 的核心要求：一个入口、一个调用阶段、一组最小工具、一个 scope 来源、一个 memory core 依赖边界。为了避免工具层膨胀，本设计只支持受限批量详情，不定义自动注入，不新增 REST/UI/后台调度。

仍需保持两个 KISS 约束：`longTermMemoryId` 安全性通过 owner-scoped lookup 和 not-found 合并错误保证，而不是要求工具层实现复杂 ref provenance；`search_memory` 的 purpose 过滤只定义目标语义和安全投影，不在本 change 内定义新的个性化规则引擎。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/memory-tools/spec.md`：提炼 3 个工具的稳定行为契约和验收样例。
- `openspec/overview.md`：提炼长期记忆工具的目标、范围和用户价值。
- `openspec/designs/architecture/memory.md`：提炼 memory tool flow、owner scope、安全降级、audit 和上下游关系。
- `openspec/designs/domain/memory.md`：提炼 tool 对 memory record 生命周期的影响。
- `openspec/designs/contracts/capability.md`：提炼 tool descriptor、schema、SafeError 和 result 消费语义。
- `openspec/designs/modules/agent-memory.md`：提炼 memory tool provider/factory、local backend 后续 lifecycle 编排与 memory tools 的非职责关系，并记录 remote complete-service backend 下由远端服务拥有长期记忆业务生命周期。
- `openspec/designs/modules/agent-app.md`：提炼 app composition 如何按 gate 创建 memory tool adapter，并把 `agent-memory` provider 返回的 standard tool definitions 作为 app-composed tool catalog 传入 capability subsystem。
- `openspec/designs/modules/agent-capability.md`：提炼通用 Tool SPI、catalog/discovery/invocation 职责；memory tools 不扩展公共 ToolDependencies；如需新增接线点，只新增 provider-scoped app-composed Tool catalog/executor 能力，不新增 memory-specific 分支。
- `openspec/designs/adr/memory-tools-boundary.md`：提炼模型工具边界决策。
- `openspec/designs/spec-to-design-map.md`：补充导航。

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|------|------|---------|
| 3 个工具必须通过 capability invocation 调用 | T1.1 | `packages/agent-memory/tests/memory-tools-provider.test.ts` + integration tests 验证 provider 返回 standard tool definitions 并经 capability invocation 执行 |
| 工具实现不直接访问 adapter-private store | T2.1 | Architecture 测试验证边界隔离 |
| get_memory_detail 支持 `longTermMemoryIds[]` 受限批量详情（上限 20） | T2.3 / T7.1 | Contract 测试验证输入参数校验、批量成功、部分 not found 和上限拒绝 |
| update/delete 底层接口不作为 model-facing tools 暴露 | T6.1 | Capability descriptor/architecture tests |
| 所有工具必须验证 owner scope | T5.1 | Security 测试验证 owner scope 隔离 |
| 搜索结果按 L1/L2 disclosure 分级返回 | T6.1 | Integration 测试验证 disclosure 分级 |
| 工具执行失败返回结构化错误 | T7.1 | Contract 测试验证错误响应格式 |
| 工具调用生成安全 capability/gateway/observability fact | T8.1 | Observability 测试验证 projection 覆盖 |
| 工具不拥有排序算法，委托 store | T9.1 | Unit 测试验证委托调用 |
| accessCount 副作用由 memory core gateway 管理 | T10.1 | core gateway-local/contract tests |
| memory tools 不扩展公共 ToolDependencies SPI | T9.2 | Source/architecture tests 验证没有新增 memory dependency names，memory adapter 只由 app composition 调用 `agent-memory` factory 时捕获 |
| `agent-memory` 只获得受限 Tool SPI 类型依赖授权 | T6.2 / T6.8 | Dependency boundary tests 验证 memory tools submodule 仅 type-only 导入 `agent-capability` public Tool SPI 类型，模块文档记录该受限 refinement |

## 待确认问题（Open Questions）

- `update_memory` / `forget_memory` 不作为首版 model-facing tools；如未来需要模型直接更新或遗忘，必须通过独立 refinement 明确用户意图、安全 observability/audit projection 和误操作恢复边界。
- `search_memory` 的 `USER_CHARACTERISTICS` purpose 过滤首版只要求安全、可审计、L1 投影；具体过滤表或策略模板应由后续配置/策略 change 定义，不能在本 change 内扩展为规则引擎。
