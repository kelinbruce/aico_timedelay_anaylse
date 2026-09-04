## ADDED Requirements

### Requirement: 分类问题资源目录定位

系统 SHALL 通过 `AgentPackageSourceLocator` 定位 trusted agent package root 下的 `resource/` 子目录，作为分类问题 JSONL 文件的唯一来源。`resource/` 目录 SHALL 为扁平结构，直接包含 `category-question-{locale}.jsonl` 文件，MUST NOT 嵌套子目录。系统 MUST NOT 从请求体、客户端 metadata 或模型输出中获取分类问题资源路径。

#### Scenario: 正常定位 resource 目录
- **WHEN** 系统为已配置的 trusted agent scope 加载分类问题资源
- **THEN** 系统 MUST 通过 `AgentPackageSourceLocator` 定位 `{agentsRoot}/{agentId}` package root
- **AND** MUST 在该 package root 下查找 `resource/category-question-{locale}.jsonl` 文件

#### Scenario: resource 目录不存在
- **WHEN** agent package root 下不存在 `resource/` 目录
- **THEN** 系统 MUST 产出 `CATEGORY_QUESTION_SOURCE_UNAVAILABLE` readiness evidence
- **AND** MUST NOT 抛出异常或阻断应用启动

#### Scenario: 资源路径不可被外部覆盖
- **WHEN** 客户端请求或外部配置尝试指定分类问题资源路径
- **THEN** 系统 MUST NOT 使用来自请求体或客户端 metadata 的路径
- **AND** MUST 仅使用 trusted app composition 或 agent package source locator 解析的路径

### Requirement: JSONL 文件结构与校验

每个 `category-question-{locale}.jsonl` 文件 SHALL 为 JSON Lines 格式，每行一个独立 JSON 对象。空行 MUST 被静默跳过（不产出 evidence）。

每个一级分类对象 MUST 包含 `category`（非空字符串，一级分类名称）字段。对象 MAY 同时包含 `questions` 数组和 `records` 数组——两者可以共存，`questions` 中的问题作为该一级分类的直接问题，`records` 中的对象作为该一级分类的二级分类。当 `questions` 和 `records` 同时为空或不存在时，系统 MUST 跳过该行并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence。

每个二级分类对象 MUST 包含 `category`（非空字符串，二级分类名称）和 `questions`（非空数组）。二级分类对象如果包含 `records` 字段，系统 MUST 忽略该 `records` 字段（仅解析 `questions`），MUST NOT 拒绝该二级分类。最多支持二级分类。

每个 question 对象 MUST 包含 `question`（非空字符串）和 `fixed`（布尔值）字段。`fixed` 为 `true` 表示该问题为高频固定问题，未来高频问题组件 SHALL 优先展示。

字段类型校验规则：
- `category` 必须为非空字符串，否则跳过该条目并产出 evidence。
- `questions` 必须为数组，否则视为空数组。数组中每个元素必须为对象且包含有效的 `question` 和 `fixed` 字段，否则跳过该 question 并产出 evidence。
- `records` 必须为数组，否则视为空数组。数组中每个元素必须为对象且包含有效的 `category` 和非空 `questions`，否则跳过该二级分类并产出 evidence。
- 单行 JSON 解析失败时 MUST 跳过该行并产出 evidence。
- 单行为 `null`、数组或非对象类型时 MUST 跳过该行并产出 evidence。

系统 MUST 在解析时校验上述结构。校验失败的单行或单个条目 MUST 被跳过并产出 `CATEGORY_QUESTION_ENTRY_INVALID` readiness evidence，MUST NOT 中断整个文件的解析。当一级分类下所有 questions 和所有 records 都无效时，系统 MUST 跳过该一级分类并产出 evidence。

#### Scenario: 一级分类仅含直接问题
- **WHEN** JSONL 某行为 `{ "category": "查库存", "questions": [{ "question": "...", "fixed": true }] }`
- **THEN** 系统 MUST 将该条目解析为包含直接问题的一级分类
- **AND** 该一级分类 MUST NOT 包含二级分类

#### Scenario: 一级分类仅含二级分类
- **WHEN** JSONL 某行为 `{ "category": "查库存", "records": [{ "category": "查销量", "questions": [{ "question": "...", "fixed": false }] }] }`
- **THEN** 系统 MUST 将该条目解析为包含二级分类的一级分类
- **AND** 该一级分类 MUST NOT 包含直接问题

#### Scenario: 一级分类同时含直接问题和二级分类
- **WHEN** JSONL 某行的 `questions` 和 `records` 同时非空
- **THEN** 系统 MUST 同时解析直接问题和二级分类
- **AND** 该一级分类 MUST 同时包含 `questions` 和 `subCategories`

#### Scenario: 二级分类含 records 字段
- **WHEN** 二级分类对象包含 `records` 字段
- **THEN** 系统 MUST 忽略该 `records` 字段
- **AND** MUST 仅解析该二级分类的 `questions`
- **AND** MUST NOT 拒绝该二级分类

#### Scenario: question 缺少 question 字段
- **WHEN** question 对象缺少 `question` 字段或 `question` 为空字符串
- **THEN** 系统 MUST 跳过该 question 并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence

#### Scenario: question 缺少 fixed 字段
- **WHEN** question 对象缺少 `fixed` 字段或 `fixed` 不是布尔值
- **THEN** 系统 MUST 跳过该 question 并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence

#### Scenario: category 字段缺失或类型错误
- **WHEN** 一级分类或二级分类对象的 `category` 字段缺失、为空字符串或不是字符串类型
- **THEN** 系统 MUST 跳过该条目并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence

#### Scenario: questions 和 records 同时为空
- **WHEN** 一级分类对象的 `questions` 和 `records` 同时为空数组或均不存在
- **THEN** 系统 MUST 跳过该行并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence
- **AND** MUST NOT 中断后续行的解析

#### Scenario: 单行 JSON 解析失败
- **WHEN** JSONL 某行不是合法的 JSON
- **THEN** 系统 MUST 跳过该行并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence
- **AND** MUST NOT 中断后续行的解析

#### Scenario: 单行为非对象类型
- **WHEN** JSONL 某行解析为 `null`、数组或原始类型
- **THEN** 系统 MUST 跳过该行并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence

#### Scenario: 一级分类下所有内容均无效
- **WHEN** 一级分类下所有 questions 和所有 records 均校验失败
- **THEN** 系统 MUST 跳过该一级分类并产出 `CATEGORY_QUESTION_ENTRY_INVALID` evidence

### Requirement: Locale 规范化

系统 SHALL 接受 BCP 47 格式的 locale（如 `zh-CN`、`en-US`）并 normalize 为 language part（`-` 前的部分，小写），用于匹配 JSONL 文件后缀。`zh-CN` MUST normalize 为 `zh`，匹配 `category-question-zh.jsonl`；`en-US` MUST normalize 为 `en`，匹配 `category-question-en.jsonl`。当请求的 locale 对应的文件不存在时，系统 MUST 回退到 `zh` locale。当 `zh` locale 文件也不存在时，系统 MUST 返回空分类列表。

#### Scenario: 中文 locale 规范化
- **WHEN** 请求 locale 为 `zh-CN`
- **THEN** 系统 MUST normalize 为 `zh`
- **AND** MUST 读取 `category-question-zh.jsonl` 文件

#### Scenario: 英文 locale 规范化
- **WHEN** 请求 locale 为 `en-US`
- **THEN** 系统 MUST normalize 为 `en`
- **AND** MUST 读取 `category-question-en.jsonl` 文件

#### Scenario: locale 文件不存在时回退
- **WHEN** 请求 locale 为 `ja-JP` 且 `category-question-ja.jsonl` 不存在
- **THEN** 系统 MUST 回退到 `zh` locale
- **AND** MUST 尝试读取 `category-question-zh.jsonl`

#### Scenario: 回退 locale 也不存在
- **WHEN** 回退到 `zh` locale 且 `category-question-zh.jsonl` 也不存在
- **THEN** 系统 MUST 返回空分类列表
- **AND** 系统 MUST 产出 `CATEGORY_QUESTION_SOURCE_UNAVAILABLE` readiness evidence

### Requirement: Readiness Evidence 产出

分类问题资源发现 SHALL 产出与 local skill discovery 同形同策的 readiness evidence。每个 evidence MUST 包含 `providerId`、`sourceScope`（固定为 `agent-owned-local`）、`agentId`、`outcomeCode` 和 `message`。outcomeCode SHALL 包含以下值：
- `CATEGORY_QUESTION_SOURCE_UNAVAILABLE`：resource 目录或文件不存在
- `CATEGORY_QUESTION_ENTRY_INVALID`：单行 JSONL 校验失败
- `CATEGORY_QUESTION_REGISTERED`：分类问题目录成功加载

系统 MUST 在启动时通过 structured logging 记录 readiness evidence，日志 MUST NOT 包含问题文本内容。

#### Scenario: 成功加载
- **WHEN** 系统成功加载分类问题 JSONL 文件
- **THEN** 系统 MUST 为每个成功加载的文件产出 `CATEGORY_QUESTION_REGISTERED` evidence
- **AND** evidence MUST 包含 agentId 和 locale

#### Scenario: 文件缺失
- **WHEN** resource 目录下没有任何 `category-question-*.jsonl` 文件
- **THEN** 系统 MUST 产出 `CATEGORY_QUESTION_SOURCE_UNAVAILABLE` evidence
- **AND** MUST NOT 阻断应用启动

#### Scenario: 日志不包含问题内容
- **WHEN** 系统记录 readiness evidence
- **THEN** 日志 MUST NOT 包含 question 文本、category 名称或 JSONL 原始内容
- **AND** 日志 MUST 仅包含 low-cardinality 字段

### Requirement: 内存 Catalog 与 Agent Scope 隔离

系统 SHALL 将解析后的分类问题目录存储在内存中，按 `agentId` + `locale` 维度组织。不同 agent 的分类问题数据 MUST 相互隔离。内存 Catalog MUST NOT 写入数据库或持久化存储。Catalog 数据在应用生命周期内不可变；文件变更后需要重启应用才能生效。

#### Scenario: 不同 agent 的分类问题隔离
- **WHEN** agent A 和 agent B 各自有不同的 `resource/category-question-zh.jsonl` 文件
- **THEN** 系统 MUST 为 agent A 和 agent B 分别维护独立的内存 Catalog
- **AND** agent A 的查询 MUST NOT 返回 agent B 的分类问题数据

#### Scenario: 内存 Catalog 不持久化
- **WHEN** 系统加载分类问题目录到内存
- **THEN** 系统 MUST NOT 将分类问题数据写入 SQLite 或任何持久化存储
- **AND** 应用重启后 MUST 重新从 JSONL 文件加载

### Requirement: 问题 Hash 内部标识

系统 SHALL 为每个问题计算 SHA-256 hash 作为内部唯一标识。hash 的输入为问题的 `question` 文本字段。hash MUST NOT 出现在 Web API 响应中。hash 仅供未来高频问题组件和输入联想能力持久化用户活动时使用。

#### Scenario: hash 计算
- **WHEN** 系统解析一个 question 对象
- **THEN** 系统 MUST 为该问题计算 `SHA-256(question_text)` 作为内部标识
- **AND** 该 hash MUST 存储在内存 Catalog 中

#### Scenario: hash 不暴露给 API
- **WHEN** Web API 返回分类问题列表
- **THEN** 响应 DTO MUST NOT 包含 hash 字段
