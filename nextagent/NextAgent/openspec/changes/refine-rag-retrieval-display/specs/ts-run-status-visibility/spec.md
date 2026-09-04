## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: RAG 检索结果具有可展示的安全摘要

系统 MUST 为通过既有 RAG 安全 schema 的成功结果生成语言中立召回数量摘要。`SUMMARY` MUST 只携带既有 `safeSummaryCode` 和只含 `totalCount` 的白名单化 `safeSummaryArgs`，MUST NOT 携带 `safeResult`、来源、内容、`provenance`、`score`、`rankHint`、诊断或其他原始字段。

**需求类别**：功能性需求

有效级别为 `DETAIL` 时，系统 MUST 在数量摘要基础上生成 `kind="ragRetrieval"` 安全详情。该详情 MUST 包含 `totalCount` 和按原始结果顺序排列、最多 50 项的 `items`。每个 `items` 条目 MUST 包含按以下顺序派生的 `source`：优先取原始结果 `source` 字段按 `|` 分割的首段并去除首尾空白；该段为空时 MUST 回退到原始结果 `title` 字段去除首尾空白；`title` 缺失或为空时 MUST 回退到原始结果 `content` 字段去除首尾空白后的文本，文本超过 256 个字符时 MUST 截断为前 256 个字符并在末尾追加 `...`，不超过 256 个字符时 MUST 使用完整文本；三者均缺失或为空时 MUST 为空字符串。每个 `items` 条目 MUST 包含来自原始结果 `content` 字段的完整字符串 `content`。缺少字符串 `content` 的结果 MUST 生成 `content` 为空字符串的 `items` 条目。摘要 MUST NOT 包含 `provenance`、`score`、`rankHint`、诊断对象或其他原始结果字段；也 MUST NOT 包含 `displaySource`、`sourceMissing`、`contentPreview` 或 `contentTruncated` 等后端派生字段。展示截断和弹窗渲染 MUST 由前端负责。

实时 stream 投影与历史重建 MUST 为同一 RAG 结果生成同形摘要。过程面板 MUST 显示召回总数；`source` 为空字符串的条目 MUST 在前端显示本地化的来源缺失标签。

#### Scenario: RAG SUMMARY 只显示召回数量

- **GIVEN** 集成规则把 `Rag` 精确配置为 `SUMMARY`
- **AND** RAG 结果通过既有安全 schema 且召回 3 项
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 包含召回数量 3 的语言中立摘要语义
- **AND** 投影 MUST NOT 包含 `safeResult`、来源或内容

#### Scenario: RAG DETAIL 按 `|` 分割 source 取首段并发送完整 content

- **GIVEN** `Rag` 的有效级别为 `DETAIL`
- **AND** RAG 结果包含一项，其 `source` 为 `docs|alarm.md`，`content` 为超过 100 个字符的文本
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 包含 `ragRetrieval` safe result
- **AND** items 条目 MUST 包含 `source: "docs"`（按 `|` 分割取首段）
- **AND** items 条目 MUST 包含完整 `content`（不截断）
- **AND** items 条目 MUST NOT 包含 `displaySource`、`sourceMissing`、`contentPreview` 或 `contentTruncated`
- **AND** 投影 MUST NOT 包含 `provenance` 或 `score`

#### Scenario: source 为空时回退 title

- **GIVEN** `Rag` 的有效级别为 `DETAIL`
- **AND** RAG 结果包含一项，其 `source` 为空字符串、`title` 为 `fallback-title`
- **WHEN** 系统生成用户可见投影
- **THEN** items 条目 MUST 包含 `source: "fallback-title"`

#### Scenario: source 与 title 均为空时回退 content 前 256 个字符并追加省略号

- **GIVEN** `Rag` 的有效级别为 `DETAIL`
- **AND** RAG 结果包含一项，其 `source` 为空字符串且没有 `title`，`content` 去除首尾空白后长度超过 256 个字符
- **WHEN** 系统生成用户可见投影
- **THEN** items 条目 MUST 包含 `source` 为 `content` 去除首尾空白后的前 256 个字符并在末尾追加 `...`
- **AND** items 条目 MUST 仍包含完整 `content`（不受该 256 字符截断影响）

#### Scenario: source、title 与 content 均缺失的条目计入总数

- **WHEN** 成功 RAG 结果包含两条结果，其中一条没有字符串 `source`、`title` 和 `content`
- **THEN** `totalCount` MUST 为 `2`
- **AND** 摘要 MUST 包含两条 `items`，全缺失的条目 MUST 包含 `source: ""` 和 `content: ""`

#### Scenario: RAG DETAIL 复用既有来源和预览

- **GIVEN** `Rag` 的有效级别为 `DETAIL`
- **WHEN** 系统生成用户可见投影
- **THEN** 投影 MUST 只包含本需求定义的白名单字段和容量边界生成的 `ragRetrieval` safe result
- **AND** 系统 MUST NOT 在本需求定义之外增加任何新的原始检索字段或更大的容量边界

#### Scenario: RAG 非法结果继续安全降级

- **GIVEN** RAG 结果没有通过既有安全 schema
- **WHEN** 系统生成用户可见投影
- **THEN** 平台安全上限 MUST 降为 `STATUS_ONLY`
- **AND** 浏览器 MUST NOT 从原始结果补建数量、来源或内容

### Requirement: RAG 过程详情以来源标签和单行预览呈现

当过程面板呈现 `ragRetrieval` 安全展示摘要时，系统 MUST 将每个 `items` 条目的 `source` 字段按 `|` 分割、去除首尾空白后取第一部分作为 `displaySource`；结果为空时系统 MUST 显示本地化的来源缺失标签。系统 MUST 将每个条目渲染为独立的可点击来源标签；标签文本超过 512 个字符时 MUST 截断为前 512 个字符并在末尾追加 `...`，悬停 Tooltip MUST 显示完整 `displaySource`。

**需求类别**：功能性需求

点击来源标签 MUST 弹出 Modal 弹窗，弹窗内 MUST 以 Markdown 格式渲染该条目的完整 `content`。过程面板 MUST NOT 将 `content` 以内联预览文本形式拼入来源标签展示区域；完整 `content` 仅通过弹窗呈现。

#### Scenario: 来源按管道符分割取首段

- **WHEN** 一个 RAG 摘要项包含 `source: "knowledge-base|alarm|upf-timeout.md"`
- **THEN** 过程面板 MUST 将 `knowledge-base` 呈现为来源标签

#### Scenario: 来源标签超过 512 字符时截断并追加省略号

- **WHEN** 一个 RAG 摘要项的 `displaySource` 长度超过 512 个字符
- **THEN** 过程面板 MUST 只展示前 512 个字符
- **AND** 过程面板 MUST 在标签末尾追加 `...`

#### Scenario: 悬停显示完整来源标签

- **WHEN** 用户将鼠标悬停在来源标签上
- **THEN** 系统 MUST 显示 Tooltip
- **AND** Tooltip MUST 包含完整 `displaySource`

#### Scenario: 点击来源标签弹出 Markdown 弹窗

- **WHEN** 用户点击来源标签
- **THEN** 系统 MUST 弹出 Modal 弹窗
- **AND** 弹窗内 MUST 以 Markdown 格式渲染完整 `content`

#### Scenario: 来源与多行预览分离展示

- **WHEN** 一个 RAG 摘要项的来源标签为 `rag-upf-timeout.md`，且其 `content` 包含换行或空行
- **THEN** 过程面板 MUST 将 `rag-upf-timeout.md` 呈现为独立来源标签
- **AND** 过程面板 MUST NOT 将 `content` 以内联单行预览文本形式拼入来源标签展示区域
- **AND** 弹窗内 MUST 以 Markdown 格式渲染保留原始换行结构的完整 `content`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：RAG DETAIL safe result items 改为发送原始 `source` 和完整 `content`，前端负责来源分割、来源标签 512 字符截断、悬停 Tooltip 显示完整 `displaySource` 和点击弹窗 Markdown 渲染完整 `content`。
- **依据 Requirements**：`RAG 检索结果具有可展示的安全摘要`、`RAG 过程详情以来源标签和单行预览呈现`

### 处理过程

- **变更类型**：修改
- **目标内容**：后端 shared projector 直接输出 `{ source, content }`，不再做 basename 截取和 code point 截断；前端 guard 仅做 string 类型校验；前端 projection 按 `|` 分割取首段；前端 render 做来源标签 512 字符截断、Tooltip 和 Modal，不渲染内联 `content` 预览。
- **依据 Requirements**：`RAG 检索结果具有可展示的安全摘要`、`RAG 过程详情以来源标签和单行预览呈现`

### 结果

- **变更类型**：修改
- **目标内容**：RAG DETAIL items 包含 `{ source, content }`；前端展示可点击来源标签（超过 512 字符截断 + `...`、Tooltip 显示完整 `displaySource`），点击弹窗以 Markdown 渲染完整 `content`，无内联 `content` 预览。SUMMARY 继续只返回召回数量。
- **依据 Requirements**：`RAG 检索结果具有可展示的安全摘要`、`RAG 过程详情以来源标签和单行预览呈现`

### 规格

- **规格项**：RAG DETAIL safe result items 字段
- **变更类型**：修改
- **原规格值**：`{ displaySource, sourceMissing, contentPreview, contentTruncated }`，contentPreview 最多 40/100 Unicode code point
- **目标规格值**：`{ source, content }`，source 为原始字符串，content 为完整字符串，前端负责展示截断
- **依据 Requirements**：`RAG 检索结果具有可展示的安全摘要`

### 主规格

- **变更类型**：修改
- **目标内容**：`ts-run-status-visibility`
- **依据 Requirements**：`RAG 检索结果具有可展示的安全摘要`、`RAG 过程详情以来源标签和单行预览呈现`
