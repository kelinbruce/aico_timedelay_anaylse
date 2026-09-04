## 背景与问题（Why）

`add-ts-context-history-selection` 已经定义了历史候选集的稳定选择规则，`add-ts-large-content-references` 冻结了 fresh-time offload 与 4 种 model-visible 形态（`INLINE` / `PERSISTED_PREVIEW` / `SPECIALIZED_REF` / `EMPTY_MARKER`），`add-ts-context-compression` 在 `assemble()` 阶段完成 summary compression，`add-ts-traceable-summary-generation` 提供了默认的 `TraceableSummaryGenerationPort` 实现。这些上游契约都已经就位，但 Context Engine 仍缺最后一段：把这些已经稳定的"装配结果"组装成 OpenAI 兼容的 `ChatMessage[]` + `tools[]`，并对 System Prompt 给出可观察的、可诊断的、跨 change 一致的组织规则。

Java 参考实现（`java/modules/agent-context-{spi,engine}`）已经画清目标态：`TelecomSystemPromptBuilder` 拥有**固定的 section taxonomy**（`identity` / `safety_compliance` / `telecom_knowledge` / `skills` / `tooling` / `tool_call_style` / `action_execution` / `diagnostic_methodology` / `execution_bias` / `workspace` / `runtime` / `environment` / `project_context` / `dynamic_context` / `session_context`），模板和 profile 只能 override content，**不能增删改 section 集合或顺序**。变量通过 `TemplateVariableResolver` 的注册表（≥12 个变量，Java 实现 ≥16 个）解析，**不**存在 2 字段白名单。模板解析由 `PromptTemplateLoader` chain（file system + resource）+ 分层 `PromptTemplateProfile` registry（`DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE`）共同完成；`ModelOptions` 由 `ModelOptionsOverride` 在 layer+precedence 顺序上合并，**不**来自 `PromptTemplate.defaultModelOptions`。Token 估算按码点感知（CJK ×1.5、增补面 ×2.0、ASCII ×0.25）。

具体缺口：

1. **SystemPrompt section 集合与顺序没有稳定规则**。核心契约已经冻结 `stableSections` / `dynamicSections`，但 sections 集合、顺序、互相引用规则仍需要收口。
2. **模板自由增删 section、template-fragment 决定顺序**会破坏 prefix cache 稳定性；builder 必须拥有 section 集合。
3. **render 边界混在 SystemPrompt 里**。选中的历史、附件、当前用户输入必须由 render 阶段从既有 assembly 执行坐标和消息引用构造，不能作为 SystemPrompt section。
4. **capability disclosure 单一来源问题**。`enabledCapabilities` 派生出的能力既要在 `skills` SystemPrompt 文本里说，又要在 `RenderedModelInput` 的 `tools[]` 里出现，原设计没说这俩怎么保持一致。
5. **`ModelOptions` 来源未定**。`AppConfiguration.modelProfiles` 里有 model 标识但没 options；prompt shaping 需要给出目标态来源（分层 `ModelOptionsOverride` 合并，不是 `PromptTemplate.defaultModelOptions`）。
6. **变量替换机制未定**。2 字段白名单和注册表是两种完全不同的设计；spec 已要求用注册表 + required/optional 声明，**禁止** 2 字段硬拒绝。
7. **预算/budget 解释不属于本 change**。预算策略解释如需引入，应由 sibling change 定义。

本 change 解决的是"装配后的产物如何被组织成 SystemPrompt + 渲染成 model-consumable input"这一最小闭环。

## 黑盒目标

- `SystemPromptBuilder` 拥有 canonical section 集合、顺序和 stable/dynamic 分类；`PromptMode`（`FULL` / `MINIMAL` / `NONE`）决定 builder 实际发出哪些 section，section 子集和顺序由 builder 决定，不由解析到的模板决定
- 模板和分层 profile 只能通过 `SystemPromptContribution.sectionOverrides` override content，**不能** 引入新 section、删除已有 section、重排 section
- 变量通过 `TemplateVariableResolver` 的注册表（首版 ≥12 个）解析，name 匹配 `[a-zA-Z_][a-zA-Z0-9_]*`；注册表内替换、required 未解析报 fragment render failure、optional 未解析填空、未知变量字面 `{{name}}` 透传；**禁止** 2 字段白名单硬拒绝
- 模板解析由 `PromptTemplateLoader` chain（chain-of-responsibility）+ 分层 `PromptTemplateProfile` registry（`DEFAULT < LANGUAGE < MODEL < AGENT < PURPOSE`）共同完成；**禁止** 固定 5 步链
- `ModelOptions` 来自 base + 每个匹配 profile 的 `ModelOptionsOverride` 在 layer+precedence 顺序上字段级合并；**禁止** 来自 `PromptTemplate.defaultModelOptions`
- capability 披露单一来源：`enabledCapabilities` 既派生 `skills` SystemPrompt section 文本（仅 `SKILL`），也派生 `RenderedModelInput.tools[]`（仅 `TOOL`）；`AGENT` 不进任一目标
- 消息引用、附件引用、当前请求内容不进入 SystemPrompt；render 阶段只使用既有 `ContextAssembly` 执行坐标、`selectedMessageRefs` 和消息/附件边界解析
- diagnostics 写入现有安全观测/audit/timeline 入口；`RenderedModelInput` 是唯一穿越模型边界的对象
- token 估算按码点感知（CJK ×1.5、增补面 ×2.0、ASCII ×0.25），结果仅入 diagnostics
- render 按 `selectedMessageRefs` 批量读取；缺失或不可见的已选消息必须 explicit failure 或 explicit degrade，不静默跳过

## 目标产物：Builder 拥有的 section taxonomy 参考

`SystemPromptBuilder` 的 canonical section 集合、顺序和稳定分类如下（与 Java `TelecomSystemPromptBuilder.SUPPORTED_SECTION_KEYS` / `DEFAULT_SECTION_ORDER` 对齐；具体 hardcoded default content 是 design 选择，可随实现演化）：

| list | sectionId | 描述 |
|---|---|---|
| stable | `identity` | 智能体身份 |
| stable | `safety_compliance` | 安全合规（L1/L2/L3 操作分级、审计、合规标准） |
| stable | `telecom_knowledge` | 电信领域知识（网络分层、设备类型、协议栈、告警分类、诊断方法论） |
| stable | `skills` | 已启用 SKILL 披露（markdown bullet，字符预算内，BUILT_IN 不截断） |
| stable | `tooling` | 工具使用原则 |
| stable | `tool_call_style` | 工具调用叙述风格 |
| stable | `action_execution` | 变更执行策略（变更前置检查、影响评估、变更窗口、回滚） |
| stable | `diagnostic_methodology` | 诊断方法论（告警 → 定位 → 根因 → 修复 → 验证） |
| stable | `execution_bias` | 执行倾向（同一轮次立即开始执行任务） |
| stable | `workspace` | 工作区上下文（timezone、currentDate） |
| dynamic | `runtime` | runtime 信息块（agent / model / shell / python / thinking） |
| dynamic | `environment` | 环境信息块（platform / OS / timezone / date） |
| dynamic | `project_context` | 项目静态上下文文件（`ContextFile.dynamic == false`） |
| dynamic | `dynamic_context` | 项目动态上下文文件（`ContextFile.dynamic == true`） |
| dynamic | `session_context` | 会话元数据 |

`PromptMode` 决定 builder 实际发出哪些 section：

| PromptMode | 发出 section |
|---|---|
| `NONE` | 仅 `identity` |
| `MINIMAL` | `identity`（stable）+ `runtime`（dynamic） |
| `FULL` | 完整 canonical taxonomy，但每个 section 在 resolved content 为空时**省略**该 section |

模板/profile 通过 `SystemPromptContribution.sectionOverrides: Map<sectionKey, content>` 对上述 key 做内容替换；未在 map 内的 section 使用 builder hardcoded default content。模板不能引入 `supportedSectionKeys()` 外的 section，不能删除 builder 会发出的 section，不能重排。

加上 render-stage 输入（不在 SystemPrompt sections 内）：

- `selectedMessageRefs` -> 选中历史
- `requestId` / accepted request boundary -> 当前请求
- 已选历史和当前请求消息上的附件引用 -> 附件

加上 1 段 tool schema 派生：

- `visibleCapabilities` -> 单一来源，filter TOOL -> `tools[]`（filter SKILL -> `skills` section 文本；AGENT 不入任一目标）

最终 10 个 stable + 5 个 dynamic section 拼出 SystemPrompt 文本形成内置默认模型输入。

## 变更范围（What Changes）

- **新增** `add-ts-context-prompt-shaping` change，定义 `SystemPromptBuilder` 固定 section taxonomy + `PromptMode`、`TemplateVariableResolver` 注册表、`PromptTemplateLoader` chain + 分层 `PromptTemplateProfile` registry、`ModelOptionsOverride` 合并规则、capability 单一来源、ContextEnginePort 编排规则
- **修改** `context-engine` 基线：明确 render 阶段使用既有 `selectedMessageRefs`、`requestId` 和消息/附件边界，不新增 `ContextAssemblyRequest` 字段
- **明确** 不依赖 `add-ts-context-budget-explainability`；未来若引入预算策略解释，作为 sibling change
- **新增** `context-prompt-shaping` capability

## 核心设计原则

- **Builder 拥有 section 集合和顺序**：SystemPrompt sections 集合由 builder 决定，spec 不硬编码 `sectionKey` 列表外的内容产出，但 builder 的 taxonomy 是规范一部分；模板/profile 只能 override content
- **Stable / dynamic 由 builder 决定**：stable sections 是 builder 拼出的 stable 列表，dynamic sections 是 builder 拼出的 dynamic 列表；不是 section 自带 `source` 字段
- **变量用注册表 + required/optional 声明**：注册表（≥12 个）覆盖常规字段；fragment 可声明 required / optional 变量；未知变量字面透传而非整模板失败；**禁止** 2 字段白名单
- **模板解析双机制**：`PromptTemplateLoader` chain（chain-of-responsibility）+ 分层 `PromptTemplateProfile` registry；**禁止** 固定 5 步链
- **`ModelOptions` 来自分层 override 合并**：base + 每个匹配 profile 的 `ModelOptionsOverride` 在 layer+precedence 顺序上字段级合并；**禁止** 来自 `PromptTemplate.defaultModelOptions`
- **Render 边界清晰**：消息引用、附件引用、当前请求内容不进入 SystemPrompt；render 只使用既有 assembly refs、执行坐标和消息/附件边界
- **Capability 单一来源**：`enabledCapabilities` 既是 `skills` SystemPrompt section 的来源（仅 SKILL），也是 `RenderedModelInput.tools[]` 的来源（仅 TOOL）；AGENT 不进任一目标
- **Diagnostics 不进模型输入**：prompt shaping 任何降级、fallback、safe omission、profile 冲突、fragment render failure 写入现有安全观测/timeline 入口，不进 `RenderedModelInput`，不进 `ContextAssembly.diagnostics` 公共字段
- **Orchestrator = ContextEnginePort**：`assemble()` / `render()` 就是编排者，不另造新名字；委托给 layered profile resolver / loader chain / `SystemPromptBuilder` / `TemplateVariableResolver` / `ModelInputRenderer`

## Capability 影响（Capabilities）

### 新增 Capability

- `context-prompt-shaping`：定义 `SystemPromptBuilder` section taxonomy、`PromptMode`、`SystemPromptContribution`、`TemplateVariableResolver` 注册表、`PromptTemplateLoader` chain + 分层 `PromptTemplateProfile` registry、`ModelOptionsOverride` 合并规则、capability 单一来源、ContextEnginePort 编排
- `context-engine`（向 `add-ts-context-history-selection` 建立的基线追加**新** requirement，用 `## ADDED Requirements`）：明确 `ContextAssembly` 顶层字段；`assemble()` 编排规则加入 prompt shaping。这几条 requirement 名称在现有 context-engine 基线中不存在，属新增而非对既有 requirement 的 MODIFIED

### 依赖的相邻 Capability（不在本 change 内 MODIFIED）

- `add-ts-large-content-references`：依赖其冻结的 large-content replacement decision
- `add-ts-context-compression`：依赖其冻结的 summary message 与 commitCompaction
- `add-ts-traceable-summary-generation`：间接依赖（summary content 出现在 `selectedMessageRefs` 解析结果中）

## 影响范围（Impact）

- **代码**：主要影响 `agent-context-engine` 内部实现；仅在 `agent-contracts/context` 补充 section metadata、builder / contribution / profile / override / loader / token estimator 类型与变量注册表常量，不改写冻结的 `SystemPrompt` 顶层形状
- **依赖**：
  - 依赖 `establish-ts-core-contracts`（`SystemPrompt`、`ContextAssembly`、`RenderedModelInput`、`ChatMessage`、`AgentAssembly` 等）
  - 依赖 `add-ts-context-history-selection`（`selectedMessageRefs`）
  - **不**依赖 `add-ts-context-budget-explainability`（roadmap v2 当前已将其列入 active 列表，但本 change 不依赖其产出接口；budget explainability 如未来需要在 `ModelInputRenderer.render()` 之前引入轻量回调查点，作为 sibling change 引入，不阻塞本 change 起跑）
  - 依赖 `add-ts-context-compression`（summary message 的 render 规则）
  - 依赖 `add-ts-large-content-references`（loader / replacement state 消费）
  - 依赖 `add-ts-capability-core-governance`（`CapabilityDescriptor` 用于 capability disclosure；filter SKILL / TOOL / AGENT 时按 source 行为）
  - 依赖 `add-ts-agent-package-assembly`（`AgentAssemblyRegistry.require()` 获取 assembly）
- **配置**：需要 prompt 模板的存储与加载机制（file loader + resource loader + profile registry）
- **测试**：需要 contract 测试覆盖 `SystemPrompt.stableSections/dynamicSections` 顺序语义、`RenderedModelInput` 形状、role 映射、tool 配对、cache boundary 位置、layered profile 解析优先级与同 layer 冲突、loader chain 降级、`SystemPromptContribution` override 行为、变量注册表替换与字面透传、码点感知 token 估算

## 实施门禁（implementation gate）

本 change 的实现与验收不得在以下 6 个 active sibling change 全部 archive 之前起跑：

- `add-ts-context-history-selection`
- `add-ts-large-content-references`
- `add-ts-context-compression`
- `add-ts-traceable-summary-generation`
- `add-ts-agent-package-assembly`
- `add-ts-capability-core-governance`

roadmap v2 当前把上述 6 个 change 全部标记为 active。此外，`refine-ts-context-assembly-contracts` 作为 contract 前置必须先冻结（本 change tasks 1.1 / 1.x 依赖其冻结后的 `agent-contracts/context` 形状，tasks 7.0 已将其与上述 6 个 sibling 一并列为前置门禁）。本 change 在 tasks 7.0 中以 refine + 同样 6 个 sibling 作为前置门禁；若在实现期发现任意一个未 archive，则本 change 的 7.5 / 7.7 / 7.8 等 contract / integration 任务须 split 为 deferred 子任务或拒绝验收。

协调方应根据本门禁与上述 6 个 sibling 的 archive 排期对齐，避免半成品任务被勾选。本 change 不再单独声明对 `add-ts-context-budget-explainability` 的依赖；该 change 在 roadmap v2 当前亦为 active，但本 change 不消费其产出接口。

## 契约确认结论（agent-contracts）

本 change 需要补充 `agent-contracts/context` public contract，但不改变已冻结的顶层 owner 或 `SystemPrompt.stableSections` / `dynamicSections` 形状。确认结论：以下 contract delta 可在本 change 内作为 prompt shaping 的最小 context contract 补齐项落地；实施不得扩大为 owner 迁移、`agent-contracts` subpath 新增、`ContextAssembly.diagnostics` 公共字段新增或重定义 `ModelOptions`。

- `SystemPromptSection` 既有 `sectionId: string` 字段在 core-contracts 现状下是 top-level 唯一标识字段。本 change 依赖 `refine-ts-context-assembly-contracts` 冻结该字段为 public canonical key；不得将 `sectionId` 重命名为 `sectionKey`
- 既有 `SystemPromptSectionMetadata` 的 `sectionKey?` / `order` 字段不作为 public canonical key；prompt shaping 组件只读 top-level `sectionId` / `heading` / `content` 字段；这一行为约束由 tasks 7.5 contract 测试固化
- 新增 `SystemPromptBuilder` 接口与 `PromptMode` 枚举（`FULL` / `MINIMAL` / `NONE`）、`SystemPromptContext` / `SystemPromptContribution` 类型
- 新增 `TemplateVariableResolver` 变量注册表常量与 type guard（首版 ≥12 个变量：agentId / sessionId / modelInfo / runtimeInfo / environment / enabledSkills / networkEnvironment / isProduction / timezone / currentDate / platform / osVersion）；禁止 2 字段白名单
- 新增 `PromptTemplateProfile` / `ProfileLayer` / `ModelOptionsOverride` / `PromptTemplateRegistry` / `PromptTemplateProfileQuery` / `PromptTemplateLoader` 类型
- 新增 `TokenEstimator` 接口（码点感知）与默认 `DefaultTokenEstimator` 类型
- 复用 `agent-contracts/model.ModelOptions`，不得在 `agent-contracts/context` 重新定义 `ModelOptions` 字段
- `ContextAssembly` 顶部形态不新增 `diagnostics` / `attachmentRefs` / `currentRequestRef` 公共字段；`SystemPrompt.stableSections` / `dynamicSections` 形态保持

反向证据条件：若本 change 实施过程中发现需要新增 subpath / 迁移 owner / 公共 `diagnostics` 字段 / 重定义 `ModelOptions`，则当前 assumption 失效，必须先更新 `refine-ts-context-assembly-contracts` 或另开 contract refinement change，再把 prompt shaping 的最小 contract delta 拆为单独的实施 change。本 proposal 显式记录这一反向证据条件，避免首次落地 assumption 被静默越界。

## 非目标（Non-Goals）

- 不定义具体 prompt template 全文
- 不实现 history selection、budget/compaction、large-content replacement/offload
- 不实现模型调用（归 `agent-model`）
- 不实现 summary 生成（归 `add-ts-traceable-summary-generation`）
- 不定义 prompt caching 的 provider 适配细节（归 `agent-model`）
- 不实现 typed context source 注册表 / 6 个 source / safe omission 路径：Java 模型已通过 `SystemPromptContext` 上的 `RuntimeInfo` / `EnvironmentInfo` / `TelecomContext` / `enabledCapabilities` / `projectContextFiles` / `sessionMetadata` 字段统一承载 builder 输入；本 change 不再单独维护 typed source 接口
- 不解决不属于本 change 的 budget 解释需求

## 归档前更新基线（Baseline Promotion Plan）

行为粒度：

- `openspec/specs/context-prompt-shaping/spec.md`：新增，承载 prompt shaping 完整行为粒度
- `openspec/specs/context-engine/spec.md`：修改，补充 render 引用边界与编排 requirement

长期基线：

- `openspec/overview.md`：补全 Context Engine 从装配到渲染的完整链路说明

设计视图：

- `openspec/designs/architecture/context-engine-pipeline.md`：新增，assemble -> shaping -> render 数据流
- `openspec/designs/domain/prompt-template.md`：新增，PromptTemplate / Profile / Override / Loader 领域对象
- `openspec/designs/contracts/context-spi.md`：修改，ContextEnginePort 内部编排语义
- `openspec/designs/modules/agent-context-engine.md`：修改，prompt shaping 组件职责
