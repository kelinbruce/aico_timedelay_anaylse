## MODIFIED Requirements

### Requirement: RecipeDefinition

`RecipeDefinition` MUST 在现有字段基础上新增可选的业务分类字段：

- `domain?: string`——业务域（如 `fault-diagnosis`/`config-audit`/`performance-analysis`）
- `scene?: string`——场景（如 `alarm-location`/`config-check`）
- `lang?: string`——语言（如 `zh`/`en`）

`domain`/`scene` MUST 使用独立自由文本 schema（`Type.String({ minLength: 1, maxLength: 512 })`，无 pattern 约束），与 1.0 DSL 规范一致（1.0: 域/场景最长 512，自由文本，允许中文）。`lang` MUST 使用枚举 schema（`zh`/`en`）。三个字段均为可选，默认 `undefined`。

`agentName` MUST NOT 作为 `RecipeDefinition` 的独立字段；recipe 的 agent 归属由加载目录 `agents/{agentId}/recipes/` 决定，`agentId` 等同于 `agentName`。

`expandFields` MUST NOT 重新引入；v1 `expandFields` 已由 `refine-ts-workflow-recipe-v2-contracts` 归入 `metadata`。

**流程接入：**
- 上游：recipe YAML 文件（`agents/{agentId}/recipes/`），由 `workflow-package` 的 `Local Recipe Loading` 解析
- 下游：`domain`/`scene`/`lang` 可被 `workflow-routing`(dispatch) 和 `workflow-orchestration-policy`(routing policy) 显式消费，用于按业务分类选择 recipe

**失败与降级：**
- `domain`/`scene` 长度超过 512 或 `lang` 不在 `zh`/`en` 枚举内 → schema 校验失败，recipe 被跳过（由 `Local Recipe Loading` 的 Invalid Recipe Skip 处理）
- 字段缺失不视为失败，三个字段默认 `undefined`

#### Scenario: Classification Fields Optional
- **WHEN** recipe YAML 不包含 `domain`/`scene`/`lang` 字段
- **THEN** 对应 `RecipeDefinition` 字段 MUST 为 `undefined`
- **AND** recipe MUST 仍通过 schema 校验

#### Scenario: Classification Fields Populated
- **WHEN** recipe YAML 包含 `domain: fault-diagnosis`、`scene: alarm-location`、`lang: zh`
- **THEN** `RecipeDefinition.domain` MUST 为 `"fault-diagnosis"`
- **AND** `RecipeDefinition.scene` MUST 为 `"alarm-location"`
- **AND** `RecipeDefinition.lang` MUST 为 `"zh"`
- **AND** `domain`/`scene` MUST 符合自由文本约束（最长 512，无 pattern）
- **AND** `lang` MUST 符合 `zh`/`en` 枚举约束

#### Scenario: Classification Field Length Exceeded
- **WHEN** recipe YAML 包含 `domain` 长度超过 512 字符
- **THEN** `RecipeDefinitionSchema` 校验 MUST 失败
- **AND** recipe MUST 被 loader 跳过

#### Scenario: Invalid Lang Value Rejected
- **WHEN** recipe YAML 包含 `lang: "fr"`（非 zh/en 枚举值）
- **THEN** `RecipeDefinitionSchema` 校验 MUST 失败
- **AND** recipe MUST 被 loader 跳过

#### Scenario: No AgentName Field
- **WHEN** `RecipeDefinitionSchema` 被校验
- **THEN** schema MUST NOT 包含 `agentName` 字段
- **AND** agent 归属 MUST 由加载目录决定，不在 recipe contract 中表达
