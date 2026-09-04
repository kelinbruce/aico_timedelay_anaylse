## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Grep 结果按实际模式生成有界安全投影

当 Web channel 投影 `capabilityId="Grep"` 的成功结果时，可信后端共享 projector MUST 校验 canonical result 的 `output_mode` 与模式专属字段，并 MUST 按实际模式生成闭合集合内的 `safeSummaryCode`、白名单化 `safeSummaryArgs` 和可选 `safeResult`。local、immersive、collaborative 三种宿主以及 live stream、run event history MUST 使用同一投影结果。浏览器 MUST NOT 从原始 Capability result、调用参数、普通消息或本地缓存推断模式或补充被投影删除的字段。

`SUMMARY` 的穷尽映射如下：

| `output_mode` | `safeSummaryCode` | `safeSummaryArgs` 必填字段 |
|---|---|---|
| `files_with_matches` | `CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES` | `totalFilesWithMatches`、`truncated` |
| `content` | `CAPABILITY_RESULT_GREP_CONTENT_MATCHES` | `totalMatches`、`totalFilesWithMatches`、`truncated` |

两个总数字段 MUST 为非负整数，`truncated` MUST 为 boolean，且 `safeSummaryArgs.truncated` MUST 等于 canonical result 的 `truncated`。`SUMMARY` MUST NOT 携带 `safeResult`、文件路径、行号、匹配行、pattern 或 glob filter。零匹配 MUST 使用与实际 `output_mode` 对应的同一个 summary code 和数值为 `0` 的计数，浏览器 MUST 将其解释为合法完成但没有匹配。

当 canonical result 通过模式专属 schema 且有效呈现级别为 `DETAIL` 时，投影 MUST 在摘要基础上增加一个 `kind="grepResult"` 的 `safeResult`。该对象 MUST 恰好匹配以下两个 variant 之一，未知字段 MUST 被拒绝：

- 文件模式 variant：必填 `kind="grepResult"`、`outputMode="files_with_matches"`、非负整数 `totalFilesWithMatches`、非负整数 `totalMatches`、boolean `truncated` 和 `filenames`；`filenames` MUST 是最多 50 个非空 execution-view-relative 规范化逻辑路径组成的有序数组。
- 内容模式 variant：必填 `kind="grepResult"`、`outputMode="content"`、非负整数 `totalFilesWithMatches`、非负整数 `totalMatches`、boolean `truncated` 和 `locations`；`locations` MUST 是最多 50 个条目的有序数组，每个条目恰好包含非空 execution-view-relative `filePath` 与不小于 `1` 的整数 `lineNumber`。

只要 canonical result 的 `truncated=true` 或 projector 因 50 个条目上限省略至少一个条目，`safeResult.truncated` MUST 为 `true`；两种情况都不成立时 MUST 为 `false`。任一呈现级别的投影 MUST NOT 携带匹配行正文、文件正文、pattern、glob filter、物理路径、调用参数、credential 或 token。缺少 `output_mode`、模式未知、模式与字段不一致、总数非法或任一将进入 `DETAIL` 的路径条目未通过安全 schema 时，平台安全上限 MUST 降为 `STATUS_ONLY`，系统 MUST NOT 根据其他字段猜测或修复结果。

**需求类别**：系统质量属性
**质量属性**：安全、性能/容量
**适用范围**：该 Function

#### Scenario: 文件模式摘要只显示文件计数
- **GIVEN** Grep canonical result 通过文件模式 schema 且 `output_mode="files_with_matches"`
- **WHEN** 有效呈现级别为 `SUMMARY`
- **THEN** 投影 MUST 使用 `CAPABILITY_RESULT_GREP_FILES_WITH_MATCHES`
- **AND** `safeSummaryArgs` MUST 只包含 `totalFilesWithMatches` 与 `truncated`
- **AND** 投影 MUST NOT 携带 `safeResult`、文件路径或匹配正文

#### Scenario: 内容模式摘要显示匹配和文件计数
- **GIVEN** Grep canonical result 通过内容模式 schema 且 `output_mode="content"`
- **WHEN** 有效呈现级别为 `SUMMARY`
- **THEN** 投影 MUST 使用 `CAPABILITY_RESULT_GREP_CONTENT_MATCHES`
- **AND** `safeSummaryArgs` MUST 只包含 `totalMatches`、`totalFilesWithMatches` 与 `truncated`
- **AND** 投影 MUST NOT 携带 `safeResult`、行号或匹配正文

#### Scenario: 内容模式详情只增加路径和行号
- **GIVEN** Grep canonical result 通过内容模式 schema 且包含 75 个安全匹配条目
- **WHEN** 有效呈现级别为 `DETAIL`
- **THEN** `safeResult` MUST 携带 `kind="grepResult"` 与 `outputMode="content"`
- **AND** `locations` MUST 按 canonical result 顺序包含前 50 个路径与行号条目
- **AND** `safeResult.truncated` MUST 为 `true`
- **AND** 投影 MUST NOT 携带任一匹配行正文

#### Scenario: 文件模式详情只增加有界文件路径
- **GIVEN** Grep canonical result 通过文件模式 schema 且包含 2 个安全文件路径
- **WHEN** 有效呈现级别为 `DETAIL`
- **THEN** `safeResult` MUST 携带 `kind="grepResult"` 与 `outputMode="files_with_matches"`
- **AND** `filenames` MUST 按 canonical result 顺序包含这 2 个文件路径
- **AND** 投影 MUST NOT 携带行号、匹配行正文或 `locations`

#### Scenario: 零匹配摘要保留内容模式
- **GIVEN** Grep canonical result 携带 `output_mode="content"` 且两个总数都为 `0`
- **WHEN** 有效呈现级别为 `SUMMARY` 或 `DETAIL`
- **THEN** 投影 MUST 使用 `CAPABILITY_RESULT_GREP_CONTENT_MATCHES`
- **AND** 浏览器 MUST 显示内容搜索合法完成但没有匹配的本地化语义
- **AND** 系统 MUST NOT 把该结果显示为失败结果或文件模式结果

#### Scenario: 旧结果缺少模式时安全降级
- **GIVEN** live 或 history 中的 Grep 成功结果缺少 `output_mode`
- **WHEN** 可信后端生成用户可见投影
- **THEN** 有效呈现级别 MUST 为 `STATUS_ONLY`
- **AND** 投影 MUST NOT 携带摘要、`safeResult`、详情文本或内容
- **AND** 浏览器 MUST NOT 从空数组或非空数组推断模式

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：Grep 成功步骤按实际输出模式提供语言中立安全摘要；详情级别最多增加 50 个文件路径，内容模式条目同时包含行号。
- **依据 Requirements**：`Grep 结果按实际模式生成有界安全投影`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统校验 Grep canonical result 的显式模式与模式专属字段后生成统一 live/history 投影；无有效模式时安全降为仅状态。
- **依据 Requirements**：`Grep 结果按实际模式生成有界安全投影`

### 结果

- **变更类型**：修改
- **目标内容**：三种宿主对同一 Grep 成功事实显示相同摘要、详情边界和安全降级结果，浏览器不从原始结果补充信息。
- **依据 Requirements**：`Grep 结果按实际模式生成有界安全投影`

### 规格

- **规格项**：Grep 详情安全条目上限
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：每个 Grep `DETAIL` 投影最多 50 个文件路径或“文件路径与 1-based 行号”条目
- **依据 Requirements**：`Grep 结果按实际模式生成有界安全投影`
