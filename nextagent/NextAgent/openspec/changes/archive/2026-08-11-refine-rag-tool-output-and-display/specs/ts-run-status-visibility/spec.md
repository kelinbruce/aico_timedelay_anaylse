## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: RAG 检索结果具有可展示的安全摘要
当 Web channel 或前端历史重建处理 `capabilityId="Rag"` 的成功 `CAPABILITY_RESULT` 时，系统 MUST 从结果数组生成 `kind="ragRetrieval"` 的安全展示摘要。摘要 MUST 包含 `totalCount` 和按原始结果顺序出现的 `items`。每个 `items` 条目 MUST 包含 `displaySource`、`sourceMissing`、来自字符串 `content` 的 `contentPreview` 和 `contentTruncated`。有可显示字符串 `source` 的条目 MUST 使用其来源名称作为 `displaySource` 并将 `sourceMissing` 设为 `false`。

系统 MUST 根据原始 `content` 中汉字与拉丁字母的数量确定预览上限：汉字数量大于拉丁字母数量时，`contentPreview` MUST 最多包含前 40 个 Unicode code point；其他内容 MUST 最多包含前 100 个 Unicode code point。原始内容超出其适用上限时，`contentTruncated` MUST 为 `true`，否则 MUST 为 `false`。缺少可显示字符串 `source` 的结果 MUST 计入 `totalCount` 并生成 `sourceMissing=true` 的 `items` 条目，其 `displaySource` MUST 为空字符串。缺少字符串 `content` 的结果，其 `contentPreview` MUST 为空字符串且 `contentTruncated` MUST 为 `false`。摘要 MUST NOT 包含完整 `content`、`provenance`、`score`、`rankHint`、诊断对象或其他原始结果字段。

实时 stream 投影与历史重建 MUST 为同一 RAG 结果生成同形摘要。过程面板 MUST 显示召回总数、每个 `displaySource` 及其 `contentPreview`；`sourceMissing=true` 的条目 MUST 显示本地化的来源缺失标签。仅当 `contentTruncated` 为 `true` 时，过程面板 MUST 在预览末尾追加 `...`。

#### Scenario: 中文主导内容按 40 字符截断
- **WHEN** 成功 RAG 结果的 `content` 中汉字数量大于拉丁字母数量，且内容超过 40 个 Unicode code point
- **THEN** 对应 `contentPreview` MUST 只包含前 40 个 Unicode code point
- **AND** 对应 `contentTruncated` MUST 为 `true`

#### Scenario: 英文主导内容按 100 字符截断
- **WHEN** 成功 RAG 结果的 `content` 中拉丁字母数量不少于汉字数量，且内容超过 100 个 Unicode code point
- **THEN** 对应 `contentPreview` MUST 只包含前 100 个 Unicode code point
- **AND** 对应 `contentTruncated` MUST 为 `true`

#### Scenario: 缺少来源的结果显示占位标签
- **WHEN** 成功 RAG 结果包含两条结果，其中一条没有字符串 `source`
- **THEN** `totalCount` MUST 为 `2`
- **AND** 摘要 MUST 包含两条 `items`，缺少来源的条目 MUST 标记 `sourceMissing=true`
- **AND** 过程面板 MUST 显示可用来源名称和本地化的来源缺失标签

### Requirement: RAG 过程详情以来源标签和单行预览呈现
当过程面板呈现 `ragRetrieval` 安全展示摘要时，系统 MUST 将每个 `displaySource` 渲染为与内容预览视觉分离的紧凑来源标签。系统 MUST 将 `contentPreview` 中连续的空白字符（包括换行和空行）替换为单个空格并去除首尾空白后再展示。`contentTruncated=true` 时，系统 MUST 仅在归一化后的预览末尾追加 `...`。

#### Scenario: 来源与多行预览分离展示
- **WHEN** 一个 RAG 摘要项包含 `displaySource="rag-upf-timeout.md"`，且其 `contentPreview` 包含换行或空行
- **THEN** 过程面板 MUST 将 `rag-upf-timeout.md` 呈现为独立来源标签
- **AND** 过程面板 MUST 将预览呈现为单行文本，换行或空行之间以单个空格分隔

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：会话流中的成功 RAG 检索结果提供只含召回数量、来源名称和按语言限制的内容预览的展示摘要，实时与历史呈现一致。
- **依据 Requirements**：`RAG 检索结果具有可展示的安全摘要`、`RAG 过程详情以来源标签和单行预览呈现`
