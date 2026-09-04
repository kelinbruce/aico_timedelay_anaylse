## ADDED Requirements

### Requirement: Skill manifest 使用 SKILL.md 作为权威输入

系统 MUST 把 `SKILL.md` 视为一个 Skill 的权威 manifest 输入。所有 Skill source MUST 使用该契约派生受治理的 Skill `CapabilityDescriptor`、类型化的 `SkillMetadata` 以及安全的 source 诊断。

#### Scenario: Skill source 消费受治理的 descriptor metadata

- **WHEN** 一个 Skill source 发现一个 Skill 候选
- **THEN** 它 MUST 使用该 Skill 的 `SKILL.md` 作为权威 manifest 输入
- **AND** 它 MUST 向下游 capability governance 暴露一个带有类型化 `SkillMetadata` 和安全诊断的受治理 Skill `CapabilityDescriptor`

### Requirement: Skill manifest 支持标准和受支持的扩展 frontmatter 字段

系统 MUST 支持与 Agent Skills `SKILL.md` 用法兼容的标准 Skill manifest frontmatter 字段，以及本 change 显式定义的受支持扩展 frontmatter 字段：

- `name`
- `description`
- 可选的 `license`
- 可选的 `compatibility`
- 可选的 `allowed-tools`
- 可选的 `context`
- 可选的 `agent`
- 可选的 `user-invocable`
- 可选的 `model-invocable`
- 可选的 `model`
- 可选的 `metadata`

所列字段 MUST 足以在任何 source 专属执行关注点被应用之前描述一个 Skill。

`name` 字段 MUST 存在，且 MUST 是一个 1-64 字符的非空字符串，只含小写字母数字字符和连字符，不含前导或尾随连字符，也不含连续连字符。当 Skill source 知道包含该 Skill 的目录或 source 候选名时，已校验的 `name` MUST 匹配该安全目录/候选名，否则校验 MUST 拒绝该 manifest。`description` MUST 存在，MUST 是一个 1-1024 字符的非空字符串，并且 MUST 描述该 Skill 做什么以及何时使用它。`license` 存在时 MUST 是字符串。`compatibility` 存在时 MUST 是一个 1-500 字符的字符串。`allowed-tools` 存在时 MUST 是以空格分隔的 tool name 字符串并解析为字符串数组；仅当空 tool name 由重复空白引起时才 MUST 被忽略，并且在产出 descriptor metadata 之前，重复的 tool name MUST 被去重并保留首次出现顺序。`metadata` 存在时 MUST 是字符串键到字符串值的映射。`context` 存在时 MUST 是 `inline` 或 `fork`。`agent` 存在时 MUST 解析为既有 Agent assembly 契约和 `AgentAssemblyRegistry` 查找所使用的 canonical `AgentId`；它 MUST NOT 是显示名、provider 限定 id 或 `agentId + agentVersion` 对。`user-invocable` 和 `model-invocable` 存在时 MUST 是布尔值。`model` 存在时 MUST 解析为安全 model 字符串，或只包含受支持 model 声明字段的 JSON 兼容对象。

#### Scenario: 标准 manifest 字段被接受

- **WHEN** 系统校验一个带有标准字段和有效受支持扩展的 Skill manifest
- **THEN** 它 MUST 产出一个受治理的 Skill descriptor 输入
- **AND** 该 descriptor metadata MUST 能被 builtin、local、agent-scoped 和 SkillHub source 流程使用

#### Scenario: 官方 Agent Skills 字段形状在 source 名匹配时被接受

- **WHEN** 一个 Skill manifest 提供必填的 `name` 和 `description`、可选的 `compatibility`、可选的 string 到 string 的 `metadata`、可选的以空格分隔的 `allowed-tools`，以及与 `name` 匹配的安全 source 候选名
- **THEN** manifest 校验 MUST 接受该官方字段形状
- **AND** 重复空白和重复 tool name MUST 归一化为首次出现的 tool 约束顺序

#### Scenario: 无效标准字段被拒绝

- **WHEN** 一个 Skill manifest 省略 `name`、省略 `description`、提供无效 `name`、在存在安全 source 候选名时提供与该候选名不匹配的 `name`、提供为空或过长的 `description`、提供非字符串的 `description`、`license` 或 `compatibility`、提供过长的 `compatibility`、提供非字符串的 `allowed-tools`、提供非字符串的 metadata 键或值、提供非布尔值的 `user-invocable`、提供非布尔值的 `model-invocable`、提供无效 `agent`、提供无效 `model`，或提供带空白以外空 tool name 的 tool 约束
- **THEN** manifest 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入 source skip 路径并带有安全诊断

### Requirement: Skill manifest 产出类型化的 Skill capability metadata

当 descriptor 的 `kind` 是 `SKILL` 时，manifest 契约 MUST 为 `CapabilityDescriptor.metadata` 产出类型化的 `SkillMetadata`。`SkillMetadata` MUST 由 `agent-contracts/capability` 拥有作为 public metadata schema。Parser 实现细节和 parser 进程中的 frontmatter 对象仍由 `agent-capability` 拥有。

已接受或降级的 manifest 校验 MUST 产出 Skill descriptor 输入和安全诊断。对 Skill descriptor 而言，已校验的 Skill `name` MUST 映射到 `CapabilityDescriptor.capabilityId` 以及对模型可见的显示名。已校验的 Skill `description` MUST 映射到 `CapabilityDescriptor.description`。如果 `metadata.version` 存在，它 MUST 作为一个通用 Skill metadata 键映射到 `CapabilityDescriptor.version`，并且 MUST NOT 要求 `nextagent` 前缀。descriptor 的 `metadata` MUST 校验为 `SkillMetadata`，并包含一个 discriminator、`context`、`userInvocable`、`modelInvocable`、可选的 `agent`、可选的 allowed tool 约束、可选的 denied tool 约束、可选的 `model`、可选的 `modelOptions` 以及可选的安全 source metadata。归一化后的 metadata 字段 MUST 以 `context`、`agent`、`model`、`userInvocable` 和 `modelInvocable` 作为字段名。

Skill descriptor 的 `capabilityId` MUST 与模型用来选择该 Skill 的值相同。Provider 限定标识符 MUST 保留在 `CapabilityDescriptor.provider`、Agent binding、catalog 治理和诊断中；它们 MUST NOT 取代对模型可见的 Skill `name`。Capability catalog 治理 MUST 确保 Agent 可见的模型披露集合中每个 Skill `capabilityId` 至多包含一个可用 Skill；有歧义的重复项 MUST 在模型披露和调用之前被解决、shadow、跳过或诊断。

Manifest 校验 MUST 把每个 Skill 候选分类为 `accepted`、`rejected` 或 `degraded`。当校验为 `rejected` 时，descriptor 输入 MUST 缺席。当校验为 `accepted` 时，descriptor 输入 MUST 存在，诊断 MAY 为空。当校验为 `degraded` 时，descriptor 输入 MUST 仍然有效，且诊断 MUST 解释每个安全降级原因。

本 change 对 `agent-contracts/capability` 契约的精化 MUST 仅限于 `CapabilityDescriptor.description`、`SkillMetadata`、`SkillManifestDiagnostic` 及其 runtime schema。仅 parser 使用的类型（例如 `SkillFrontmatter`）、parser 校验中间产物、文件系统输入、source 扫描状态、source 私有加载键、Skill 正文加载、catalog 注册、invocation 生命周期、descriptor 存储和 provider 私有配置仍由各自的 source、治理或 invocation change 拥有。

#### Scenario: 被接受的 manifest 产出类型化 descriptor metadata

- **WHEN** 一个 Skill manifest 被接受
- **THEN** 下游 source 和治理流程 MUST 收到一个其 `metadata` 校验为 `SkillMetadata` 的 Skill `CapabilityDescriptor` 输入
- **AND** 交换的 payload MUST 保持限定为受治理的 descriptor 字段、类型化 metadata 和安全诊断

#### Scenario: Parser 中间产物保持为实现私有

- **WHEN** builtin、local、agent-scoped、SkillHub、capability governance、Agent assembly 或 context 披露流程跨越 package 边界
- **THEN** 它们 MUST 交换 `CapabilityDescriptor`、类型化的 `SkillMetadata` 和安全诊断
- **AND** parser 中间产物（例如 `SkillFrontmatter` 和 parser 校验记录）MUST 保持在 `agent-capability` 实现边界之内

### Requirement: Skill frontmatter parser 和 descriptor mapper 是可复用的 capability helper

`agent-capability` package MUST 为 builtin、local、agent-scoped 和 SkillHub source 流程提供一个可复用的 Skill frontmatter parser 和一个可复用的 Skill descriptor mapper。这些 helper MAY 使用实现私有的 parser record，但 package 边界 MUST 只暴露 `CapabilityDescriptor`、类型化的 `SkillMetadata`、校验结果和 `SkillManifestDiagnostic`。

frontmatter parser MUST 只解析 `SKILL.md` 开头的 frontmatter 块或已被提取的 frontmatter 源。它 MUST NOT 要求完整 markdown 正文作为 parser 输入。source 专属的文件读取器 MAY 读取 `SKILL.md` 开头的一个有界切片来提取 frontmatter，但 raw 正文加载和正文到 context 的注入仍由后续执行/context change 拥有。

descriptor mapper MUST 接受已校验的 Skill frontmatter 事实和一个 `CapabilityProvider`，然后产出一个带类型化 `SkillMetadata` 的 Skill `CapabilityDescriptor`。mapper MUST 按本契约的映射规则派生 `capabilityId`、显示名、`description`、`version` 和 Skill metadata。Provider 身份 MUST 来自所提供的 `CapabilityProvider`；source 私有路径、provider 私有 entry ref 和 raw markdown 正文内容 MUST NOT 进入 descriptor。官方 `license` 和 `compatibility` 值在本 change 中是描述性的 Skill source metadata，MUST NOT 被转换为 `CapabilityDescriptor.compatibility`，除非后续某个 capability governance change 定义了类型化映射。

#### Scenario: Parser 只消费 frontmatter 边界

- **WHEN** 一个 Skill source 解析一个 `SKILL.md`
- **THEN** 可复用 parser MUST 在不要求 markdown 正文的情况下校验开头的 frontmatter 块
- **AND** markdown 正文内容 MUST 保持在 manifest 校验输出之外

#### Scenario: Mapper 返回 Skill descriptor

- **WHEN** 已校验的 Skill frontmatter 和一个 `CapabilityProvider` 被传递给可复用 descriptor mapper
- **THEN** mapper MUST 产出一个 Skill `CapabilityDescriptor`，其 `capabilityId`、对模型可见的显示名、`description`、`version`、provider、compatibility 和 `metadata` 遵循本契约
- **AND** descriptor 的 `metadata` MUST 校验为 `SkillMetadata`

### Requirement: CapabilityDescriptor 使用 description 字段

capability 契约 MUST 使用 `CapabilityDescriptor.description` 作为对模型可见的安全 capability 描述。`safeDescription` MUST NOT 继续作为 `CapabilityDescriptor` 的 public 字段。`description` 值 MUST 继续满足相同的安全限制：它 MUST 有界、经过净化，并且不包含 secret、raw 路径、raw provider 响应、credential、用户输入、model 输入/输出和不安全 metadata。

#### Scenario: Descriptor 暴露 description

- **WHEN** 一个 Tool、Skill 或 Agent capability descriptor 跨越 package 边界被交换
- **THEN** 该 descriptor MUST 通过 `description` 暴露 capability 描述
- **AND** 下游 context/model 披露 MUST 在构建对模型可见的 capability metadata 时使用 `description`

### Requirement: Skill capability metadata 通过类型化 accessor 读取

当 `CapabilityDescriptor.kind` 是 `SKILL` 时，系统 MUST 为 `CapabilityDescriptor.metadata` 提供类型化的 Skill metadata schema 和 accessor。该 accessor MUST 在返回 `SkillMetadata` 之前校验 descriptor kind 和 metadata discriminator。

`SkillMetadata` 的 public schema/type 由 `agent-contracts/capability` 拥有。runtime 校验/accessor 实现由 `agent-capability` 拥有，并 MUST 通过 public package export 暴露给需要类型化 Skill metadata 的下游 package。下游 package MUST 使用类型化 accessor 或 schema 校验结果，而不是直接从 `CapabilityDescriptor.metadata` 读取 Skill 专属键。

`SkillMetadata` MUST 包含一个稳定的 discriminator（例如 `metadataKind: "nextagent.skill"`）、`context`、`userInvocable`、`modelInvocable`、可选的 `agent`、可选的 `allowedTools`、可选的 `deniedTools`、可选的 `model`、可选的 `modelOptions` 和可选的 `sourceMetadata`。`sourceMetadata` 存在时 MUST 只包含安全的 source metadata 字符串键和字符串值。

#### Scenario: Skill descriptor metadata 被解析为 SkillMetadata

- **WHEN** 一个下游 package 收到一个 `kind=SKILL` 的 `CapabilityDescriptor`
- **THEN** 它 MUST 通过类型化 Skill metadata accessor 或 schema 校验结果获得 Skill 专属 metadata
- **AND** 成功解析 MUST 返回 `SkillMetadata`

#### Scenario: 非 Skill descriptor 使用自己的 metadata 契约

- **WHEN** 一个下游 package 收到一个 kind 不是 `SKILL` 的 `CapabilityDescriptor`
- **THEN** Skill metadata 解析 MUST 返回安全的不匹配结果
- **AND** 该 descriptor 自身的 kind 专属 metadata 契约继续负责类型化解析

### Requirement: 顶层 context 定义受支持的 context 扩展

Skill context 扩展 MUST 以顶层 `context` frontmatter 字段表达。允许的值为：

- `inline`
- `fork`

如果省略 `context`，默认的受治理 `context` 事实 MUST 是 `inline`。Fork 执行、子 Agent 执行、context 继承和结果返回语义由后续执行 change 拥有。

#### Scenario: 缺失 context 默认为 inline

- **WHEN** 一个有效的 Skill manifest 省略 `context`
- **THEN** Skill metadata MUST 使用 `inline` 作为默认 `context`

#### Scenario: 无效 context 被拒绝

- **WHEN** 一个 Skill manifest 包含值不是 `inline` 或 `fork` 的 `context`
- **THEN** 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入 source skip 路径并带有安全诊断

### Requirement: 顶层 agent 定义 fork Agent 选择提示

`agent` 扩展 MAY 以顶层 Skill frontmatter 字段表达。存在时，它 MUST 解析为既有 Agent assembly 契约和 `AgentAssemblyRegistry.active(agentId)` / `AgentAssemblyRegistry.require(agentId, agentVersion)` 查找边界所使用的 canonical `AgentId`，并 MUST 解析进 `SkillMetadata.agent`。它 MUST NOT 接受 Agent 显示名、provider 限定标识符、source 本地别名或包含 Agent 版本选择的值。Agent 版本和 active-version 解析仍由 Agent assembly 和后续执行治理拥有。

`agent` 是一个 fork 执行提示。当 `agent` 存在且 `context` 被省略时，归一化的 `context` MUST 是 `fork`。当 `agent` 存在且 `context` 显式为 `inline` 时，manifest 校验 MUST 拒绝该 manifest。`agent` 本身不授权跨 Agent 执行；Agent scope、capability binding、owner scope、availability、policy、invocation 授权、context 继承、model 选择和 fork 执行仍由后续执行 change 和既有治理管辖。

#### Scenario: agent 隐含 fork context

- **WHEN** 一个有效的 Skill manifest 声明了顶层 `agent` 并省略 `context`
- **THEN** Skill metadata MUST 使用 `fork` 作为归一化的 `context`
- **AND** Skill metadata MUST 把 canonical `AgentId` 暴露为 `agent`

#### Scenario: agent 与 inline context 冲突

- **WHEN** 一个 Skill manifest 声明了顶层 `agent` 和 `context: inline`
- **THEN** manifest 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入 source skip 路径并带有安全诊断

### Requirement: 顶层 user-invocable 定义显式用户选择资格

`user-invocable` 扩展 MAY 以顶层 Skill frontmatter 字段表达。存在时，它 MUST 是布尔值，并 MUST 解析为受治理事实 `userInvocable`。省略时，`userInvocable` MUST 默认为 `false`。

`userInvocable=true` MUST 表示该 Skill 在常规 capability governance 接受它之后，可以被纳入显式用户指定执行的考虑范围。Capability binding、owner-scope 检查、Agent-scope 检查、availability、policy、invocation 授权和 model 选择仍是必需的。Model/core 编排资格仍由其自身的 capability policy 管辖。

#### Scenario: 缺失 user-invocable 默认为 false

- **WHEN** 一个有效的 Skill manifest 省略 `user-invocable`
- **THEN** Skill metadata MUST 使用 `false` 作为默认 `userInvocable`

#### Scenario: 非布尔 user-invocable 被拒绝

- **WHEN** 一个 Skill manifest 包含非布尔值的 `user-invocable`
- **THEN** 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入 source skip 路径并带有安全诊断

### Requirement: 顶层 model-invocable 定义模型编排调用资格

`model-invocable` 扩展 MAY 以顶层 Skill frontmatter 字段表达。存在时，它 MUST 是布尔值，并 MUST 解析进 `SkillMetadata.modelInvocable`。省略时，`modelInvocable` MUST 默认为 `true`。

`modelInvocable=true` 表示该 Skill 在常规 capability governance 接受它之后，可以被纳入 model/core 编排调用的考虑范围。Capability binding、owner-scope 检查、Agent-scope 检查、availability、policy、invocation 授权和 model 选择仍是必需的。显式用户指定执行资格仍由 `userInvocable` 管辖。

#### Scenario: 缺失 model-invocable 默认为 true

- **WHEN** 一个有效的 Skill manifest 省略 `model-invocable`
- **THEN** Skill metadata MUST 使用 `true` 作为默认 `modelInvocable`

#### Scenario: 非布尔 model-invocable 被拒绝

- **WHEN** 一个 Skill manifest 包含非布尔值的 `model-invocable`
- **THEN** 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入 source skip 路径并带有安全诊断

### Requirement: allowed-tools 和 metadata.denied-tools 是 tool 约束事实

`allowed-tools` 字段和 `metadata.denied-tools` 扩展存在时，MUST 分别解析进 `SkillMetadata.allowedTools` 和 `SkillMetadata.deniedTools`。为保持 Agent Skills metadata 兼容性，两者的值 MUST 使用 Agent Skills 兼容的以空格分隔的 tool-name 字符串格式。这些字段为 capability governance 产出 tool 约束 metadata。Tool 执行权仍由 capability governance、Agent assembly、owner scope 和 policy 决定。

#### Scenario: Tool 约束输入授权治理

- **WHEN** 一个 Skill manifest 声明 `allowed-tools` 或 `metadata.denied-tools`
- **THEN** 系统 MUST 把这些值暴露为类型化的 Skill tool 约束 metadata
- **AND** capability governance 和 Agent assembly MUST 仍然执行 availability、binding、owner scope 和 policy 检查

#### Scenario: 无效 tool 约束形状被拒绝

- **WHEN** `allowed-tools` 或已解析的 `metadata.denied-tools` 形状无效、包含非字符串值，或包含空 tool name
- **THEN** manifest 校验 MUST 拒绝该 manifest

### Requirement: metadata.version 映射到 descriptor version

`metadata.version` 字段 MAY 作为 Skill metadata 字符串提供。存在时，它 MUST 是一个非空的安全版本字符串，并 MUST 映射到 `CapabilityDescriptor.version`。它 MUST NOT 被复制进 `SkillMetadata.sourceMetadata`，因为它具有受治理的 descriptor 含义。

#### Scenario: metadata.version 成为 descriptor version

- **WHEN** 一个 Skill manifest 声明 `metadata.version`
- **THEN** Skill descriptor 输入 MUST 把 `CapabilityDescriptor.version` 设置为该值
- **AND** 归一化的 Skill metadata MUST 保持聚焦于 Skill 专属 metadata，而不是重复 descriptor version

### Requirement: Model 声明是受治理的 model 提示

系统 MUST 把所有受支持的 Skill model 声明视为受治理的 model hint 输入，而不是 provider 配置。

Skill manifest MAY 通过这些受支持的输入提供安全的 model 偏好或约束事实：

- 顶层 `model`
- `metadata.nextagent.model`
- `metadata.nextagent.modelOptions`
- 兼容别名 `metadata.model`

为保持顶层事实上的兼容性，顶层 `model` MAY 作为安全 model 字符串或包含 `model` 和可选 `modelOptions` 的 JSON 兼容对象提供。为在提供 NextAgent 标准扩展命名空间的同时保持 Agent Skills metadata 兼容性，`metadata.nextagent.model` MUST 是安全 model 字符串，`metadata.nextagent.modelOptions` MUST 是安全的 JSON 字符串对象。兼容别名 `metadata.model` MAY 是一个 metadata 字符串，包含一个 model 字符串，或一个带 `model` 和可选 `modelOptions` 的安全 JSON 字符串对象。

解析之后，下游消费者 MUST 看到类型化的 `SkillMetadata.model` 和可选的 `SkillMetadata.modelOptions`。Model 声明 MUST 是由 model 标识符和受治理 model option 组成的安全 model hint。最终 model 选择仍由 model/context 治理拥有。

Model 声明 MUST 是非权威的。最终 provider、model、credential、endpoint、provider option、runtime model 配置和 Agent 默认 model profile 决定需要 model/profile 治理校验。

Thinking depth 或 reasoning depth MUST 按既有 model option 契约表示在 `modelOptions` 之内。

如果多个受支持输入声明了 `model`，归一化后的 model 值 MUST 一致，否则 manifest 校验 MUST 拒绝该 manifest。如果多个受支持输入声明了 `modelOptions`，除非 parser 能证明归一化后的 model option 相同，manifest 校验 MUST 拒绝该 manifest。

#### Scenario: 不安全 model metadata 被拒绝

- **WHEN** 一个受支持的 model 声明包含 raw credential 材料或 provider 私有连接配置
- **THEN** manifest 校验 MUST 拒绝该 manifest
- **AND** 下游输出 MUST 只包含安全诊断原因

#### Scenario: 无效 model metadata 形状被拒绝

- **WHEN** 一个受支持的 model 声明作为安全 model 字符串或只包含受支持 `model` 和 `modelOptions` 字段的安全对象而言形状无效
- **THEN** manifest 校验 MUST 拒绝该 manifest
- **AND** 下游治理决定 MUST 只收到被拒绝的校验结果和安全诊断

#### Scenario: Model metadata 在治理接受之前保持为提示

- **WHEN** 一个 Skill manifest 声明一个受支持的 model 输入
- **THEN** 系统 MUST 把它暴露为安全的 Skill model metadata
- **AND** model/profile 治理 MUST 在使用前校验任何最终 provider、model、profile、option 或 runtime model 配置决定
- **AND** 在治理接受一个 request/run 级别的 model 决定之前，Agent assembly model profile 和 runtime 设置保持是权威来源

#### Scenario: 顶层 model 和 NextAgent metadata 归一化为相同的 Skill metadata

- **WHEN** 一个 Skill 声明顶层 `model`，另一个等价 Skill 声明 `metadata.nextagent.model` 和可选的 `metadata.nextagent.modelOptions`
- **THEN** 两个 manifest MUST 归一化为相同的 `SkillMetadata.model` 和可选的 `SkillMetadata.modelOptions` 形状
- **AND** 下游消费者 MUST 对两种输入形式收到相同的类型化 Skill metadata

#### Scenario: 冲突的 model 声明被拒绝

- **WHEN** 一个 Skill manifest 通过多个受支持的 model 输入声明冲突的 `model` 或 `modelOptions` 值
- **THEN** manifest 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入 source skip 路径并带有安全诊断

### Requirement: 未知 metadata 不携带受治理含义

本 change 受支持 metadata 集合之外的 metadata 字段是 source metadata。安全的、字符串值的、非敏感的未知 metadata MAY 被保留为 source metadata。不安全或过大的 source metadata MUST 从 Skill metadata 中省略，并且在 manifest 其余部分仍有效时 MUST 发出降级安全诊断。非字符串的 metadata 键或值是无效的官方 metadata 形状，MUST 拒绝该 manifest。

受治理行为 MUST 从受治理的 descriptor 字段和类型化 Skill metadata 派生。Capability governance、Agent assembly、model 选择、路由、policy、sandbox、prompt 渲染、prompt shaping、owner scope、secret 解析、provider 配置、tool 约束和 availability MUST 消费受治理的 descriptor 字段和类型化 Skill metadata，而不是未知 metadata。

#### Scenario: 未知 metadata 被保留为 source metadata

- **WHEN** 一个 Skill manifest 包含未知 metadata 键
- **THEN** 受治理行为 MUST 保持从受治理的 descriptor 字段和类型化 Skill metadata 派生
- **AND** 安全的未知 metadata MUST 被保留为 source metadata
- **AND** 不安全或不可解析的未知 metadata MUST 从 Skill metadata 中省略，并以降级安全诊断报告

#### Scenario: 治理决定消费 descriptor metadata

- **WHEN** 一个 Skill manifest 包含未知 metadata 键
- **THEN** 治理决定输入 MUST 包含受治理的 descriptor 字段、类型化 Skill metadata 和安全诊断
- **AND** capability 可见性、availability、invocation、路由、model 选择、prompt shaping、sandbox 行为、owner scope、policy 和 Agent assembly MUST 从受治理的 descriptor 字段和类型化 Skill metadata 派生

### Requirement: Manifest 校验结果是显式的

系统 MUST 把 Skill manifest 校验分类为 accepted、rejected 或 degraded。Accepted 和 degraded manifest MAY 为下游治理产出 descriptor 输入。Rejected manifest 为 source 就绪度产出 `SkillManifestDiagnostic`，并跳过可执行 Skill capability 路径。Degraded manifest MUST 为每个被省略或不可用的 source metadata 字段发出 `SkillManifestDiagnostic`。

结果规则 MUST 是确定性的：

- `accepted`：所有必填标准字段有效；所有受支持的扩展有效；安全的未知 metadata（如果存在）被保留为 `SkillMetadata.sourceMetadata`；不要求诊断。
- `degraded`：所有必填标准字段和所有受治理扩展有效，descriptor 输入有效，只有可选 source metadata 因不安全、过大或其他原因不宜保留而被省略；为每个被省略的 source metadata 字段发出诊断。
- `rejected`：`SKILL.md` 缺失；必填的 `name` 或 `description` 缺失或无效；任何标准字段的官方形状无效；任何受支持扩展的形状无效或受治理值不安全；`agent` 与 `context: inline` 冲突；tool 约束无效；model 声明不安全或冲突；或无法产出 descriptor 输入。

`SkillManifestDiagnostic` MUST 是 manifest 校验的 public 安全诊断契约。它 MUST 包含稳定的 reason code、severity（`INFO`、`WARNING` 或 `ERROR`）、校验结果、净化后的 message，并且在这些值可用时 MAY 包含安全的 `providerId` 和安全的 `skillName`。它 MUST NOT 包含 raw manifest 内容、raw markdown 正文、raw 路径、endpoint、credential、provider 响应、用户输入、model 输入/输出或不安全 metadata。

本 change 的 public `SkillManifestDiagnostic` reason code 集合 MUST 包括：

- `SKILL_MD_MISSING`
- `INVALID_NAME`
- `NAME_MISMATCH`
- `INVALID_DESCRIPTION`
- `INVALID_OFFICIAL_FIELD`
- `INVALID_CONTEXT`
- `INVALID_AGENT`
- `AGENT_REQUIRES_FORK_CONTEXT`
- `INVALID_INVOCABILITY`
- `INVALID_TOOL_CONSTRAINTS`
- `UNSAFE_MODEL_DECLARATION`
- `CONFLICTING_MODEL_DECLARATION`
- `SOURCE_METADATA_OMITTED`
- `DESCRIPTOR_MAPPING_FAILED`

实现 MAY 在产出诊断时添加 source 私有内部细节，但跨 package 和用户可见的 manifest 诊断 MUST 使用这些稳定的 public reason code。

#### Scenario: 被拒绝的 manifest 进入 source skip 路径

- **WHEN** manifest 校验拒绝一个 Skill manifest
- **THEN** 该 Skill 候选 MUST 从可执行 capability catalog 中跳过
- **AND** 系统 MUST 暴露安全诊断 reason code 和净化后的 message

#### Scenario: 被拒绝和降级的 manifest 使用稳定诊断 reason code

- **WHEN** manifest 校验拒绝或降级一个 Skill manifest
- **THEN** 每个 public 诊断 MUST 使用本 change 稳定的 `SkillManifestDiagnostic.reasonCode` 值之一
- **AND** 诊断 MUST 只暴露 severity、校验结果、净化后的 message、可选的安全 provider id 和可选的安全 skill name

### Requirement: Markdown 正文保持为创作内容

`SKILL.md` 的 markdown 正文 MAY 被后续 Skill invocation 或 context 披露 change 用作 Skill 创作内容。本 manifest 契约 MUST 从 frontmatter 派生 descriptor 输入和类型化 Skill metadata，并把正文视为留给后续执行/context change 的创作内容。

Manifest 校验 MUST 交换由 frontmatter 派生的 descriptor 输入、类型化 Skill metadata、校验结果和安全诊断。

#### Scenario: Manifest 校验发出由 frontmatter 派生的 descriptor 输入

- **WHEN** 一个 Skill manifest 包含 markdown 正文内容
- **THEN** manifest 校验 MUST 只发出由 frontmatter 派生的 descriptor 输入、类型化 Skill metadata、校验结果和安全诊断
- **AND** 后续 Skill invocation 或 context 披露 change 拥有任何正文加载语义
