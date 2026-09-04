# context-engine Delta Specification

所属 Function：`FN-4.3 装配上下文`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Context Engine separates assembly from rendering

Context Engine SHALL 把可信 scope、accepted Agent assembly、模型选择、history、prompt、capability visibility 和 budget 决策组装为 `ContextAssembly`，再把该 assembly 渲染为 provider-neutral `RenderedModelInput`。`ContextAssembly` SHALL 携带 render 所需决策和 accepted execution coordinates；`RenderedModelInput` SHALL 携带 model-consumable messages、tools、selected safe model information 和 effective optional model parameters。Context Engine MUST 对前八个 provider-neutral inference fields 按 selected safe profile configuration、已编译且选中的 Prompt Template、受治理 Capability patch、可信 render request 的顺序产生 pre-hook effective value，后层逐字段覆盖前层。`ModelInputRenderRequest.providerOptions` MUST 只携带 `Provider options remain an open selected-provider extension` 所定义的 trusted request 来源；Context Engine MUST 对 call-level `providerOptions` 按已编译且选中的 Prompt Template、受治理 Skill patch、可信 render request 的顺序顶层浅合并，同名嵌套对象整体替换，并将结果交给 `RenderedModelInput.providerOptions`。这三个 call-level 授权来源均缺失时 MUST 保持该字段缺失，MUST NOT 合成空对象。受治理 Skill Tool context patch `modelOptions.providerOptions` MUST 来自 accepted Skill metadata。Context Engine MUST NOT 读取或暴露 private profile `providerOptions`；模型调用边界 MUST 按模型调用契约把 private profile defaults 置于 call-level composite 之前，并把 governed hook 置于其后。Context Engine MUST NOT 从 history、Capability 参数、非 Skill Tool Capability result、模型输出或 metadata 派生 provider options。`ContextAssembly` 和 `RenderedModelInput` MUST NOT 包含 `providerId`、endpoint、credential reference、custom fetch、SDK type 或模型目录的私有 binding。

`toolChoice` MUST 作为第八个 provider-neutral inference field 参与同一逐字段 precedence，并 MUST 复用 canonical `ToolChoice` 的 `AUTO | NONE | REQUIRED` 值域。Context Engine MUST 保留 visible capabilities 投影出的 `tools`，MUST NOT 因 effective `toolChoice=NONE` 清空 descriptor。进入 finalizing turn 时，Agent Core 的 runtime-owned feedback MUST 通过同一 request-local model patch handoff 提供 `toolChoice=NONE`；它不是 Capability result，MUST NOT 改写最后一个 Capability 结果或持久化配置。

`ContextAssemblyRequest` MUST 继续携带 request/run 已接受的 required trusted `identityContext`，并 MUST 使用它执行 owner-scoped context queries；调用方、Capability result、模型输出或 metadata MUST NOT 覆盖该字段，系统 MUST NOT 为其维护平行的 request-local owner side map。受治理的 `contextPatch.modelId` 和 closed `modelOptions` MUST 只影响同一 request/run 的后续 assembly；其中 `modelOptions.providerOptions` MUST 只接受 Capability contract 定义的 governed Skill source。Capability patch MUST 通过 `capability-catalog` 定义的 closed schema 和 source governance；provider access、timeout 和 retry controls 保持由 owning boundaries 管理。

**需求类别**：功能性需求

#### Scenario: Context assembly 完成
- **WHEN** Context Engine 完成 assembly
- **THEN** 结果包含 governed system prompt、selected immutable message refs、accepted execution coordinates、visible capabilities、selected safe model information、effective optional model parameters 和 selection reason
- **AND** 结果不包含 provider access configuration 或最终 rendered messages

#### Scenario: Model input 被渲染
- **WHEN** Context Engine render 一个有效 `ContextAssembly`
- **THEN** selected refs 和 current request 被解析为 provider-neutral messages
- **AND** visible capabilities 被投影为 provider-neutral tools
- **AND** 输出包含 selected safe model information 和 effective optional model parameters
- **AND** 输出不包含完整 `ContextAssembly`、模型目录私有 binding 或 provider-native object

#### Scenario: 渲染输入合并已授权 provider options
- **WHEN** 已编译且选中的 Prompt Template、受治理 Skill patch 或 `ModelInputRenderRequest.providerOptions` 中一个或多个 call-level 授权来源携带 provider options
- **THEN** `RenderedModelInput.providerOptions` MUST 按 template、Skill、trusted request 的顺序顶层浅合并
- **AND** 后层同名顶层字段 MUST 覆盖前层，嵌套对象 MUST 整体替换
- **AND** Context Engine MUST NOT 增加 provider namespace、private profile defaults 或接入字段

#### Scenario: 渲染输入未携带已授权 provider options
- **WHEN** 全部 call-level 授权来源均缺失 provider options，或 provider options 只出现在 history、Capability 参数、非 Skill Tool Capability result、模型输出或不可信 metadata
- **THEN** `RenderedModelInput` MUST 省略 provider options

#### Scenario: Context assembly 使用 request-carried identity
- **WHEN** Context Engine 为 accepted request/run 执行 assembly
- **THEN** owner-scoped query MUST 使用 `ContextAssemblyRequest.identityContext`
- **AND** Capability result 或其他不可信输入 MUST NOT 覆盖 owner scope

#### Scenario: Capability 显式模型选择进入后续 assembly
- **WHEN** 同一 request/run 的 schema-valid `contextPatch.modelId` 已通过模型选择治理
- **THEN** 后续 assembly MUST 将它作为 `ModelSelectionRequest.modelId`
- **AND** model selection MUST 使用该 exact canonical `modelId`

#### Scenario: Finalizing patch 保留 Tool descriptors

- **WHEN** Agent Core 为达到 `maxTurns` 后的 finalizing model turn 提供 runtime-owned `modelOptions.toolChoice=NONE`
- **THEN** Context Engine MUST 通过 request-local option merge 产生 effective `toolChoice=NONE`
- **AND** `RenderedModelInput.tools` MUST 保持当前 Agent 的正常可见 Tool descriptors
- **AND** runtime feedback MUST NOT 持久化为用户 session message 或 durable model configuration

#### Scenario: Tool choice 按 canonical 层次逐字段覆盖

- **WHEN** profile、selected Prompt Template、governed Capability patch 或 trusted render request 中一个或多个来源提供合法 `toolChoice`
- **THEN** Context Engine MUST 按该顺序逐字段覆盖产生 pre-hook value
- **AND** 任一来源省略 `toolChoice` MUST 表示不覆盖

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：Context Engine 把 canonical `toolChoice` 纳入 model option merge，并在 `NONE` 时仍保留可见 Tool descriptors。
- 依据 Requirements：`Context Engine separates assembly from rendering`

### 输入

- 变更类型：修改
- 目标内容：selected profile、Prompt Template、governed Capability patch、trusted render request 和 runtime-owned finalizing feedback 可以提供合法 `toolChoice`。
- 依据 Requirements：`Context Engine separates assembly from rendering`

### 输出

- 变更类型：修改
- 目标内容：`RenderedModelInput` 同时携带 effective `toolChoice` 和未清空的 Tool descriptors。
- 依据 Requirements：`Context Engine separates assembly from rendering`

### 处理过程

- 变更类型：修改
- 目标内容：`toolChoice` 与其他 provider-neutral inference fields 使用同一逐字段 precedence；finalizing feedback 只在当前 request/run 生效。
- 依据 Requirements：`Context Engine separates assembly from rendering`

### 结果

- 变更类型：修改
- 目标内容：模型选择控制不再通过改变 capability disclosure 或 `tools` 请求形态实现。
- 依据 Requirements：`Context Engine separates assembly from rendering`
