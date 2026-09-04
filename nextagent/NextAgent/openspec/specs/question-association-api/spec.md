# question-association-api Specification

## Purpose
This specification defines input association trigger behavior and the question association query API for input box autocomplete suggestions with source classification labels.

## Function

- **所属 Function**：`FN-1.18 输入联想`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## Requirements
### Requirement: 联想查询 API 端点

系统 SHALL 通过 Web channel 暴露只读 `GET /api/v1/question-association` 端点，返回当前 Agent Scope 和 Owner Scope下按关键词匹配的联想问题列表。端点 MUST 接受必填的 `keyword` 查询参数（trim 后非空）和可选的 `locale` 查询参数。端点 MUST NOT 接受 request body。端点 MUST NOT 修改任何持久化状态。

#### Scenario: 正常查询
- **WHEN** 客户端发送 `GET /api/v1/question-association?keyword=告警&locale=zh-CN`
- **THEN** 系统 MUST 返回 HTTP 200 和 `{ locale, questions }` JSON 响应
- **AND** `questions` 数组 MUST 按优先级排序且不超过 20 条

#### Scenario: keyword 为空
- **WHEN** 客户端发送 `GET /api/v1/question-association?keyword=`
- **THEN** 系统 MUST 返回 HTTP 400

#### Scenario: keyword 仅空白
- **WHEN** 客户端发送 `GET /api/v1/question-association?keyword=%20%20`
- **THEN** 系统 MUST 返回 HTTP 400

#### Scenario: 无匹配结果
- **WHEN** 关键词匹配不到任何问题
- **THEN** 系统 MUST 返回 HTTP 200 和 `{ locale, questions: [] }`

### Requirement: 联想结果来源标签

每条联想结果 MUST 包含 `text`（非空字符串）和 `source`（来源分类标签）字段。`source` MUST 为以下三个值之一：
- `"pinned"`：来自用户「添加到常问」的问题（DB `is_pinned=true`）
- `"high-frequency"`：来自高频问题（DB `ask_frequency > threshold`）
- `"static"`：来自静态注册问题（内存目录）

`source` 仅用于前端纯视觉展示，不承载交互语义。

#### Scenario: 响应 DTO shape
- **WHEN** 查询返回联想结果列表
- **THEN** 每个条目 MUST 包含 `text` 和 `source`
- **AND** `source` MUST 为 `"pinned"`、`"high-frequency"` 或 `"static"` 之一
- **AND** MUST NOT 包含 `hash`、`frequency`、`is_pinned`、`pinned_at` 或任何 DB 内部字段

### Requirement: 三层来源加载与排序

`FrequentQuestionService.listQuestionAssociations()` SHALL 按以下优先级加载和排序三层来源：
1. pinned 层：调用 `listPinned()`，按 `pinned_at DESC` 排序，MUST NOT 按 locale 过滤
2. high-frequency 层：调用 `listHighFrequency()`，按 `ask_frequency DESC` 排序，MUST NOT 按 locale 过滤
3. static 层：调用 `loadCatalog()`，按目录原始顺序排序（fixed 和非 fixed 合并），MUST 按 locale 过滤

static 层 SHALL 将 `fixed` 和非 `fixed` 静态问题合并为一层，不保持 fixed 优先。static 层内按目录原始顺序排列。

#### Scenario: 三层来源加载
- **WHEN** 查询联想结果
- **THEN** service MUST 依次加载 pinned、high-frequency、static 三层数据
- **AND** pinned 和 high-frequency MUST NOT 按 locale 过滤
- **AND** static MUST 按 locale 过滤

### Requirement: 关键词模糊匹配

系统 SHALL 对三层来源的每条问题文本做 case-insensitive 子串匹配：`text.toLowerCase().includes(keyword.toLowerCase())`。匹配在 service 层 in-memory 完成，MUST NOT 在 gateway 或 DB 层做 LIKE 查询。

#### Scenario: 子串匹配
- **WHEN** 关键词为 "告警"，问题文本为 "告警分析"
- **THEN** 该问题 MUST 被匹配

#### Scenario: 大小写无关
- **WHEN** 关键词为 "ALARM"，问题文本为 "Check Alarm Rules"
- **THEN** 该问题 MUST 被匹配

### Requirement: cap 级联填充策略

三层来源各设 cap：pinned=10、high-frequency=5、static=5。系统 SHALL 按以下级联策略填充至 top 20：
1. pinned 层取 `min(10, pinned_filtered.length)` 条
2. high-frequency 层取 `min(5, highfreq_filtered.length, remaining_after_pinned)` 条
3. static 层取 `min(5, static_filtered.length, remaining_after_freq)` 条
4. 若三层初次分配后仍有剩余 slot，按优先级从各层剩余匹配项回填：先 high-frequency 剩余，再 static 剩余
5. 总和不超过 20

#### Scenario: 各层匹配充足
- **WHEN** 三层匹配数均超过各自 cap（pinned > 10, high-freq > 5, static > 5）
- **THEN** 结果 MUST 为 10 pinned + 5 high-frequency + 5 static = 20 条

#### Scenario: pinned 匹配不足
- **WHEN** pinned 匹配 3 条，high-frequency 匹配 10 条，static 匹配 30 条
- **THEN** 结果 MUST 为 3 pinned + 5 high-frequency + 5 static + 7 回填（先 high-frequency 剩余 5，再 static 剩余 2）= 20 条

#### Scenario: 总匹配不足 20
- **WHEN** 三层总匹配数为 10
- **THEN** 结果 MUST 为全部 10 条，MUST NOT 凑数

### Requirement: 去重

三层来源合并时 MUST 按 `question_hash`（SHA-256 of trimmed text）去重。遍历顺序为 pinned → high-frequency → static，首次出现的 hash 记录其 source 标签，后续重复 hash 跳过。同一问题的 `source` 取最高优先级来源。

#### Scenario: 跨层去重
- **WHEN** 一条问题同时出现在 pinned 和 high-frequency 层
- **THEN** 结果中该问题 MUST 只出现一次
- **AND** `source` MUST 为 `"pinned"`

#### Scenario: static 与 high-frequency 重复
- **WHEN** 一条问题同时出现在 static 和 high-frequency 层
- **THEN** 结果中该问题 MUST 只出现一次
- **AND** `source` MUST 为 `"high-frequency"`

### Requirement: FrequentQuestionPort 扩展

`FrequentQuestionPort` SHALL 新增 `listQuestionAssociations(request, signal?)` 方法。Web channel MUST 通过该方法查询联想结果，MUST NOT 直接依赖 `agent-platform-gateway-local` 或 `agent-capability` 内部实现。Port 实现 MUST 接收 `AbortSignal`。

#### Scenario: Web channel 使用注入的 port
- **WHEN** Web channel 收到 `GET /api/v1/question-association` 请求
- **THEN** Web channel MUST 调用注入的 `FrequentQuestionPort.listQuestionAssociations()`
- **AND** MUST NOT 直接访问 DB store 或 discovery

### Requirement: 联想查询请求类型

`QuestionAssociationQuery` SHALL 包含 `tenantId`、`subjectId`、`agentId`（owner + agent scope）和必填的 `keyword`（非空字符串）及可选的 `locale`。

#### Scenario: 请求字段
- **WHEN** 构造联想查询请求
- **THEN** 请求 MUST 包含 `tenantId`、`subjectId`、`agentId`、`keyword`
- **AND** `keyword` MUST 为 trim 后非空字符串

### Requirement: 联想查询响应类型

`QuestionAssociationResult` SHALL 包含 `locale`（字符串）和 `questions`（数组）。`QuestionAssociationEntryDto` SHALL 包含 `text`（非空字符串）和 `source`（`"pinned" | "high-frequency" | "static"`）。

#### Scenario: 响应结构
- **WHEN** 查询返回联想结果
- **THEN** 响应 MUST 包含 `locale` 和 `questions`
- **AND** 每个 question 条目 MUST 包含 `text` 和 `source`

### Requirement: 联想面板触发规则

用户已登录时，系统 SHALL 在用户主动编辑消息输入框且 trim 后的文本非空、首字符不是 `/` 时启动输入联想；单次粘贴写入本身不属于本 Requirement 的主动文本编辑，系统 MUST NOT 仅因粘贴文本而发送 `GET /api/v1/question-association`。当查询返回非空结果且消息输入框仍保持焦点时，系统 MUST 显示联想面板，并且 MUST NOT 同时显示斜杠命令面板；结果返回前消息输入框已经失焦时，系统 MUST NOT 打开联想面板。系统 MUST 区分主动文本编辑与上下键历史回看：上下键把已提交消息回填到输入框时，系统 MUST NOT 为回填文本发送 `GET /api/v1/question-association`，MUST NOT 显示联想面板。进入历史回看时，系统 MUST 取消该输入框尚未发送或仍在执行的联想查询，已取消查询的迟到结果 MUST NOT 打开联想面板。用户编辑回看的文本后，系统 MUST 退出历史回看，并按主动文本编辑规则恢复输入联想。

**需求类别**：功能性需求

#### Scenario: 主动输入普通文本触发联想
- **WHEN** 用户主动输入“告警”，查询返回至少一条结果，并且结果返回时消息输入框仍保持焦点
- **THEN** 系统 MUST 显示联想面板
- **AND** 系统 MUST NOT 显示斜杠命令面板

#### Scenario: 单次粘贴文本不触发联想
- **WHEN** 用户把“告警”粘贴到消息输入框，并且没有继续编辑粘贴后的文本
- **THEN** 系统 MUST NOT 为粘贴文本发送 `GET /api/v1/question-association`
- **AND** 系统 MUST 保持联想面板关闭

#### Scenario: 输入框失焦后迟到结果不打开面板
- **WHEN** 用户主动输入普通文本并已发起联想查询，但在非空结果返回前使消息输入框失去焦点
- **THEN** 系统 MUST NOT 因该查询结果打开联想面板

#### Scenario: 输入斜杠命令不触发联想
- **WHEN** 用户输入“/he”
- **THEN** 系统 MUST 显示斜杠命令面板
- **AND** 系统 MUST NOT 查询或显示输入联想

#### Scenario: 输入为空不触发联想
- **WHEN** 输入框为空或 trim 后为空
- **THEN** 系统 MUST NOT 查询或显示输入联想
- **AND** 系统 MUST NOT 显示斜杠命令面板

#### Scenario: 上下键回看已提交消息不触发联想
- **WHEN** 用户按 `ArrowUp` 或 `ArrowDown`，输入框回填一条已提交消息
- **THEN** 系统 MUST NOT 为回填文本发送 `GET /api/v1/question-association`
- **AND** 系统 MUST 保持联想面板关闭

#### Scenario: 进入历史回看取消待处理查询
- **WHEN** 用户进入历史回看时，该输入框存在尚在 300ms debounce 等待期内或仍在执行的问题联想查询
- **THEN** 系统 MUST 取消待发送请求或终止在途请求
- **AND** 已取消查询之后返回的结果 MUST NOT 打开联想面板

#### Scenario: 编辑回看的文本后恢复联想
- **WHEN** 输入框正在显示一条已提交消息，用户对该文本进行实际编辑，编辑后的文本 trim 后非空且首字符不是 `/`
- **THEN** 系统 MUST 退出历史回看
- **AND** 系统 MUST 按主动文本编辑规则，在停止编辑 300ms 后发送联想查询
