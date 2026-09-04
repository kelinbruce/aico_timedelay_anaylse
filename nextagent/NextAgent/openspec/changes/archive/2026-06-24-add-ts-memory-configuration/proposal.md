## 背景与问题（Why）

长期记忆能力被拆分为多个后续 change。`add-ts-memory-core` 负责定义 memory disabled、owner scope、核心 DTO/port 和检索边界；在这些前置边界落地后，仍需要一个统一的配置入口来表达“长期记忆是否启用、检索默认值如何校验、Agent 级 memory 资源覆盖如何安全解析”。

本变更要解决的是长期记忆配置的权威入口和稳定运行时快照问题。配置属于不可信输入，必须在进入 memory gateway ports、capability descriptor 或后续显式接入的 memory consumers 前完成 runtime schema validation、冻结和安全诊断。配置不得成为第二套 owner scope、runtime lifecycle、storage schema、后台调度、aging policy、maintenance policy 或 capability governance。

当前收敛点：本 change 只定义 memory gateway/core 可直接消费的最小配置字段和 trusted override 安全边界。extraction、aging、maintenance、sharing 等后置能力的具体配置项不在本 change 中定义；后续若需要字段或策略资源引用，必须在对应 change 中通过显式 spec delta 增加。

## 变更范围（What Changes）

- 新增 `nextAgent.memory.*` 外部配置命名空间和对应的 `MemoryConfig` 稳定运行时快照；所有长期记忆运行时配置的物理入口都在 `nextAgent.memory` 下，后置 extraction/aging 字段只能由各自 change 注册为 `nextAgent.memory.extraction.*` / `nextAgent.memory.aging.*` 子组，不得拆成 `nextAgent.extraction`、`nextAgent.aging` 或独立运行时配置文件。
- 定义 memory 配置的启动期加载、runtime schema validation、冻结、消费和安全诊断语义。
- 定义全局 `nextAgent.memory.enabled` 对 app-composed selected memory port / core consumer boundary 的启停输入；默认值为 `false`，禁用后的行为仍由 `add-ts-memory-core` 的 `LTM_DISABLED` 契约承载。
- 定义 search 默认值配置：`default-limit` 和 `min-confidence`，只作为 memory gateway/core 查询默认参数，不改变排序公式或 owner scope。
- 定义 Agent 级 memory 工具描述覆盖：由 `agent.yaml`/Agent definition 的 `capabilityBindings[].description` 表达该 Agent 对已绑定 memory 工具的安全描述覆盖；app assembly 校验、截断并诊断后，由 app composition 投影为 trusted `ToolCatalogConfig.safeDescriptionOverride`，交给 capability catalog 覆盖工具描述文字。未设置则使用内置描述；超出通用 Tool 描述上限时截断并记录诊断。
- 定义 Agent 级 memory 资源覆盖的边界：工具描述覆盖走已验证的 capability binding description 到 trusted Tool catalog 的投影；memory extraction 提示词不通过 configuration snapshot 或 `promptTemplateIds` 绑定，而由现有 prompt template registry / assembler 按 `MEMORY_EXTRACTION` purpose 解析。
- 定义配置错误和 trusted override / resource ref 错误的失败/降级语义：缺少可选 description override 时使用内置描述；非法配置值、非法 trusted override、非法资源引用或 schema 不兼容必须产生明确失败或不可用诊断，不得静默吞错。
- 定义配置诊断状态，供 app composition、memory、capability、observability 和运维检查消费。
- 不定义代码层级实现细节、不指定具体配置库、文件格式解析库、目录扫描实现或 UI。

与前置架构和契约的一致性审视：

- 与 `establish-ts-backend-architecture` 和最新 `add-ts-memory-core` 一致：core local store/retriever 由 gateway-local 直接实现并由 app composition 注入；后续 local memory 编排才可能进入 `agent-memory`。配置由 app composition 加载和冻结，runtime、channel、context、capability 不拥有 memory 行为或源配置解析。
- 与 `establish-ts-core-contracts` 和 `app-config-schema` 一致：`DefaultSystemConfig` 仍留在 `agent-app` 内部；`MemoryConfig` 是 app composition 产出的窄消费投影/owning-boundary contract，不是完整 app config 的跨包公开替身，不新增 owner scope DTO，不允许配置覆盖 `tenantId`/`subjectId`。
- 与 `add-ts-memory-core` 一致：本 change 不修改 memory state、record、port、ranking 或 disabled outcome，只提供 `enabled` 和 search 默认输入。

## 交付状态与前置门禁

本 change 当前保持规格准备状态，不能按已完成或可独立归档处理。`add-ts-memory-core` 的 disabled outcome、core memory contract 和 public configuration consumption boundary 必须先在当前代码基线中真实实施并通过验证后，本 change 才可进入代码实施；归档顺序按 OpenSpec release 流程处理，不作为跳过当前源码/测试核验的依据。

实施前必须满足以下门禁：

- `add-ts-memory-core` 已在当前代码基线完成实施和验证，且 `LTM_DISABLED`、owner scope、核心 DTO/port、gateway-local store/retriever 装配、search query 默认输入语义已经成为可消费 surface。当前代码中 `agent-memory` 空壳和 memory gateway port 缺失时，本 change 只能更新规格，不得实施。
- 当前 release scope 明确纳入 Long-term memory 后置扩展实施，或单独批准启动 memory configuration 实施。
- 本 change 的独立交付含义仅限于：在 memory core 已存在的前提下，新增统一配置快照、配置校验、资源覆盖解析和脱敏诊断；不得与 memory core 或 extraction 捆绑成一个实施交付。
- 本 change 不得为 `add-ts-memory-extraction` 预先定义 `nextAgent.memory.extraction.*` 字段、后台触发、LLM strategy 路径或任何可执行提取行为；这些内容必须由 extraction change 在其自身交付门禁满足后通过 spec delta 定义。

## Capability 影响（Capabilities）

### 新增 Capability
- `memory-configuration`: 定义长期记忆配置命名空间、稳定运行时快照、配置校验、资源覆盖解析、配置诊断和 memory change 的消费边界。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- 配置：在现有 app composition schema 的 `nextAgent` namespace 下新增 `memory` sibling group（与既有 `nextAgent.system` 并列），包括全局启停、检索默认值和已声明覆盖资源规则；`nextAgent.system` 与 `nextAgent.memory` 均为可选 group，缺失 `nextAgent.memory` 默认禁用；后置 memory 子能力的配置物理形态固定为 `nextAgent.memory.<owning-change>.*`，不接受 `nextAgent.extraction.*`、`nextAgent.aging.*` 或与 `memory` 并列的子能力配置块；不定义 extraction、aging、maintenance、sharing 的具体字段。
- 契约：新增 `MemoryConfig`、配置诊断状态、binding description override 投影等配置边界对象。它们描述 app composition 冻结后的窄消费形态，不描述具体实现类，也不暴露完整 `DefaultSystemConfig`。
- Memory：memory gateway-local/core ports、后续 `agent-memory` 编排和显式接入的 memory consumers 只能消费冻结后的 `MemoryConfig` 或 app composition 注入的窄投影，不得各自重新解析源配置。
- Capability：memory capability 描述覆盖通过 `capabilityBindings[].description` 的 safe override fact 投影到 trusted Tool catalog，改变模型可见描述；不得改变 capability 权限、owner scope、runtime validation、input/output schema 或执行语义。
- Observability/Audit：配置加载、非法配置、覆盖资源命中、覆盖资源拒绝和 memory disabled 必须产生脱敏诊断；不得记录 prompt、模型输出、完整工具 schema、credential、token、附件内容、未脱敏路径或高基数字段。
- 测试：需要 contract/config tests 覆盖默认值、边界值、非法值、未知字段、binding description 未设置/已设置/超长、已解析资源引用保留、配置快照消费和配置诊断脱敏。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/memory-configuration/spec.md`：新增长期记忆配置命名空间、稳定快照、资源覆盖、诊断和失败语义。

长期背景：
- `openspec/overview.md`：补充长期记忆配置作为 memory 后续能力共享前置边界的说明。

设计视图：
- `openspec/designs/architecture/memory.md`：提炼 memory configuration 与 gateway-local memory ports/capability/后续 consumers 的跨模块消费边界、安全和可观测流程。
- `openspec/designs/domain/memory.md`：无。配置不定义 memory record 状态机或生命周期事实。
- `openspec/designs/contracts/configuration.md`：提炼 `MemoryConfig` 窄投影、配置诊断状态和 resource override ref 的调用语义；不得把完整 app configuration 公开为跨包 contract。
- `openspec/designs/modules/agent-app.md`：提炼 app composition 加载、校验和冻结配置快照的职责。
- `openspec/designs/modules/agent-memory.md`：仅在后续 local memory 编排实际接入时，提炼 memory package 只消费配置快照、不解析源配置的职责边界；core local store/retriever 仍不经 `agent-memory` wrapper。
- `openspec/designs/modules/agent-capability.md`：提炼 memory capability 描述覆盖对 capability descriptor 的消费边界。
- `openspec/designs/adr/memory-configuration-boundary.md`：记录“非法配置 fail fast / unavailable，而不是 warn 后默认值”和“后置能力字段由后置 change 定义”的长期决策。
- `openspec/designs/spec-to-design-map.md`：补充 `memory-configuration` 到 architecture/contracts/modules/ADR 的导航。

验证入口：
- Config contract tests：默认值、范围、未知字段、必填字段和 owner 字段校验。
- Resource override tests：`capabilityBindings[].description` 未设置→内置、已设置→经 trusted Tool catalog 投影覆盖生效、超长→按通用 Tool 描述上限截断；configuration 不接受、不冻结、不解释 `promptTemplateIds` 或 `memory-extraction-*` 命名。
- Architecture tests：memory consumers 不直接解析源配置、不导入 app-private 配置实现、不绕过 public contract。
- Observability/redaction tests：配置诊断不包含敏感值、raw path、prompt 或完整 schema 内容。

