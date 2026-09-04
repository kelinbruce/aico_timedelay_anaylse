## 背景与问题（Why）

`add-ts-memory-core` 负责定义记忆条目、检索端口、写入端口、owner scope 隔离和禁用降级语义；在这些 core 边界落地后，模型执行过程还需要一组受治理的工具入口来主动访问这些记忆，并在用户明确要求时新增记忆。没有该入口时，Agent 无法在请求执行中按需搜索跨会话知识、获取完整记忆内容、显式保存用户要求记住的内容，也无法以隐私受控方式读取当前用户特征。

本变更新增模型可调用的长期记忆工具能力，使记忆访问进入统一 capability tool 通道，并继承 runtime/capability/gateway/audit 的安全和可追溯边界。该能力只定义工具层目标契约，不定义自动提取、后台老化、REST 管理、Web UI、共享协作或配置命名空间。

## 变更范围（What Changes）

- 新增 3 个模型驱动的长期记忆工具：`search_memory`、`get_memory_detail`、`add_memory`。
- 定义每个工具的触发时机、输入前置条件、输出结构、副作用、核心判断顺序、失败和降级行为。
- 规定所有工具通过统一 capability tool 通道暴露和执行，工具调用发生在请求执行期的 capability invocation 阶段。
- 规定 `tenantId` 和 `subjectId` 只能来自可信 `RequestContext.identityContext`，`agentId` 来自可信 `RequestContext.agentId`（与 runtime `hostedAgentId` 对齐），工具输入不得接受 owner、tenant、subject、agent 或等价 scope 字段。
- 规定检索工具使用长期记忆核心的 L1/L2 渐进披露边界；`add_memory` 只作为用户明确记忆指令的请求期 fast path，产生 ACTIVE `LongTermMemoryRecord`。相似检测、冲突消歧、candidate/evidence、sourceTrace 融合和 confidence corroboration 不属于本 change，归 dreaming / extraction 后台路径处理；底层更新和物理删除能力仍由 memory core/maintenance/user-management 边界保留，不作为本 change 的模型工具。
- 规定 `search_memory` 承载用户特征检索：当 `categoryFilter="USER_CHARACTERISTICS"` 时可按 purpose 过滤当前用户特征并返回 L1 projection；返回结果作为 assistant message 的 tool result 消费，不进入 system prompt。
- 明确 `update_memory` 和 `forget_memory` 不作为首版 model-facing tools 暴露；长期记忆底层 `saveLongTermMemory` partial update、`deleteLongTermMemory` physical delete 和后续 maintenance/user-management 接口能力仍由 `add-ts-memory-core`、maintenance 或独立 change 保留和消费。
- 规定 memory tools 采用“memory provider 静态存在、capability 暴露动态受控”模型：`agent-memory` 可以提供 `createMemoryToolDefinitions()` factory，但只有 memory core 在 release scope 内、`add-ts-memory-configuration` 提供 `VALID` 的冻结 `MemoryConfig`、当前 AgentAssembly 选择启用 memory tools 且 app composition 提供有效 selected gateway ports / memory tool adapter 时，`agent-app` 才把该 factory 返回的 standard tool definitions 作为 `providerId="memory-tools"` 的 app-composed tool catalog 交给 capability subsystem。该 provider identity 只标识模型可见工具 catalog，不选择 memory backend；backend 由 app composition 选择后通过 `LongTermMemoryToolPort` 注入。该接线点必须是通用 Tool catalog/executor 能力，不是 memory-specific registry；memory tools 不得被追加进默认 enabled builtin tool 集合。
- 明确受限依赖授权：本 change 允许 `agent-memory` 的 memory tools submodule 通过 `agent-capability` 的 public package export type-only 导入 Tool SPI 类型，用于返回标准 `ToolDefinition`；不得导入 `agent-capability` 的 catalog、discovery、executor、builtin tool definitions、private source path 或任何 capability implementation helper。该授权必须在 `agent-memory` / `agent-capability` 模块文档和 dependency boundary tests 中记录。
- 规定 `MemoryConfig` 为 `DISABLED` 或 `INVALID` 时不得暴露 memory tools；查询失败、写入失败、权限不匹配、预算不足、运行期依赖丢失和 stale binding 调用时有可观察降级语义。
- 不包含 BREAKING 变更；本变更依赖 `add-ts-memory-core`，不修改 core change 所定义的 memory contract，仅新增上述针对 Tool SPI 类型的受限 package dependency refinement。
- 明确交付边界：`add-ts-memory-tools` 不能脱离 `add-ts-memory-core` 独立启用、发布或声明独立交付；只有 `add-ts-memory-core` 在当前代码基线落地并纳入目标 release scope 后，本变更才能随 core 一同交付。
- 保持 KISS：本变更的业务边界是“模型可调用的长期记忆受控访问层”，不是长期记忆子系统本身；工具层不得重新实现存储、排序、生命周期调度或用户管理能力。

## Capability 影响（Capabilities）

### 新增 Capability

- `memory-tools`: 定义模型通过 capability tool 通道按需搜索、读取长期记忆，并在用户明确要求时新增长期记忆，以及按用途读取当前用户特征的行为契约。

### 修改的 Capability

无。

## 影响范围（Impact）

- Capability：复用现有 Tool SPI、catalog、discovery、executor、JSON Schema validation 和 capability invocation；不在 `agent-capability` 核心或通用 builtin 工具集合中实现 memory 业务工具，不新增 `ToolMetadata`、`ToolDependencies`、executor branch 或 memory-specific discovery/invocation path。若当前 capability subsystem 尚不能接收 app-composed `ToolDefinition[]`，本 change 只能增加一个通用 app-composed Tool catalog/executor 接入点，由 `agent-app` 传入 provider-scoped tool definitions；memory tools 的稳定 provider identity 为 `memory-tools`，AgentAssembly opt-in binding 引用该 provider identity。`agent-capability` 仍不得导入 `agent-memory` 或 memory DTO。若 `add-ts-memory-configuration` 从已绑定 memory capability 的 `capabilityBindings[].description` 投影出 trusted `ToolCatalogConfig.safeDescriptionOverride`，capability catalog MAY 使用该值覆盖模型可见描述；该覆盖不得改变工具暴露、输入/输出 schema、scope、权限或执行语义。
- Memory：`agent-memory` 提供 memory tools provider/factory，返回标准 capability tool definitions，并消费 `add-ts-memory-core` 定义的 `LongTermMemoryRecord`、`SearchLongTermMemoryQuery`、`LongTermMemorySearchResult`、`LongTermMemoryDetailResult`、`SaveLongTermMemoryRequest` 和 retrieval/store 语义，不重新定义存储模型。factory 由 `agent-app` composition 注入只供 model-facing memory tools 使用的最小 `LongTermMemoryToolPort`，该 port 只适配 `searchLongTermMemory`、`getLongTermMemoryDetail`、`saveLongTermMemory` 三个工具实际需要的方法，背后由 selected gateway ports 适配而来，不得导入 adapter-private implementation 或 private path。`agent-memory` 对 `agent-capability` 的依赖仅限 memory tools submodule 的 public Tool SPI type-only import，不得扩展到 capability catalog、discovery、executor 或 builtin implementation。`add_memory` 不调用 search/list 做去重，不写 candidate/evidence，不调整已有记忆 confidence；`add-ts-memory-core` 缺失、禁用、无效或不在 release scope 内时不得暴露 memory tools。除模型工具执行路径外，其他模块需要长期记忆能力时必须直接消费 gateway public ports 或 owning-change application service boundary，不得调用 memory tools、`LongTermMemoryToolPort`、tool descriptors 或 capability executor。
- Runtime/Core：不改变 request lifecycle ownership；工具调用仍由模型驱动 loop 在 capability invocation 阶段触发，runtime 只负责既有 capability 调用、取消、超时、timeline 和 terminal commit 边界。
- Context：不修改 context assembly 逻辑；`search_memory(categoryFilter="USER_CHARACTERISTICS", purpose=...)` 的结果作为 assistant/tool result 被后续模型轮次消费，不预加载到 system prompt。
- Audit/Observability：memory tool invocation 必须通过现有 capability invocation / timeline / observability 路径产生安全可观察事实；memory write 和 user-characteristics search 的 domain-specific 审计或指标只能由既有 gateway/observability owning path 或后续 owning change 定义并投影，memory tool adapter 不得注入独立 `auditWriter` / `diagnosticSink` 依赖。所有日志、metric、audit 或 diagnostic 不得包含 raw tool args/result 或敏感 trait value。
- 测试：需要 contract、integration、security、audit、resilience/disabled-path 和 architecture boundary 验证。

## 归档前基线提升计划（Baseline Promotion Plan）

行为契约：
- `openspec/specs/memory-tools/spec.md`：新增 `memory-tools` capability 的稳定行为契约。

长期背景：
- `openspec/overview.md`：补充长期记忆工具作为后置扩展能力的目标和用户价值。

设计视图：
- `openspec/designs/architecture/memory.md`：补充模型驱动 memory tool 调用流程、owner scope、安全降级、audit 和与 context/capability/runtime 的边界。
- `openspec/designs/domain/memory.md`：补充 `LongTermMemoryRecord` 在 tool 写入、更新、遗忘和读取场景中的生命周期语义；不重复定义 core 字段主契约。
- `openspec/designs/contracts/capability.md`：补充 memory tool descriptor、tool input/result、安全错误和 capability result 消费语义。
- `openspec/designs/modules/agent-memory.md`：补充 memory tools provider/factory、local backend 后续业务编排与 memory tools 的非职责关系；memory tools 不以 `agent-memory` 作为 core store/retriever 必经层；记录 `agent-memory` 仅在 memory tools submodule 中 type-only 依赖 `agent-capability` public Tool SPI 类型的受限授权。
- `openspec/designs/modules/agent-app.md`：补充 app composition 如何把 selected memory gateway store/retriever 适配为 memory tool adapter，并在 gate 通过后把 `agent-memory` provider 返回的 standard tool definitions 传入 capability subsystem；不得扩展公共 `ToolDependencies` SPI。
- `openspec/designs/modules/agent-capability.md`：补充 capability 只拥有通用 Tool SPI、catalog/discovery/invocation；memory 业务 provider 不进入 capability core；记录 `agent-capability` 不反向导入 `agent-memory`、memory DTO 或 memory gateway ports。
- `openspec/designs/adr/memory-tools-boundary.md`：记录将长期记忆访问暴露为模型工具、而非 context 自动注入或 REST 管理入口的长期决策。
- `openspec/designs/spec-to-design-map.md`：新增 `memory-tools` 到相关 architecture/domain/contracts/modules/ADR 的导航。

验证入口：
- Contract tests：3 个工具输入/输出 schema、L1/L2 disclosure、SafeError 语义和 `search_memory` 的 `USER_CHARACTERISTICS` purpose 过滤。
- Integration tests：`MemoryConfig` 为 `VALID` / `DISABLED` / `INVALID` 下的 3 个工具正常、边界和降级行为。
- Security tests：拒绝工具输入中的 owner/tenant/subject 字段，跨租户/跨主体不可见。
- Observability tests：memory tool invocation、`search_memory` 用户特征检索和 `add_memory` 显式用户指令写入产生安全 capability/gateway/observability facts；若启用 audit 投影，审计记录不包含敏感值；projection 失败不得改变工具业务结果。
- Architecture tests：memory tools 不引入 context assembly 修改，不绕过 capability 通道，不让 implementation-private memory provider 泄漏到 core/runtime/channel；`agent-memory` memory tools submodule 只允许 type-only 导入 `agent-capability` public Tool SPI 类型；`agent-capability` 不导入 `agent-memory` 或 memory contracts；除 `agent-app` composition 和 capability invocation 测试外，非模型模块不得依赖 memory tools、`LongTermMemoryToolPort`、tool descriptors 或 capability executor。
