## Function

- **所属 Function**：`FN-5.4 搜索文件`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Grep 成功结果显式携带实际输出模式

Grep 的每个成功结果 MUST 包含必填、非空的 `output_mode` 字段。`output_mode` MUST 为 `files_with_matches` 或 `content`，并 MUST 等于本次执行实际采用的输出模式；字段没有 default，结果对象 MUST 拒绝未知字段。零匹配结果 MUST 携带实际 `output_mode`，任何消费方 MUST NOT 根据 `filenames`、`matches`、计数字段或其空值组合推断输出模式。

当 `output_mode="files_with_matches"` 时，`filenames` MUST 包含本次返回的规范化 execution-view-relative 匹配文件路径，`matches` MUST 为空数组。当 `output_mode="content"` 时，`matches` MUST 包含本次返回的内容匹配项，`filenames` MUST 为空数组。两种模式都 MUST 返回非负整数 `total_files_with_matches`、非负整数 `total_matches` 和 boolean `truncated`。

**需求类别**：功能性需求

#### Scenario: 文件模式成功结果自描述模式
- **WHEN** Grep 以 `output_mode="files_with_matches"` 完成搜索
- **THEN** 结果 MUST 携带 `output_mode="files_with_matches"`
- **AND** 结果 MUST 携带 `filenames`、空 `matches`、两个总数和 `truncated`

#### Scenario: 内容模式成功结果自描述模式
- **WHEN** Grep 以 `output_mode="content"` 完成搜索
- **THEN** 结果 MUST 携带 `output_mode="content"`
- **AND** 结果 MUST 携带 `matches`、空 `filenames`、两个总数和 `truncated`

#### Scenario: 零匹配仍保留实际模式
- **GIVEN** Grep 搜索合法完成且没有匹配
- **WHEN** 系统生成成功结果
- **THEN** 结果 MUST 携带本次执行实际采用的 `output_mode`
- **AND** `filenames` 与 `matches` MUST 都为空数组
- **AND** `total_files_with_matches` 与 `total_matches` MUST 都为 `0`
- **AND** 消费方 MUST NOT 把该成功结果解释为失败结果

#### Scenario: 缺少模式的结果不能通过输出校验
- **WHEN** Grep executor 返回缺少 `output_mode`、携带未知模式或同时在非当前模式数组中返回条目的结果
- **THEN** 结果 MUST 以安全的 Capability output validation failure 失败
- **AND** 系统 MUST NOT 把该对象发布为 Grep 成功结果

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：Grep 成功结果显式返回 `files_with_matches` 或 `content` 实际输出模式及与该模式一致的匹配集合和总数；合法零匹配仍保留实际模式。
- **依据 Requirements**：`Grep 成功结果显式携带实际输出模式`

### 规格

- **规格项**：Grep 成功结果输出模式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：必填 `output_mode`，精确取值为 `files_with_matches`、`content`
- **依据 Requirements**：`Grep 成功结果显式携带实际输出模式`
