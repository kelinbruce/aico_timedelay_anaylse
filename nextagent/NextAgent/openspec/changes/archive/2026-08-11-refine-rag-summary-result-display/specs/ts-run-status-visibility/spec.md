## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: RAG SUMMARY 结果展示保持安全且可核验

当可信后端确认 `capabilityId=Rag`、结果状态为成功且其有效呈现级别为 `SUMMARY` 时，系统 MUST 在现有 RAG 摘要之外返回 `safeResult`。该 `safeResult` MUST 只包含既有 RAG 安全投影的 `kind="ragRetrieval"`、`totalCount` 和至多 50 个按召回顺序排列的 item。每个 item MUST 只包含安全来源显示名、来源缺失标记、有界内容预览和截断标记。该 Requirement 是 `SUMMARY` 不返回通用 `safeResult` 规则的唯一 RAG 特例。

系统 MUST 使用同一可信后端投影在 SSE、WebSocket、live run-event history 与刷新后的 run-event history 中产生该结果。浏览器 MUST 使用该 `safeResult` 渲染 RAG 条数、来源和预览，且 MUST NOT 从原始 Capability Result Message、工具参数、timeline payload 或本地状态补充字段。

系统 MUST NOT 在此特例中返回绝对路径、工作区根目录、provider-private 字段、`provenance`、分数、原始完整内容、原始查询、诊断或任意未白名单字段。RAG 失败、空的安全投影、`STATUS_ONLY`、`DETAIL` 以外的非 RAG Capability 和未知/自定义 Capability MUST 继续遵守既有呈现策略，且 MUST NOT 因本 Requirement 获得额外结果字段。

**需求类别**：系统质量属性

**质量属性**：安全、性能/容量、可靠性/恢复
**适用范围**：该 Function

#### Scenario: 默认 RAG SUMMARY 展示来源和预览

- **GIVEN** 一个成功的 `Rag` 结果包含 3 条受支持的召回结果
- **AND** 启动期策略将 `Rag` 的有效呈现级别确定为 `SUMMARY`
- **WHEN** 用户在任一浏览器宿主查看该 RAG 步骤
- **THEN** 后端 MUST 返回 `safeSummaryCode=CAPABILITY_RESULT_RAG_RETRIEVAL` 与 `totalCount=3`
- **AND** 后端 MUST 返回包含 3 个按召回顺序排列 item 的 `safeResult`
- **AND** 界面 MUST 显示召回条数、每个安全来源名称和各自的有界内容预览

#### Scenario: RAG SUMMARY 不泄露原始检索字段

- **GIVEN** 一个成功的 `Rag` 结果包含绝对 source path、`provenance`、分数、provider 诊断和超长内容
- **AND** 启动期策略将 `Rag` 的有效呈现级别确定为 `SUMMARY`
- **WHEN** 系统生成用户可见的结果投影
- **THEN** `safeResult` MUST 只包含既有 RAG 安全投影白名单字段和其既有截断结果
- **AND** 浏览器 payload MUST NOT 包含绝对路径、`provenance`、分数、provider 诊断或被截断内容的剩余部分

#### Scenario: 非 RAG SUMMARY 不获得详情字段

- **GIVEN** 一个 `Read` 成功结果的有效呈现级别为 `SUMMARY`
- **WHEN** 系统生成用户可见的结果投影
- **THEN** 该投影 MUST 继续不包含 `safeResult`
- **AND** 系统 MUST NOT 因 RAG 特例改变其他 Capability 的 `SUMMARY` 行为

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：RAG 成功结果在 `SUMMARY` 级别输出计数摘要以及有界、安全的来源名称和内容预览；其他 Capability 的 `SUMMARY` 输出保持不变。
- **依据 Requirements**：`RAG SUMMARY 结果展示保持安全且可核验`

### 规格

- **规格项**：RAG 默认摘要展示
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：成功 RAG `SUMMARY` 结果显示总条数及至多 50 条安全来源名称和有界内容预览。
- **依据 Requirements**：`RAG SUMMARY 结果展示保持安全且可核验`
