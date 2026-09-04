## 背景和现状（Context）

`add-ts-memory-core` 负责定义长期记忆的 disabled 语义、owner scope、核心 DTO/port 和检索边界。当前缺口不是 memory 行为，而是配置入口：如何在应用 ready 前校验并冻结 memory 配置，如何让 memory gateway ports、capability descriptor 和后续显式接入的 consumers 消费同一份快照或窄投影，如何安全解析 Agent 级 memory 资源覆盖。

前置约束如下：

- `establish-ts-backend-architecture` 要求配置文件、环境变量和其他不可信数据必须 runtime schema validation；最新 `add-ts-memory-core` 进一步要求 core local store/retriever 由 gateway-local 直接实现并由 app composition 注入，后续 local memory 编排才可能进入 `agent-memory`；Context Engine 不拥有 memory extraction、promotion、curation 或 storage behavior。
- `establish-ts-core-contracts` 和 `app-config-schema` 要求 foundation 类型归 `agent-common`，完整 `DefaultSystemConfig` 留在 `agent-app` 内部，下游只能消费窄投影、public contract 或注入依赖；owner scope 由 `tenantId` + `subjectId` 组成（来自 `IdentityContext`），agent scope 由 `agentId` 组成（来自 `RequestContext.agentId` 或 `hostedAgentId`），配置不得覆盖任一 scope 字段。
- `add-ts-memory-core` 必须定义 memory disabled 的 `LTM_DISABLED` 行为、owner scope、核心 memory DTO/port 和检索语义。本 change 不修改这些核心契约。

相关方包括 Memory/Learning owner、App composition owner、Capability owner、Context owner、Observability owner 和后续实现 memory consumers 的团队。

一致性审视结论：

- 本 change 与架构/契约基线一致：配置由 app composition 加载和冻结，通过窄消费投影、gateway/capability 注入或 public owning contract 传递给 memory consumers；memory consumers 不直接读取源配置，也不接收完整 `DefaultSystemConfig`。
- 与 roadmap/release scope 一致的前提：本 change 当前保持规格准备状态。只有 `add-ts-memory-core` 已在当前代码基线实施并验证，且 release scope 明确纳入 memory configuration 后，本 change 才可进入代码实施。归档顺序按 OpenSpec release 流程处理，不作为跳过当前源码/测试核验的依据。其他 memory change（extraction、aging、maintenance、sharing）若通过各自 spec delta 定义配置字段，本 change 的命名空间扩展规则需承认这些字段。
- 本 change 不提前定义尚未进入实施范围的 memory 业务字段。extraction、aging、maintenance 字段由各自 change 定义后，才能在本 change 的 `MemoryConfig` 快照中汇总；sharing 配置仍由 sharing change 自身承载，除非后续 spec delta 明确纳入全局配置快照。
- 本 change 不把 hybrid ranking 权重纳入可配置项，避免与 memory core 的排序公式产生行为冲突。后续若需要可配置 ranking 权重，必须另起 refinement 并同步修改 memory core 行为。

## 第一性原理与业务边界（First Principles / Business Boundary）

第一性原理：长期记忆配置不是长期记忆行为本身，而是让 memory 相关能力在进入运行时前获得同一份可信、可校验、可诊断的参数快照。配置必须先被验证和冻结，再以窄投影形式被 memory gateway ports、capability catalog 和后续显式接入的 memory consumers 消费；配置不能重新定义身份、owner scope、runtime lifecycle、memory record、存储实现、后台任务、aging/maintenance/sharing 策略或 capability 权限。

业务边界固定为“长期记忆配置入口和资源覆盖解析”：

- 对部署者暴露 `nextAgent.memory.*` 配置命名空间。
- 对运行时内部暴露冻结后的 `MemoryConfig` 和资源覆盖解析结果。
- 对运维和测试暴露脱敏配置诊断。
- 只决定配置是否有效、memory 是否被有意禁用、search 默认参数是什么、覆盖资源是否可用。
- 配置物理形态固定为 `default-system.yaml` 或 application overlay 中的 `nextAgent.memory` group；后置 extraction/aging 等 memory 子能力只能作为 `nextAgent.memory.<subsystem>` 子组由 owning change 注册，不作为 `nextAgent.extraction`、`nextAgent.aging` 或独立运行时配置文件出现。
- 不决定何时检索、何时写入、如何提取、如何 aging、如何维护、如何共享、如何排序、如何授权或如何持久化。

黑盒效果：

- 使用默认配置启动时，系统得到一份 `DISABLED` 的 `MemoryConfig`；memory 默认不可用，后续 app-composed selected memory port / core consumer boundary 调用按 disabled 契约返回稳定结果。
- 设置 `nextAgent.memory.enabled=true` 时，系统得到 `VALID` 快照，search 默认值稳定。
- 配置值非法或出现未定义 memory 字段时，系统在 ready 前失败或向 consumers 暴露明确 unavailable/不生效诊断，不把非法值悄悄替换成默认值。
- `capabilityBindings[].description` 缺失时使用内置描述；binding description 非字符串、无法匹配已注册 memory capability 或已解析资源引用非法时拒绝该覆盖/引用并产生安全诊断。
- 用户请求、模型输出、capability 参数和客户端 metadata 都不能改变 memory 配置快照。

核心业务实现逻辑：

```text
app configuration source
  -> extend existing app-private RawDefaultSystemConfig/defaultSystemSchema with nextAgent.memory sibling group
  -> validate defined nextAgent.memory.* schema
  -> reject owner/identity override fields
  -> reject or mark undefined memory fields as inactive
  -> normalize defaults
  -> validate capabilityBindings[].description as safe override fact
  -> derive trusted ToolCatalogConfig description overrides; prompt refs stay in the existing Agent prompt path
  -> freeze MemoryConfig + override diagnostics
  -> expose snapshot or narrow projections to memory gateway/capability consumers
  -> emit safe logs/metrics/diagnostics
```

KISS 审视：本设计保持一个命名空间、一个快照、一个校验入口，并复用已有 capability binding 与 Tool catalog 的描述投影通道。它不引入热更新、per-tenant 配置、配置中心、数据库配置表、ranking 调参、独立 scheduler、单独的 description section 或 memory 行为实现；仅汇总已由对应 memory change 明确定义并获准进入实施范围的字段。因此复杂度被控制在“配置边界”本身。

唯一可实施路径：

```text
app composition loads app config
  -> app config schema accepts nextAgent.system? and nextAgent.memory? as sibling groups
  -> app config schema accepts only defined nextAgent.memory.* fields
  -> validate values and reject owner/scope override fields
  -> agent assembly validates capabilityBindings[].description as safe text for bound memory capabilities
  -> freeze MemoryConfig narrow projection
  -> derive trusted ToolCatalogConfig description overrides
  -> leave prompt template selection to the shared prompt registry / assembler
  -> inject MemoryConfig / narrow projections into memory gateway/core consumers and capability catalog
```

禁止的平行路径：memory consumers 直接读取 env/config；`agent-memory` 重新解析源配置；runtime/core/context/channel 解释或改写 `capabilityBindings[].description`；binding description 改变授权、schema、scope、provider 或执行语义；runtime/context/channel 持有 memory config；gateway-local 通过配置暴露 driver、index 或 table 细节。

当前代码适配约束：实现时必须修改现有 `agent-app` 私有配置边界，而不是新增 memory 专用配置加载器。`RawDefaultSystemConfig.nextAgent` 当前已有 `system.capability-providers` group；本 change 只能把 `memory` 作为 sibling group 加入该 namespace，并保持 `nextAgent.system` 与 `nextAgent.memory` 均为可选 group。缺失 `nextAgent`、缺失 `nextAgent.memory` 或显式 `nextAgent.memory.enabled=false` 都应生成 `DISABLED` 快照；不得为了表达默认禁用而要求修改内置 `default-system.yaml`。若后置 change 注册 extraction/aging 等字段，schema 只能在 `nextAgent.memory.extraction`、`nextAgent.memory.aging` 等 child group 下接收；`nextAgent.extraction`、`nextAgent.aging` 以及独立 memory 子能力配置文件必须被视为未知入口或非生效入口。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 `nextAgent.memory.*` 外部配置命名空间和 `MemoryConfig` 稳定运行时快照。
- 明确配置加载、校验、冻结、消费和诊断流程。
- 明确全局 memory enabled/disabled 的配置输入，并对齐 memory core 的 disabled 行为。
- 定义 search 默认配置字段、默认值和范围。
- 定义后续 memory 配置字段的扩展规则：必须由对应 change 显式定义。
- 定义 Agent 级 memory 工具描述覆盖：由 `agent.yaml`/Agent definition 的 `capabilityBindings[].description` 表达 safe description override，并由 app composition 投影为 trusted `ToolCatalogConfig.safeDescriptionOverride`，不引入文件路径机制或单独 section。
- 定义 Agent 级 memory 资源覆盖边界：工具描述通过已验证 binding description 到 trusted Tool catalog 的投影覆盖；memory extraction 提示词选择不进入 configuration snapshot，本 change 不定义 `promptTemplateIds`、`memory-extraction-*` 命名或 extraction-specific prompt fallback。
- 明确非法配置、未知字段、描述超长、资源引用无效和资源缺失的失败/降级语义。
- 定义配置诊断的脱敏输出和可观测性。

**非目标：**

- 不定义 memory core DTO、port、state、ranking、storage schema 或 owner scope。
- 不定义 memory tools、extraction、aging、maintenance 或 sharing 的业务行为。
- 不在本 change 中发明 `nextAgent.memory.extraction.*`、`nextAgent.memory.aging.*` 或 `nextAgent.memory.maintenance.*` 行为字段；这些字段必须由对应 change 定义后再汇总进快照。
- 不定义 dreaming、promotion、curator、sharing 的具体配置字段。
- 不定义模型 provider、secret、gateway adapter、channel、Web API 或 session store 配置。
- 不做热更新、per-tenant 配置、per-user 配置、配置中心或数据库配置表。
- 不要求代码层级实现形态，不指定具体配置库、文件解析库或目录扫描实现。
- 不允许资源覆盖改变运行时校验、capability 权限、owner scope 或执行语义。

## 设计决策（Decisions）

### 决策 1：配置由 app composition 加载、校验并冻结

选定路径：app composition 在应用 ready 前加载源配置，使用 runtime schema validation 校验已定义的 `nextAgent.memory.*` 字段，并冻结为 `MemoryConfig`。所有 memory consumers 只能读取该快照或由 app composition 派生的窄投影。

放弃路径：
- 不让 memory、capability、context 或后续 consumers 各自读取 env/配置文件。
- 不支持热更新，避免 request 运行中配置漂移。
- 不把配置状态放进 runtime request lifecycle。

理由：配置是横切输入，但不是业务事实。冻结快照能让本地运行、测试和后续恢复诊断具备确定性。

### 决策 2：默认禁用；非法配置 fail fast / unavailable，不 warn 后默认

选定路径：字段缺失可以使用默认值，其中 `nextAgent.memory.enabled` 缺失默认 `false` 并产生 `DISABLED` 快照；字段存在但非法必须导致 `INVALID` 配置状态，并阻止 memory-enabled 启动或让 memory configuration 对 consumers 表达明确 unavailable。

放弃路径：
- 不对非法值 warn 后替换为默认值。
- 不把非法配置当作 memory disabled。
- 不让不同 consumer 自行决定是否容忍非法配置。

理由：长期记忆涉及持久化和用户长期上下文，默认关闭更符合最小启用面；电信网络智能体需要可审计、可诊断的运行边界。非法配置继续运行会让检索默认值和资源覆盖结果不可解释。

### 决策 3：未定义后置字段不在本 change 中接收

选定路径：本 change 定义 `enabled` 和 search 默认字段，并作为命名空间注册中心。其他 memory change（extraction、aging、maintenance、sharing）若通过各自 change 的 spec delta 在本命名空间下增加配置字段（如 `nextAgent.memory.extraction.*`、`nextAgent.memory.aging.*`、`nextAgent.memory.maintenance.*`），本 change 的 `MemoryConfig` 快照需包含这些已合并字段。字段注册的唯一物理路径是 `nextAgent.memory.<owning-change>.*`；不得把同类字段注册为 `nextAgent.<owning-change>.*` sibling group 或独立配置文件。

放弃路径：
- 不让 consumer 私自解释未定义字段。
- 不在本 change 中提前定义尚未有对应 change spec 的字段。

理由：配置 change 的价值是统一输入边界和命名空间注册中心。已由对应 memory change 明确定义并获准进入实施范围的配置字段，由本 change 负责汇总和校验。

## 依赖边界

- 本 change 依赖 `add-ts-memory-core` 提供 memory enabled/disabled、owner scope、storage failure 和 safe error 的稳定语义。
- 本 change 的独立目标是定义 memory configuration 快照、校验、资源覆盖解析和安全诊断；它不重新定义 memory core、extraction、aging、maintenance 或 sharing 的业务行为。
- 若 extraction 需要 `nextAgent.memory.extraction.*`、LLM strategy path 或后台 job 配置，必须由 `add-ts-memory-extraction` 通过自身 spec delta 增加。

### 决策 4：描述覆盖通过 capabilityBindings 表达并投影到 trusted Tool catalog，提示词引用只走既有解析通道

选定路径：内存工具描述由 `agent.yaml`/Agent definition 的 `capabilityBindings[].description` 表达，并且只在已绑定、已注册的 memory capability 上作为 safe description override fact 生效。app assembly 负责类型校验、长度上限处理和安全诊断；app composition 将该值投影为 trusted `ToolCatalogConfig.safeDescriptionOverride`，再由 capability catalog 在 descriptor 投影时消费。提示词选择复用现有 prompt template registry / assembler；`MEMORY_EXTRACTION` 模板由 `add-ts-memory-extraction` 在自身边界消费，本 configuration change 不定义 `promptTemplateIds`、`memory-extraction-*` 命名规则或 prompt fallback 语义。

产品配置入口固定为已有 Agent definition（通常是 `agent.yaml`）中的 `capabilityBindings[]`。本 change 不新增 `tools.yaml`、`memory-tools.yaml`、`memory.descriptionOverrides` 或独立覆盖文件；`ToolCatalogConfig` 是 app composition 传给 `agent-capability` 的内部可信投影，不是用户直接编辑的产品配置文件。

放弃路径：
- 不使用文件路径覆盖（`agents/{agentId}/tools/memory/`、`agents/{agentId}/memory/`），避免部署者需要理解目录结构。
- 不新增单独的 `memory.descriptionOverrides`、tool override 文件或其他平行配置 section；产品定制入口统一放在对应 capability binding 上。
- 不把 `ToolCatalogConfig` 暴露为产品配置格式；它只承载 app composition 从已校验 Agent definition 派生出的 trusted catalog input。
- 不让 `capabilityBindings[].description` 参与 capability enable/disable、provider identity、权限、schema、scope 或运行时执行决策。
- 不使用独立 JSON 覆盖格式。
- 不新增独立文件加载逻辑；prompt template 解析通道保持通用，extraction 提示词选择语义由 `add-ts-memory-extraction` 通过 `MEMORY_EXTRACTION` purpose 定义。

理由：产品定制是 Agent 级别的工具绑定语义，把文案放在对应 `capabilityBindings` 条目上比单独 section 更直观，也避免 capabilityId/providerId 的重复映射。为保持边界清晰，该字段只作为 safe descriptor override fact 被 app assembly 读取，再投影到既有 trusted Tool catalog 通道；runtime、core、context 和 capability execution 不解释该字段。

### 决策 5：配置只表达参数，不表达 memory 行为实现

选定路径：search 默认 limit/minConfidence 只作为查询默认值；memory core、capability 和后续 consumers 继续拥有各自行为空间。

放弃路径：
- 不在配置 change 中定义物理归档表、scheduler 执行顺序、提取算法、tool 行为、sharing policy 或 storage driver。
- 不把 ranking 权重纳入本 change。

理由：配置 change 的价值是统一输入边界，不是提前实现或改变 memory 子能力。

### 决策 6：配置诊断脱敏且不进入用户请求流

选定路径：配置诊断用于 health、structured log、metric 和测试断言；不产生 stream delta、session message、memory record、learning event、checkpoint、artifact 或 pending input。

放弃路径：
- 不把配置诊断注入模型上下文。
- 不在 SafeError、日志或 metric 中输出 prompt、提取提示词全文、完整 tool schema、未脱敏路径或 secret。

理由：配置诊断属于运维面，不能污染用户对话事实和模型输入。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 配置不得携带 scope 覆盖字段；binding description 只改变工具展示，不改变运行时校验；prompt template 内容和选择结果不进入 configuration snapshot，具体业务解释由 owning change 通过 shared prompt registry 承担。 | Config contract tests、redaction assertions |
| 性能/容量 | 配置加载在启动/装配阶段完成；描述字段遵循通用 Tool 描述上限（当前 builtin Tool catalog 为 512 字符，除非后续 framework change 统一调整）；prompt template 与普通模板共享大小和解析限制；无请求期扫描和无热更新。 | Unit tests 覆盖大小限制；integration tests 验证请求期不重新解析配置 |
| 可靠性/恢复 | 冻结快照使同一进程行为稳定；非法配置 fail fast；memory 默认 disabled 并使用稳定 disabled outcome；trusted override 或资源引用部分失败不会改变 request lifecycle。 | Resilience/config startup tests、disabled-path integration tests |
| 可维护性 | 配置命名空间集中，memory consumers 只消费 `MemoryConfig` 或窄投影；后置字段由后置 change 明确定义；ranking 权重不在本 change 中扩展。 | Architecture boundary checks、code review 检查 no source config parsing in consumers |
| 可测试性 | 默认值、边界、非法值、未知字段、描述未设置/超长、已解析资源引用保留且不解释都可用确定性测试覆盖。 | Unit/contract/integration tests |
| 审计/可追溯性 | 配置状态、覆盖命中和拒绝原因通过 safe diagnostic、structured log 和 metric 可追踪；不要求每次启动写用户审计事件。 | Observability tests、metric/log assertion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `MemoryConfig` 启动期加载、校验、冻结 | T1、T2 | Config contract tests、integration startup test |
| 非法配置不得 warn 后默认 | T2 | Negative contract tests：越界、非法 owner 字段、未知字段 |
| memory 默认 disabled 或显式 disabled 产生稳定 disabled 快照并对齐 core | T3 | Disabled-path integration test |
| 配置字段默认值和范围 | T1、T2 | Unit/contract tests |
| 后置字段不得被本 change 静默接收 | T2 | Unknown-field contract tests |
| capability binding description override 未设置 fallback、已设置生效、超长截断 | T4 | Config contract tests |
| 诊断脱敏 | T6 | Observability/redaction tests |
| consumers 只消费冻结快照，不解析源配置 | T7 | Architecture dependency checks、code review |
| OpenSpec strict validation | T8 | `openspec validate add-ts-memory-configuration --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/memory-configuration/spec.md` 主承载配置命名空间、快照、资源覆盖、失败和诊断行为。
- 跨模块架构：`openspec/designs/architecture/memory.md` 主承载 memory configuration 与 memory gateway ports/capability/后续 consumers 的消费边界。
- 领域模型/状态机：无。配置不拥有 memory record、learning event 或 lifecycle state machine。
- API/SPI/event/schema：`openspec/designs/contracts/configuration.md` 主承载 `MemoryConfig` 窄投影、配置诊断和 override ref 的契约语义；不得把完整 `DefaultSystemConfig` 公开为跨包 contract。
- 模块职责：`openspec/designs/modules/agent-app.md` 主承载配置加载/冻结和 binding description 投影职责；`openspec/designs/modules/agent-memory.md` 仅在后续 local memory 编排实际接入时承载只消费配置快照的职责；`openspec/designs/modules/agent-capability.md` 主承载 trusted Tool catalog description override 消费边界。
- ADR：`openspec/designs/adr/memory-configuration-boundary.md` 主承载非法配置 fail fast、资源缺失 fallback/非法拒绝、无热更新、后置字段不提前定义和 ranking 权重不纳入本 change 的取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 增加 `memory-configuration` 导航。

## 风险与取舍（Risks / Trade-offs）

- [非法配置 fail fast 可能影响宽松部署] -> 通过清晰错误码、字段级诊断和默认值文档降低操作成本；不牺牲可诊断性。
- [描述和提示词覆盖不生效难以定位] -> 通过诊断码区分未设置、截断、语言不支持等场景，让运维能定位问题。
- [不支持热更新降低灵活性] -> 首版换取运行时确定性；后续若需要热更新必须新增 change 定义版本、广播和请求期一致性。
- [不配置 ranking 权重降低调参能力] -> 避免与 memory core 排序契约冲突；后续通过 refinement 统一修改 core 和 configuration。
- [不提前定义尚未获准实施的 memory 字段会让后置 change 多写 delta] -> 这是有意取舍，用少量文档成本换取 KISS 和边界清晰，避免 speculative work。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/memory-configuration/spec.md`：提炼配置命名空间、快照、资源覆盖、失败和诊断契约。
- `openspec/overview.md`：补充 memory configuration 是长期记忆后续能力共享前置边界。
- `openspec/designs/architecture/memory.md`：提炼配置快照消费流、resource override 流、安全和观测边界。
- `openspec/designs/domain/memory.md`：无。
- `openspec/designs/contracts/configuration.md`：提炼 `MemoryConfig` 窄投影、配置诊断状态和 resource override ref。
- `openspec/designs/modules/agent-app.md`：提炼加载、校验、冻结和 ready 前失败职责。
- `openspec/designs/modules/agent-memory.md`：仅在后续 local memory 编排实际接入时提炼只消费快照、不解析源配置的职责；core local store/retriever 不经 `agent-memory` wrapper。
- `openspec/designs/modules/agent-capability.md`：提炼 memory capability 描述覆盖消费边界。
- `openspec/designs/adr/memory-configuration-boundary.md`：提炼关键取舍。
- `openspec/designs/spec-to-design-map.md`：补充导航和验证入口。

## 待确认问题（Open Questions）

无。

