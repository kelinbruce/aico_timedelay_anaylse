## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Capability 结果呈现策略受平台安全上限约束

系统 MUST 在用户查看 Capability 执行结果时，先确定平台安全上限，再把启动期冻结的集成呈现级别收窄到该上限；任何集成配置 MUST NOT 提高平台安全上限、改变 canonical Capability Result Message、改变模型上下文或把未列入安全投影白名单的字段发送给浏览器。

**需求类别**：功能性需求

呈现级别从低到高依次为 `STATUS_ONLY`、`SUMMARY`、`DETAIL`，有效级别为集成请求级别与平台安全上限中较低者：

- `STATUS_ONLY`：普通 Capability result delta 只携带 Capability 身份、关联标识、有效呈现级别和状态，不携带结果摘要、详情或原始字段。
- `SUMMARY`：在 `STATUS_ONLY` 基础上只增加非空、非通用的安全摘要；平台内置 projector MUST 同时提供闭合集合内的语言中立 `safeSummaryCode` 与按该 code 白名单化、有界的 `safeSummaryArgs`，并 MAY 保留不扩大披露范围的 `safeSummary` 兼容回退；`safeResult`、详情 `text` 和详情 `content` 必须缺失或为空。
- `DETAIL`：在 `SUMMARY` 基础上允许增加有界、脱敏、字段白名单化且 schema 校验通过的 `safeResult` 与对应详情文本。

AskUserQuestion 已被用户提交并接受的答案是公开对话事实，不是普通 Capability 结果详情。合法 accepted-answer MUST 先经既有 bounded projector 生成，并在 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 三种配置下保持同一公开事实；三档策略只控制其余附属结果字段，MUST NOT 隐藏用户自己已提交的答案。`USER_INPUT_RECEIVED` 仍 MUST 保持 answer-free，浏览器不得从该事件恢复答案正文。

平台安全上限 MUST 按以下穷尽规则确定：已识别且通过对应安全 schema 的结果最高为 `DETAIL`，并可被集成呈现级别收窄为 `SUMMARY` 或 `STATUS_ONLY`；内部 Skill 正文、未知 Capability 身份、未知结果形状、schema 校验失败或无法证明安全来源的结果最高为 `STATUS_ONLY`。每条已形成可见生命周期事实的成功结果 MUST 至少产生 `STATUS_ONLY` 投影。安全失败事实 MUST 按安全失败可见性契约呈现安全失败状态和用户可读安全原因，但 MUST NOT 因失败而放宽详情上限。

可选启动配置 `nextAgent.system.capability-result-presentation` MUST 使用以下契约：`default-level` 为可选呈现级别，缺失时默认为 `SUMMARY`；`rules` 为可选数组，最多包含 256 项；每项恰好包含长度 1 至 128 个 Unicode code point 的非空 `capability-id` 和一个 `level`。只有 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 是合法级别；`HIDDEN` 和任何其他值都必须校验失败。`capability-id` 按大小写敏感精确匹配。系统 MUST 先建立内置策略基线，再使用每个已校验集成方规则替换同名基线项或添加扩展 Tool 项；最终策略中恰好一个规则命中时使用该规则，否则使用 `default-level`。重复 `capability-id`、未知级别、未知字段、空标识或超出数量/长度限制 MUST 使启动配置校验失败，系统 MUST NOT 进入 ready 状态。

内置策略基线 MUST 把 `Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 设为 `STATUS_ONLY`，把 `AskUserQuestion`、`TodoWrite`、`Cron` 设为 `DETAIL`，把 `Rag`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow` 设为 `SUMMARY`。`AskUserQuestion` 的基线只约束非 accepted-answer 的普通结果兜底，不能覆盖前述公开对话事实。已识别 CLIP 和其他没有精确规则的扩展 Tool 使用有效 `default-level`，但只有存在平台管理的安全 projector 时才能高于 `STATUS_ONLY`。`ApiCall` 是编排层程序化调用且不向模型披露的内部 Tool；其规范路径把结构化结果作为终态答案处理，不产生普通工具结果卡片。若异常或未来兼容路径仍向共享 projector 提交 `capabilityId=ApiCall` 的结果事实，投影 MUST 保持 `STATUS_ONLY`，MUST NOT 从 HTTP response 形状推导摘要或详情。

#### Scenario: 默认配置以摘要呈现普通工具

- **GIVEN** 集成方没有配置 `nextAgent.system.capability-result-presentation`
- **AND** `Read` 结果通过受支持的文件读取安全 schema，且安全路径和有界正文预览均可生成
- **WHEN** 用户查看该 Capability 结果
- **THEN** 系统 MUST 以 `SUMMARY` 有效级别返回安全文件读取摘要
- **AND** 系统 MUST NOT 返回文件正文、`safeResult` 或详情展开内容
- **AND** 系统 MUST NOT 返回主机绝对路径、未截断原始正文或工具调用参数

#### Scenario: 默认配置为 RAG 返回安全摘要

- **GIVEN** 集成方没有配置 `nextAgent.system.capability-result-presentation`
- **AND** `Rag` 结果通过平台管理的检索结果安全 schema
- **WHEN** 用户查看该 Capability 结果
- **THEN** 系统 MUST 以 `SUMMARY` 有效级别返回召回数量的语言中立摘要语义
- **AND** 系统 MUST NOT 返回检索正文、来源内部路径、相关度分数或 `safeResult`

#### Scenario: AskUser accepted answer 不受普通结果级别隐藏

- **GIVEN** 用户已提交并被系统接受一个合法 AskUserQuestion 答案
- **WHEN** 集成配置分别把 `AskUserQuestion` 设为 `STATUS_ONLY`、`SUMMARY` 或 `DETAIL`
- **THEN** 三种配置 MUST 返回同一个经过有界校验的 accepted-answer 公开事实
- **AND** 系统 MUST NOT 因 `STATUS_ONLY` 删除答案，也 MUST NOT 因 `DETAIL` 增加原始参数或未白名单字段

#### Scenario: 默认配置仅显示记忆与 Skill 获取状态

- **GIVEN** 集成方没有配置 `nextAgent.system.capability-result-presentation`
- **AND** `search_memory`、`get_memory_detail`、`add_memory` 或 `acquire_skill` 产生成功结果
- **WHEN** 用户通过实时流或运行历史查看该 Capability 结果
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** result delta MUST NOT 携带成功结果摘要、详情文本、`safeResult` 或原始结果字段

#### Scenario: SUMMARY 精确覆盖不能突破四类结果安全上限

- **GIVEN** 集成规则把 `search_memory`、`get_memory_detail`、`add_memory` 或 `acquire_skill` 中任一精确配置为 `SUMMARY`
- **AND** 该 Capability 不存在平台管理的安全 projector
- **WHEN** 用户查看该 Capability 的成功结果
- **THEN** 冻结策略中的配置级别 MUST 为 `SUMMARY`
- **AND** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 返回 `safeSummaryCode`、`safeSummaryArgs`、`safeSummary`、`safeResult`、结果正文或原始字段

#### Scenario: DETAIL 精确覆盖不能突破四类结果安全上限

- **GIVEN** 集成规则把 `search_memory`、`get_memory_detail`、`add_memory` 或 `acquire_skill` 中任一精确配置为 `DETAIL`
- **AND** 该 Capability 不存在平台管理的安全 projector
- **WHEN** 用户查看该 Capability 的成功结果
- **THEN** 冻结策略中的配置级别 MUST 为 `DETAIL`
- **AND** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 返回 `safeSummaryCode`、`safeSummaryArgs`、`safeSummary`、`safeResult`、结果正文或原始字段

#### Scenario: 集成方精确覆盖不删除其他内置基线项

- **GIVEN** 集成配置只包含 `Read=DETAIL` 的精确规则
- **WHEN** 系统校验并冻结 Capability 结果呈现策略
- **THEN** `Read` 的配置级别 MUST 为 `DETAIL`
- **AND** `Skill`、`Rag`、`Agent`、`AskUserQuestion`、`TodoWrite`、`Cron`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 以及其他内置基线项 MUST 保留各自的内置级别
- **AND** 系统 MUST NOT 要求集成方重复声明未修改的内置项

#### Scenario: 集成规则把命令结果收窄为仅状态

- **GIVEN** 启动配置包含大小写精确匹配 `Bash` 且 `level=STATUS_ONLY` 的唯一规则
- **AND** 平台能够为该结果生成安全命令输出详情
- **WHEN** 用户查看 `Bash` 结果
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** result delta MUST NOT 携带 `stdout`、`stderr`、`safeResult`、结果摘要或详情文本

#### Scenario: 配置不能放宽内部 Skill 正文上限

- **GIVEN** 集成规则为 `Skill` 请求 `DETAIL`
- **AND** Skill 结果包含内部资源正文或与文件读取结果相似的字段
- **WHEN** 用户查看该结果
- **THEN** 有效级别 MUST NOT 高于 `STATUS_ONLY`
- **AND** 系统 MUST NOT 把内部资源正文、源路径或类似文件读取的正文预览发送给浏览器

#### Scenario: 未知自定义结果安全降级

- **GIVEN** 集成规则或默认级别请求 `DETAIL`
- **AND** 自定义 Capability 结果没有匹配受支持的安全投影 schema
- **WHEN** 用户查看该结果
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 把任意 JSON 字段复制到 `safeResult`、`safeSummary`、`text` 或 `content`

#### Scenario: 非法呈现配置阻止应用 ready

- **GIVEN** 启动配置包含重复 `capability-id`、`HIDDEN` 或不属于三个允许值的 `level`
- **WHEN** 系统校验并冻结配置
- **THEN** 配置校验 MUST 失败并产生不含原始结果或敏感内容的安全诊断
- **AND** 系统 MUST NOT 接受用户请求或提供 Web 会话服务

## Function 变更汇总

### `FN-2.4 查看请求状态`

#### 结果

- **变更类型**：`MODIFIED`
- **目标内容**：四类长期记忆与 Skill 获取 Capability 的内置结果呈现基线为 `STATUS_ONLY`；集成方请求更高级别时仍受平台安全上限约束。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`

#### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| Capability 结果呈现级别 | `MODIFIED` | `STATUS_ONLY`、`SUMMARY`、`DETAIL`；最终级别不得突破平台安全上限 | 允许值仍为 `STATUS_ONLY`、`SUMMARY`、`DETAIL`，最终级别不得突破平台安全上限；内置基线为 `STATUS_ONLY`：`Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill`，`DETAIL`：`AskUserQuestion`、`TodoWrite`、`Cron`，`SUMMARY`：`Rag`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow` | `Capability 结果呈现策略受平台安全上限约束` |
