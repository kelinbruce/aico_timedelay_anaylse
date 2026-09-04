## MODIFIED Requirements

### Requirement: Skill Manifest 支持标准与受支持的扩展 frontmatter 字段

系统 MUST 支持与 Agent Skills `SKILL.md` 用法兼容的标准 Skill manifest frontmatter 字段，以及本 change 定义的显式受支持扩展 frontmatter 字段：

- `name`
- `description`
- 可选 `license`
- 可选 `compatibility`
- 可选 `allowed-tools`
- 可选 `context`
- 可选 `agent`
- 可选 `user-invocable`
- 可选 `model-invocable`
- 可选 `model`
- 可选 `metadata`

所列字段 MUST 足以在任何 source 特定的执行关注被应用之前描述一个 Skill。

`name` 字段 MUST 存在，且 MUST 是一个 1-64 个字符、仅含小写字母数字和连字符、不以连字符开头或结尾、不含连续连字符的非空字符串。当 Skill source 知道所在的 Skill 目录或 source 候选名时，已校验的 `name` MUST 匹配该安全目录/候选名，否则校验 MUST 拒绝该 manifest。`description` MUST 存在，MUST 解析为一个 1-1024 个字符的非空安全字符串，MAY 以 YAML literal 或 folded block scalar 表达，并且 MUST 描述该 Skill 做什么以及何时使用它。`license` 存在时 MUST 是字符串。`compatibility` 存在时 MUST 是一个 1-500 个字符的字符串。`allowed-tools` 存在时 MUST 是以空格分隔的 tool 名称字符串并解析为字符串数组；只有由重复空白导致的空 tool 名称 MUST 被忽略，重复的 tool 名称 MUST 在产出 descriptor metadata 之前去重并保留首次出现顺序。`metadata` 存在时 MUST 是从字符串 key 到安全字符串值的 mapping，但 source metadata key `exclusiveWith`、`compatibleWith` 和 `tags` MAY 使用安全非空字符串值的数组。这些数组值 MUST 在 YAML block list 形式和 YAML inline list 形式下都被接受。`context` 存在时 MUST 是 `inline` 或 `fork`。`agent` 存在时 MUST 解析为既有 Agent assembly contract 和 `AgentAssemblyRegistry` 查找所使用的规范 `AgentId`；它 MUST NOT 是显示名、provider 限定 id 或 `agentId + agentVersion` 对。`user-invocable` 和 `model-invocable` 存在时 MUST 是布尔值。`model` 存在时 MUST 解析为一个安全的 model 字符串或只包含受支持 model 声明字段的 JSON 兼容对象。

#### Scenario: 标准 manifest 字段被接受

- **WHEN** 系统校验一个带有标准字段和有效受支持扩展的 Skill manifest
- **THEN** 它 MUST 产出一个受治理的 Skill descriptor 输入
- **AND** 该 descriptor metadata MUST 可被 builtin、local、agent 作用域和 SkillHub source 流程使用

#### Scenario: 官方 Agent Skills 字段形状在 source 名称匹配时被接受

- **WHEN** 一个 Skill manifest 提供必需的 `name` 和 `description`、可选 `compatibility`、可选 string-to-string 的 `metadata`、可选以空格分隔的 `allowed-tools`，以及与 `name` 匹配的安全 source 候选名
- **THEN** manifest 校验 MUST 接受该官方字段形状
- **AND** 重复空白和重复 tool 名称 MUST 规范化为首次出现的 tool 约束顺序

#### Scenario: 受支持的 source metadata 数组被接受

- **WHEN** 一个 Skill manifest 以安全非空字符串的 YAML block list 或 inline list 形式提供 `metadata.exclusiveWith`、`metadata.compatibleWith` 或 `metadata.tags`
- **THEN** manifest 校验 MUST 接受该 metadata 字段形状
- **AND** 数组值 MUST 保持为 source metadata，而不是变成受治理的 Skill descriptor 行为

#### Scenario: 非法的标准字段被拒绝

- **WHEN** 一个 Skill manifest 省略 `name`、省略 `description`、提供非法的 `name`、在存在安全 source 候选名时提供与该名称不匹配的 `name`、提供为空或过长的 `description`、提供无法解析为安全字符串的 `description`、提供非字符串的 `license` 或 `compatibility`、提供过长的 `compatibility`、提供非字符串的 `allowed-tools`、提供非字符串的 metadata key、为 `exclusiveWith`、`compatibleWith` 或 `tags` 之外的 key 提供非字符串的 metadata 值、为受支持数组 metadata key 提供非字符串形式的非数组值、提供包含非字符串或空元素的数组 metadata、提供非布尔值的 `user-invocable`、提供非布尔值的 `model-invocable`、提供非法的 `agent`、提供非法的 `model`，或提供带有非空白空 tool 名称的 tool 约束
- **THEN** manifest 校验 MUST 拒绝该 manifest
- **AND** 该 Skill 候选 MUST 进入带安全诊断的 source 跳过路径

### Requirement: 未知 metadata 不携带受治理语义

本 change 支持的 metadata 集合之外的 metadata 字段是 source metadata。安全的、非敏感的未知 metadata 在其值是字符串时，或在其 key 是 `exclusiveWith`、`compatibleWith` 或 `tags` 之一且其值是安全非空字符串数组时，MAY 被保留为 source metadata。不安全、过大或其他方面不安全的 source metadata MUST 从 Skill metadata 中省略，并在 manifest 其余部分仍有效时 MUST 发出降级安全诊断。非字符串 metadata key、不受支持数组 key 的非字符串 metadata 值以及非法数组元素是非法的官方 metadata 形状，MUST 拒绝该 manifest。

受治理行为 MUST 派生自受治理的 descriptor 字段和带类型的 Skill metadata。Capability 治理、Agent assembly、model 选择、路由、policy、sandbox、prompt 渲染、prompt shaping、owner scope、secret 解析、provider 配置、tool 约束和可用性 MUST 消费受治理的 descriptor 字段和带类型的 Skill metadata，而不是未知 metadata。

#### Scenario: 未知 metadata 被保留为 source metadata

- **WHEN** 一个 Skill manifest 包含未知 metadata key
- **THEN** 受治理行为 MUST 保持派生自受治理的 descriptor 字段和带类型的 Skill metadata
- **AND** 安全的未知字符串 metadata MUST 被保留为 source metadata
- **AND** 安全的数组 metadata 仅对 `exclusiveWith`、`compatibleWith` 和 `tags` MUST 被保留为 source metadata
- **AND** 不安全或不可解析的未知 metadata MUST 从 Skill metadata 中省略，并以降级安全诊断报告

#### Scenario: 治理决策消费 descriptor metadata

- **WHEN** 一个 Skill manifest 包含未知 metadata key
- **THEN** 治理决策输入 MUST 包含受治理的 descriptor 字段、带类型的 Skill metadata 和安全诊断
- **AND** capability 可见性、可用性、调用、路由、model 选择、prompt shaping、sandbox 行为、owner scope、policy 和 Agent assembly MUST 派生自受治理的 descriptor 字段和带类型的 Skill metadata
