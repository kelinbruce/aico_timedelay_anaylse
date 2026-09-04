## Function

- **所属 Function**：`FN-5.10 访问技能资源`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: SKILL.md 必须保持为内部正文来源

系统 MUST 把 governed Skill 的 canonical `SKILL.md` 作为 Skill 正文加载和一致性校验的内部来源，MUST NOT 把该文件作为模型可读附属资源写入或暴露在 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` projection subtree 中。模型可读 Skill projection MUST 只包含来源在 `scripts/`、`references/`、`assets/` 或 `api/` 下且通过既有资源安全校验的附属资源。

当 Skill 没有符合条件的附属资源时，系统 MUST 将模型可读附属资源数量判定为零，并 MUST NOT 向模型披露该 Skill 的 resource root。`Glob`、`Read` 和 sandbox 对已披露 projection subtree 的既有只读、scope 和安全校验保持不变。

**需求类别**：功能性需求

#### Scenario: SKILL.md 不进入模型可读 projection

- **GIVEN** governed Skill 包含 canonical `SKILL.md`
- **WHEN** 系统为该 Skill 建立模型可读资源 projection
- **THEN** projection subtree MUST NOT 包含 `SKILL.md`
- **AND** `Glob` 或 `Read` MUST NOT 通过该 projection subtree 枚举或读取 canonical `SKILL.md`

#### Scenario: 符合条件的附属资源仍然可访问

- **GIVEN** governed Skill 包含通过既有资源安全校验的 `scripts/query.py` 和 `references/guide.md`
- **WHEN** 该 Skill 成功加载
- **THEN** 模型可读 projection MUST 包含这两个附属资源
- **AND** 系统 MUST 向模型披露对应 Skill resource root
- **AND** 已披露附属资源 MUST 继续服从既有只读、scope 和路径安全校验

#### Scenario: 只有 SKILL.md 时没有可披露资源根

- **GIVEN** governed Skill 只有 canonical `SKILL.md` 且没有符合条件的附属资源
- **WHEN** 该 Skill 成功加载
- **THEN** 模型可读附属资源数量 MUST 为零
- **AND** 系统 MUST NOT 向模型披露 Skill resource root

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：技能正文与附属资源形成明确边界；`SKILL.md` 只提供正文，模型可读 projection 只提供通过安全校验的附属资源。
- **依据 Requirements**：`SKILL.md 必须保持为内部正文来源`

### 输出

- **变更类型**：修改
- **目标内容**：存在符合条件的附属资源时输出其只读 resource root；只有 `SKILL.md` 时不输出可供模型探索的资源根。
- **依据 Requirements**：`SKILL.md 必须保持为内部正文来源`

### 结果

- **变更类型**：修改
- **目标内容**：模型可以访问正文明确需要的附属资源，但不能通过 Skill projection 重复读取 canonical `SKILL.md`。
- **依据 Requirements**：`SKILL.md 必须保持为内部正文来源`
