## Function

- **所属 Function**：`FN-5.9 调用技能`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Skill Content 不实施认证与凭据值检查

已授权 Skill 的 canonical markdown body 属于 Skill Content。系统 MUST NOT 因 Skill Content 包含 Auth、Authorization、Token、Credential、Password、Secret 或 API key 术语、字段名、示例和值而拒绝加载、改写正文或降级执行结果。Skill Content 中的这些内容 MUST 原样进入已授权的 `<skill_content>` hidden generated context。

本 Requirement 不改变 source-private credential ref 的禁止披露规则。系统仍 MUST 执行来源授权、canonical body 提取、descriptor/body 一致性、预期文本编码、正文非空、控制字符、inline body size budget、wrapper-boundary breakout，以及 source-private ref、受保护 raw host path 和 package layout 泄漏检查；这些检查 MUST NOT 把 Skill Content 中的认证或凭据文本本身解释为 source-private fact。`/tmp/` 属于允许在 Skill Content 中表达的常见业务目录，MUST NOT 仅因该路径文本被解释为受保护 raw host path。

**需求类别**：系统质量属性

**质量属性**：安全、可维护性、可测试性
**适用范围**：该 Function

#### Scenario: Skill Content 保留认证与凭据内容

- **WHEN** 已授权 Skill 的 canonical markdown body 包含 Auth、Authorization、Token、Credential、Password、Secret 或 API key 术语、字段名、示例或值
- **THEN** 系统 MUST 成功加载通过其他既有边界检查的 Skill Content
- **AND** hidden generated context 中的 `<skill_content>` MUST 保留原始正文
- **AND** 系统 MUST NOT 仅因这些认证或凭据内容返回 safe failure

#### Scenario: 非凭据内容边界检查保持生效

- **WHEN** Skill Content 同时包含认证或凭据内容与 wrapper-boundary breakout、控制字符、超出 inline body size budget、raw host path、source-private ref 或 package layout 泄漏中的至少一种
- **THEN** 系统 MUST 按对应的既有非凭据内容边界返回 safe failure
- **AND** 认证或凭据内容 MUST NOT 覆盖该失败结果

#### Scenario: Skill Content 保留 `/tmp/` 业务目录

- **WHEN** 已授权 Skill 的 canonical markdown body 包含 `/tmp/` 路径，且不包含其他边界违规内容
- **THEN** 系统 MUST 成功加载 Skill Content
- **AND** hidden generated context 中的 `<skill_content>` MUST 保留 `/tmp/` 路径原文

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在调用已授权 Skill 时校验来源、正文结构和注入边界；认证与凭据文本作为 Skill Content 原样加载，不构成额外拒绝条件。
- **依据 Requirements**：`Skill Content 不实施认证与凭据值检查`

### 结果

- **变更类型**：修改
- **目标内容**：通过其他既有边界检查的 Skill Content 正常返回加载结果；认证与凭据文本不再单独产生 safe failure，非凭据边界违规仍安全失败。
- **依据 Requirements**：`Skill Content 不实施认证与凭据值检查`
