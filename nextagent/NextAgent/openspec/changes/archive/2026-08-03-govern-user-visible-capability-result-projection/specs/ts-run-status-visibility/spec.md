## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

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

内置策略基线 MUST 把 `Skill`、`Agent`、`ApiCall` 设为 `STATUS_ONLY`，把 `AskUserQuestion`、`TodoWrite`、`Cron` 设为 `DETAIL`，把 `Rag`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow` 设为 `SUMMARY`。`AskUserQuestion` 的基线只约束非 accepted-answer 的普通结果兜底，不能覆盖前述公开对话事实。已识别 CLIP 和其他没有精确规则的扩展 Tool 使用有效 `default-level`，但只有存在平台管理的安全 projector 时才能高于 `STATUS_ONLY`。`ApiCall` 是编排层程序化调用且不向模型披露的内部 Tool；其规范路径把结构化结果作为终态答案处理，不产生普通工具结果卡片。若异常或未来兼容路径仍向共享 projector 提交 `capabilityId=ApiCall` 的结果事实，投影 MUST 保持 `STATUS_ONLY`，MUST NOT 从 HTTP response 形状推导摘要或详情。

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

#### Scenario: 集成方精确覆盖不删除其他内置基线项

- **GIVEN** 集成配置只包含 `Read=DETAIL` 的精确规则
- **WHEN** 系统校验并冻结 Capability 结果呈现策略
- **THEN** `Read` 的配置级别 MUST 为 `DETAIL`
- **AND** `Skill`、`Rag`、`Agent`、`AskUserQuestion`、`TodoWrite`、`Cron` 以及其他内置基线项 MUST 保留各自的内置级别
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

### Requirement: 请求终态失败只在有可靠行动依据时提供指导

Web chat workspace MUST 使用可信 request terminal event 以及既有 safe code、category 和 retryable 确定请求终态失败呈现。失败阶段只允许为 `MODEL_INVOCATION`、`CAPABILITY_INPUT`、`CAPABILITY_EXECUTION`、`CAPABILITY_OUTPUT`、`REQUEST_RUNTIME` 或 `UNKNOWN`。系统 MUST 由 terminal event 与稳定 code 确定阶段。系统 MUST NOT 从错误 message、raw exception、prompt、模型输出或 Capability payload 推断阶段。local、immersive、collaborative 三种宿主 MUST 复用同一终态失败解释逻辑。

请求终态失败 MUST 显示本地化事实原因。失败阶段 MUST 显示在请求终态失败卡片中。稳定错误码、错误类别和本地化调用状态标签 MUST 默认收起为技术详情。当稳定 code 对应已定义行动且当前 surface 提供该行动或明确指导目标时，系统 MUST 显示固定本地化指导。前述条件任一不成立时，系统 MUST NOT 生成行动指导。模型认证失败的指导 MUST 指向检查模型凭据与配置或联系有权限的管理员。模型不存在的指导 MUST 指向检查模型配置或联系有权限的管理员。限流或网络失败只有在 `retryable=true` 且当前 surface 提供 request retry control 时，才 MUST 提示重试。内部错误或未知 code MUST 只显示事实原因和技术详情。内部错误或未知 code MUST NOT 生成通用修复建议。

非终态 Capability 步骤失败 MUST NOT 由本 Requirement 推断 request terminal、整轮重试或用户行动；其呈现由 `Capability 安全失败投影必须只陈述已确认事实` 约束。

**需求类别**：功能性需求

#### Scenario: 模型认证终态失败给出可执行的管理指引

- **GIVEN** 一个 turn 以 `MODEL_AUTHENTICATION_FAILED` 终态失败
- **WHEN** 用户查看请求失败信息
- **THEN** 三种宿主 MUST 显示阶段 `MODEL_INVOCATION`
- **AND** 界面 MUST 显示不可直接重试
- **AND** 界面 MUST 指向检查模型凭据与配置或联系有权限的管理员
- **AND** 界面 MUST NOT 显示 credential、provider body、stack 或 endpoint

#### Scenario: 可重试错误没有请求级重试入口时不建议重试

- **GIVEN** 一个请求因模型限流终态失败且 `retryable=true`
- **AND** 当前 surface 没有可用的 request retry control
- **WHEN** 用户查看该失败
- **THEN** 界面 MUST 显示模型调用失败的事实原因
- **AND** 界面 MUST NOT 显示无法执行的重试行动入口或承诺自动重试

#### Scenario: 未识别终态错误使用事实性通用降级

- **GIVEN** 一个请求以未识别的稳定错误码终态失败
- **WHEN** 用户查看该失败
- **THEN** 失败阶段 MUST 为 `UNKNOWN`
- **AND** 界面 MUST 显示当前语言的通用事实性原因
- **AND** 稳定错误码 MUST 只在用户主动展开的技术详情中显示
- **AND** 界面 MUST NOT 因映射缺失而隐藏 process panel、抛出渲染异常或生成通用修复建议

#### Scenario: Capability 步骤失败不被当作请求终态

- **GIVEN** 一个 Capability 步骤失败但当前 request 尚未产生 terminal event
- **WHEN** 用户查看该步骤
- **THEN** 界面 MUST NOT 显示 request terminal 阶段、整轮重试建议或请求失败结论
- **AND** 后续模型或 Capability 事实 MUST 继续按实际时序呈现

### Requirement: Capability 安全失败投影必须只陈述已确认事实

系统 MUST 把已经产生安全失败事实的 Capability 步骤呈现为失败状态。系统 MUST 提供由可信后端生成、可按当前界面语言解释的事实性失败原因。系统 MUST 按已审计且与 category 一致的具体 `safeErrorCode`、九类 `safeErrorCategory`、通用失败的优先顺序选择唯一语言中立失败 `safeSummaryCode`。具体 code 与当前 category 冲突时，系统 MUST 使用 category。category 缺失时，系统 MUST 只对无歧义且已审计的 code 使用专属语义。code 和 category 都缺失或不受支持时，系统 MUST 使用通用失败。失败 `safeSummaryArgs` MUST 为空对象。

Capability 失败卡片 MUST 以该步骤的 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED` 安全失败事实为权威输入。仅携带 code 的 `DEGRADATION_NOTICE` 或 request terminal fact MUST NOT 覆盖、降级或改写同一步骤中已经存在的 code/category 联合语义。独立 code-only `DEGRADATION_NOTICE` 需要用户可见且其 code 不属于无歧义的已审计映射时，系统 MUST 使用通用事实性语义。系统 MUST NOT 把该 notice 合并为某个 Capability 的专属失败原因。request terminal fact 的独立呈现 MUST 继续遵守 `请求终态失败只在有可靠行动依据时提供指导`。

具体 code 规则 MUST 区分命令被拒绝、输入无效、路径被拒绝、结果过大、文件修改前未完整读取、目标已变化、平台不支持和执行依赖不可用。category 规则 MUST 穷尽 `AUTHORIZATION`、`POLICY_DENIED`、`VALIDATION`、`NOT_FOUND`、`CONFLICT`、`UNAVAILABLE`、`TIMEOUT`、`CANCELED`、`INTERNAL`。被多个 category 复用的 code MUST NOT 覆盖当前 category。同一用户语义的多个底层错误 MUST 复用同一个失败摘要语义。同一失败事实 MUST 只产生一个失败摘要语义。

失败卡片默认 MUST 只显示 Capability 公开身份、失败状态标签和一条事实性原因。失败卡片 MUST NOT 再以“执行结果”或其他字段重复同一原因。用户主动展开技术详情时，系统 MUST 显示当前失败事实中已经存在的 `safeErrorCode`、`safeErrorCategory` 和本地化调用状态标签。前述安全技术字段缺失时，系统 MUST 省略对应字段。技术详情未展开时，这些字段 MUST 保持不可见。原始内部状态枚举 MUST NOT 作为正文或技术详情值显示。技术详情 MUST NOT 包含 raw exception message、stack、文件或资源路径、工具参数、结果正文、provider error、credential、token 或 runtime correlation id。

`STATUS_ONLY`、`SUMMARY`、`DETAIL` 只控制成功结果披露。三种配置 MUST 显示同一条失败状态和事实性原因。`DETAIL` MUST NOT 放宽失败技术详情的安全字段集合。

单个 Capability 的错误码、错误类别或 `SafeError.retryable` 只说明本次步骤事实。失败卡片 MUST NOT 仅根据这些字段生成自动恢复承诺、自动重试承诺、用户操作建议或 Capability 级 CTA。当系统另外存在契约可见的 AskUser 输入请求、显式上传要求、可重试 request terminal control 或已配置授权流程时，对应交互 owner MUST 呈现其用户行动入口。模型后续调用其他 Capability 或输出 Assistant Message 时，界面 MUST 按新产生的事实呈现。界面 MUST NOT 把旧失败步骤改写为已经恢复。

**需求类别**：功能性需求

#### Scenario: 写入前未完整读取只显示事实原因

- **GIVEN** `Write` 失败携带 `safeErrorCode=WRITE_REQUIRES_FULL_READ`
- **WHEN** 用户查看该步骤的默认失败卡片
- **THEN** 卡片 MUST 显示“未能完成”和“修改文件前需要先完整读取最新内容”的本地化语义
- **AND** 卡片 MUST NOT 显示“请先读取文件”“系统将重新读取”或“系统将继续处理”
- **AND** 卡片 MUST NOT 把该失败呈现为 request terminal failure

#### Scenario: 平台不支持不生成无法兑现的行动建议

- **GIVEN** Capability 失败携带 `safeErrorCode=PLATFORM_UNSUPPORTED`
- **AND** 当前请求没有授权、上传、用户输入或 request retry 交互事实
- **WHEN** 用户查看该失败
- **THEN** 卡片 MUST 显示“无法执行”和“当前运行环境不支持此能力”的本地化语义
- **AND** 卡片 MUST NOT 建议用户安装依赖、修改部署或稍后重试

#### Scenario: 未命中的错误码使用完整类别兜底

- **GIVEN** Capability 失败携带一个不在后端已审计具体 code/category 映射表中的 `safeErrorCode`
- **AND** `safeErrorCategory=CONFLICT`
- **WHEN** 可信后端生成失败投影
- **THEN** 投影 MUST 使用状态冲突语义而不是通用失败语义
- **AND** 浏览器 MUST NOT 显示未知 `safeErrorCode` 作为主文案

#### Scenario: 一码多类错误不得覆盖当前类别

- **GIVEN** 一个 Capability 失败携带 `safeErrorCode=EXECUTION_FAILED`
- **AND** `safeErrorCategory=CANCELED`
- **WHEN** 可信后端生成失败投影
- **THEN** 投影 MUST 使用已取消语义
- **AND** 投影 MUST NOT 因 code 名称显示通用执行失败或内部异常语义

#### Scenario: 路径错误码与冲突类别组合使用冲突语义

- **GIVEN** 一个 Capability 失败携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** `safeErrorCategory=CONFLICT`
- **WHEN** 可信后端生成失败投影
- **THEN** 投影 MUST 使用状态冲突语义
- **AND** 投影 MUST NOT 声称该路径被安全策略阻止

#### Scenario: 缺失错误语义安全降级

- **GIVEN** Capability 失败没有受支持的精确 code 和 category
- **WHEN** 用户在中文或英文界面查看该失败
- **THEN** 界面 MUST 显示当前语言的通用失败状态和事实性原因
- **AND** 界面 MUST NOT 显示上游错误文本、未知 code 或 descriptor 名称作为原因

#### Scenario: 三种成功结果策略不隐藏失败原因

- **GIVEN** 同一 Capability 失败分别应用 `STATUS_ONLY`、`SUMMARY` 和 `DETAIL` 配置
- **WHEN** 用户查看三条失败卡片
- **THEN** 三条卡片 MUST 显示相同的失败状态和事实性原因
- **AND** 用户主动展开时 MUST 显示相同的安全技术详情
- **AND** `DETAIL` MUST NOT 返回失败原始结果或额外诊断正文

#### Scenario: 技术详情默认收起且不重复原因

- **GIVEN** 失败投影包含安全错误码、错误类别和调用状态
- **WHEN** 失败卡片首次显示
- **THEN** 卡片 MUST 只显示一次事实性失败原因
- **AND** 错误码、错误类别和本地化调用状态标签 MUST 默认收起
- **WHEN** 用户主动展开技术详情
- **THEN** 卡片 MUST 显示安全错误码、安全错误类别和本地化调用状态标签
- **AND** 卡片 MUST NOT 显示原始内部状态枚举
- **AND** 卡片 MUST NOT 再显示“执行结果：”加同一失败原因

#### Scenario: 模型后续动作作为新事实呈现

- **GIVEN** 一个 `Write` 步骤因未完整读取而失败
- **WHEN** 后续模型轮次实际产生一个 `Read` 调用并再次调用 `Write`
- **THEN** 界面 MUST 把 `Read` 和新的 `Write` 分别显示为后续过程步骤
- **AND** 原失败步骤 MUST 保持其原始失败状态
- **AND** 原失败卡片 MUST NOT 在后续动作发生前预告或承诺这些动作

#### Scenario: code-only 降级事实不覆盖完整 Capability 失败

- **GIVEN** 一个 `CAPABILITY_COMPLETED` 失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED` 和 `safeErrorCategory=CONFLICT`
- **AND** 同一 request 随后产生一个只携带 `code=CAPABILITY_PATH_REJECTED` 的 `DEGRADATION_NOTICE`
- **WHEN** 用户在 live 或 history 查看该 Capability 步骤
- **THEN** Capability 失败卡片 MUST 保持 code/category 联合确定的事实性原因
- **AND** code-only notice MUST NOT 覆盖、降级或改写该卡片
- **AND** code-only notice MUST NOT 作为该卡片的第二条失败原因呈现
- **AND** 该 notice 如果作为独立事实可见，MUST 因该 code 缺少可区分 category 而使用通用事实性语义

### Requirement: Capability 生命周期事件不得显示内部协议标识

普通 Agent Web MUST NOT 把 Event type、`safeSummaryCode`、内部状态枚举或其他协议标识显示为用户可读正文。`CAPABILITY_STARTED` 契约不定义受治理的安全业务说明字段，因此可信后端 MUST 省略其自由文本，Agent Web MUST 忽略任何不属于受治理字段的启动事件自由文本。模型在调用 Capability 前生成的公开执行说明 MUST 继续作为独立的过程 Message / `LLM_CONTENT_DELTA` 投影，不得伪装成生命周期正文。Agent Web MUST 使用结构化事件类型、Capability 公开身份和状态渲染本地化生命周期标签。本地化生命周期标签和本地化调用状态标签是界面语义，不是内部状态枚举的直接显示。Agent Web 无法安全解释其他生命周期附加说明时 MUST 省略该说明。

该约束 MUST 在 live、run-event history、SSE、WebSocket 以及 local、immersive、collaborative 三种宿主中保持一致。未知失败 `safeSummaryCode` MUST 使用通用本地化失败语义。未知失败 `safeSummaryCode` MUST NOT 显示 descriptor 本身。安全错误码和错误类别只受 `Capability 安全失败投影必须只陈述已确认事实` 定义的技术详情规则约束。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复
**适用范围**：该 Function

#### Scenario: 活动步骤不显示 CAPABILITY_STARTED

- **GIVEN** `CAPABILITY_STARTED` 事件不具有受治理的安全业务说明字段
- **AND** 输入携带未被该契约定义的任意 `text`
- **WHEN** 用户在 live 执行过程中查看该活动步骤
- **THEN** 界面 MUST 使用当前语言显示 Capability 公开身份和执行中状态
- **AND** 界面 MUST NOT 显示字符串 `CAPABILITY_STARTED`
- **AND** 界面 MUST NOT 把该任意 `text` 当作业务说明显示

#### Scenario: 刷新后不恢复内部协议文本

- **GIVEN** 一个生命周期事件的 live 投影没有用户可读附加说明
- **WHEN** 用户刷新页面并从 run-event history 恢复该步骤
- **THEN** history MUST 保持与 live 相同的本地化身份和状态
- **AND** history MUST NOT 从 Event type、descriptor 或 canonical Message 补出内部协议文本

#### Scenario: 未知摘要 descriptor 不直接显示

- **GIVEN** 浏览器收到一个不属于当前闭合集合的 `safeSummaryCode`
- **WHEN** 前端渲染 Capability 步骤
- **THEN** 前端 MUST NOT 显示该 code 的原始字符串
- **AND** 失败步骤 MUST 使用通用本地化失败语义
- **AND** 非失败步骤 MUST 省略无法解释的摘要并保留结构化状态

### Requirement: Capability 结果的用户可见投影由可信后端统一产生

所有普通 Agent Web 用户可见的 Capability 结果 MUST 由可信后端依据同一份启动期策略快照产生；SSE、WebSocket、run-event history 以及 local、immersive、collaborative 三种宿主 MUST 对同一 canonical Capability 结果输出相同的有效呈现级别、`safeSummaryCode`、`safeSummaryArgs`、兼容 `safeSummary`、`safeResult`、截断状态和安全失败事实。普通 conversation history 请求 MUST NOT 把 Capability Result Message 作为过程详情来源；浏览器 MUST NOT 从 canonical Message 的原始或隐藏 `content`、工具参数、Capability payload 或 frontend local state 重新构造结果详情。前端 MUST 使用当前界面语言解释平台闭合集合内的摘要 code，界面语言切换只重新渲染既有投影，MUST NOT 重新请求或改写历史事实。

**需求类别**：系统质量属性

**质量属性**：安全、可靠性/恢复
**适用范围**：该 Function

Message 的 `visible` 字段只控制该 Message 是否作为普通会话消息返回，不直接决定对应过程投影是否可见。后端只有在关联的 canonical timeline fact、Capability 身份、tool call 坐标和 Message 内容均通过校验时，才能按呈现策略产生过程投影；关联缺失、坐标冲突、内容解析失败或策略不可用时 MUST 省略详情并降级为不高于 `STATUS_ONLY` 的安全结果，MUST NOT 回退为浏览器解析原始 Message。对于需要根据执行时可信 descriptor 区分 projector 的扩展 Tool，持久化 completion Event MAY 保存闭合集合内、版本化且不含正文的 `resultProjectionKind` 控制事实；该字段只能选择共享安全 projector，MUST NOT 作为 Web 内容返回，也 MUST NOT 携带摘要、详情或结果副本。conversation API 即使收到 `includeCapabilityResults=true`，也 MUST 将非 AskUserQuestion Capability Result item 的 `content` 投影为空字符串，并 MUST NOT 在其他字段复制原始结果 payload 或未白名单 metadata。只读 share 响应 MUST 排除普通 Capability Result Message，不能把 canonical 工具结果原文作为共享对话内容返回。既有 AskUserQuestion accepted-answer conversation compatibility 继续由其专用 bounded projector 约束，本 change MUST NOT 扩大该兼容字段或把它作为普通工具结果详情来源。

#### Scenario: live 与 history 使用同一安全投影

- **GIVEN** 一条已完成 Capability 结果在 live 阶段按有效级别 `SUMMARY` 可见
- **WHEN** 用户刷新页面并通过 run-event history 重新查看同一结果
- **THEN** history MUST 仍以 `SUMMARY` 呈现相同安全摘要
- **AND** live 与 history MUST 返回相同的 `safeSummaryCode` 和 `safeSummaryArgs`
- **AND** history MUST NOT 新增 `safeResult`、详情正文或原始 Message 内容

#### Scenario: 界面语言切换复用同一摘要语义

- **GIVEN** 同一 `Read` SUMMARY 投影包含平台生成的 `safeSummaryCode` 与有界 `safeSummaryArgs`
- **WHEN** 用户在中文和英文界面之间切换
- **THEN** 前端 MUST 使用现有 i18n 资源显示对应语言摘要
- **AND** Web payload、timeline 和 Message MUST 保持不变，浏览器 MUST NOT 为语言切换新增结果请求

#### Scenario: 可信 CLIP 分类恢复 live 与 history

- **GIVEN** 执行时可信 descriptor 被验证为受支持的 CLIP provider，completion Event 保存 `resultProjectionKind=CLIP_STREAM_V1`
- **WHEN** live result delta 与刷新后的 history 分别投影同一 canonical 结果
- **THEN** 两条路径 MUST 使用同一个共享 CLIP 安全 projector 并产生相同的摘要、详情和截断状态
- **AND** 没有该可信分类的自定义 Capability 即使伪造 CLIP 结果形状也 MUST 降级为 `STATUS_ONLY`
- **AND** 浏览器 MUST NOT 收到 `resultProjectionKind`

#### Scenario: 普通 Read 与内部资源读取被正确区分

- **GIVEN** 普通工作区 `Read` 和内部 Skill 资源加载分别产生包含文件路径与正文形状的结果
- **WHEN** 用户在 live 或 history 中查看两条过程记录
- **THEN** 普通工作区 `Read` MUST 按配置和文件读取安全上限显示允许的安全预览
- **AND** 内部 Skill 资源加载 MUST NOT 因字段形状相似而显示正文或源路径
- **AND** 两条结果在 SSE、WebSocket 和刷新后的 history 中 MUST 保持各自相同的投影

#### Scenario: Message 可见性与过程投影职责分离

- **GIVEN** canonical Capability Result Message 不作为普通会话消息返回
- **AND** 对应 timeline fact 与 Message 关联校验成功
- **WHEN** 用户查看执行过程
- **THEN** 后端 MUST 按有效呈现级别返回安全过程投影
- **AND** 成功结果 MUST 至少包含 Capability 身份、关联标识和状态
- **AND** 浏览器 MUST NOT 获得或解析该 Message 的原始 `content`

#### Scenario: Conversation history 不再提供工具结果详情输入

- **GIVEN** 用户打开或分页浏览包含多个已完成 Capability 调用的会话
- **WHEN** Agent Web 请求 conversation history
- **THEN** 请求 MUST NOT 要求返回 Capability Result Message 作为过程详情输入
- **AND** 过程详情 MUST 通过对应 run 的 run-event history 安全投影加载
- **AND** 既有 AskUserQuestion accepted-answer 兼容投影 MUST NOT 被解释为普通工具结果详情

#### Scenario: 显式请求 Capability Result Message 也不返回普通工具原文

- **GIVEN** Web 调用方设置 `includeCapabilityResults=true`
- **AND** conversation page 包含非 AskUserQuestion Capability Result Message
- **WHEN** 后端投影 conversation response
- **THEN** 该 item 的 `content` MUST 为空字符串
- **AND** response 的其他字段 MUST NOT 包含原始结果 payload、工具参数或未经过共享 projector 的结果详情

#### Scenario: 共享对话不携带普通工具结果原文

- **GIVEN** 一个被分享的完整请求包含用户问题、一个或多个普通 Capability Result Message 和最终 Assistant Message
- **WHEN** 访客加载只读共享对话
- **THEN** 响应 MUST 保留用户问题与最终回答并排除普通 Capability Result Message
- **AND** 响应 MUST NOT 包含原始工具结果、工具参数或结果 metadata 中的未白名单字段

#### Scenario: Message 关联不可用时安全降级

- **GIVEN** history 事件引用的 Message 缺失、越过当前 owner/agent/session/run scope 或 tool call 坐标不匹配
- **WHEN** 后端生成用户可见过程投影
- **THEN** 后端 MUST 省略结果详情并输出不高于 `STATUS_ONLY` 的安全结果或既有安全不可用状态
- **AND** 后端 MUST NOT 搜索其他 Message 猜测关联，也 MUST NOT 把原始事件 payload 作为详情回退

### Requirement: 工具结果投影不得因 Skill 或发现来源而变化

Skill manifest 的 `allowed-tools`、`tools` 和 `metadata.denied-tools` MUST 只作为 Capability 治理约束，MUST NOT 定义新 Tool 实现、新结果投影身份或更高的用户可见上限。工具被直接调用、Skill 激活、ToolSearch 激活或其他受治理路径激活时，后端 MUST 使用 Capability Catalog 最终解析的 Tool-kind descriptor `capabilityId` 选择呈现规则和平台安全 projector；Skill id、Skill 内容、激活来源和调用路径 MUST NOT 参与该选择。

同一工具以不同受治理来源执行时，对同一 canonical 结果和策略快照 MUST 产生相同的有效级别、`safeSummary`、`safeResult`、详情文本、截断标记和安全失败事实。Skill 激活的扩展 Tool 没有平台管理的安全 projector 时，即使有效配置请求 `SUMMARY` 或 `DETAIL`，结果也 MUST 降级为 `STATUS_ONLY`。不存在、非 Tool-kind、未绑定或未授权的引用 MUST 由 Capability 治理拒绝，用户界面 MUST NOT 出现伪造的成功结果或从 Skill 内容派生的详情。

#### Scenario: 内置工具直接调用与经 Skill 激活的投影相同

- **GIVEN** `Read` 以直接模型工具调用和 Skill `allowed-tools` 激活两种路径分别执行
- **AND** 两次执行具有等价的 canonical 安全结果、`capabilityId=Read` 和同一策略快照
- **WHEN** 后端生成 live 或 history 结果投影
- **THEN** 两条投影 MUST 具有相同的有效级别、摘要、详情和截断行为
- **AND** 投影 MUST NOT 包含 Skill id、Skill 源路径或 Skill 正文

#### Scenario: Skill 激活未配置安全 projector 的扩展工具

- **GIVEN** Skill `allowed-tools` 激活一个经 Capability Catalog 授权的扩展 Tool
- **AND** 该 Tool 没有平台管理的结果安全 projector
- **AND** 集成规则请求 `DETAIL`
- **WHEN** 用户查看该 Tool 结果
- **THEN** 有效级别 MUST 为 `STATUS_ONLY`
- **AND** 系统 MUST NOT 复制扩展结果 JSON、Skill 内容或上游自定义摘要

#### Scenario: Skill 无权激活工具时不伪造成功投影

- **GIVEN** Skill 引用不存在、非 Tool-kind、未绑定或未授权的 Capability
- **WHEN** Capability 治理解析该引用
- **THEN** 系统 MUST 拒绝激活或执行
- **AND** channel 最多只能投影已产生的安全失败事实
- **AND** 用户界面 MUST NOT 出现成功结果卡、原始 Skill 内容或未经安全 projector 的工具结果

### Requirement: 大结果历史浏览不得产生逐结果请求放大

当用户加载包含 Capability 结果的多轮历史时，run-event history 响应 MUST 随每个已返回的过程事件携带其当前安全投影或安全降级结果；浏览器 MUST NOT 为获得 `safeSummary`、`safeResult`、详情文本或呈现级别而按结果发起额外网络请求。该约束 MUST 在既有最多 500 个用户可见过程步骤的单请求边界内成立。自动加载 run-event history 的并发请求数 MUST 不超过 4，单次稳定视口更新自动保留的目标 run MUST 不超过 16；同一 run 的已完成或进行中请求 MUST 去重。

**需求类别**：系统质量属性

**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 500 个混合工具过程步骤不产生 N 加一请求

- **GIVEN** 一个历史会话包含一个具有 500 个用户可见过程步骤的请求
- **AND** 步骤混合三种呈现级别、内置 Tool、Skill 激活 Tool、已识别扩展 Tool 和 unknown/custom Tool
- **WHEN** 用户打开会话并持续浏览到该请求的全部已加载步骤
- **THEN** 浏览器为获得 Capability 结果投影而新增的网络请求数 MUST 为 0
- **AND** 所有已返回结果 MUST 直接使用所属 history 页面中的安全投影或安全降级结果

#### Scenario: 快速导航不重复加载已取得的结果详情

- **GIVEN** 大数据量多轮会话的某个 history 页面及其 Capability 结果投影已经加载
- **WHEN** 用户通过预览区跳转、拖动滚动条、滚轮快速滚动或点击滚动条反复进入该页面覆盖的可视区域
- **THEN** 浏览器 MUST NOT 因结果详情进入或离开视口而重新请求或重新获取该页面的 Capability 结果内容
- **AND** 结果进入视口时 MUST 使用已加载的安全投影渲染

#### Scenario: 多轮快速滚动限制 run history 请求并发

- **GIVEN** 快速滚动连续命中超过 16 个包含过程历史的 run
- **WHEN** Agent Web 调度自动 history 加载
- **THEN** 同时进行的 run-event history 请求 MUST 不超过 4
- **AND** 单次稳定视口更新保留的自动目标 MUST 不超过 16
- **AND** 同一 run MUST NOT 存在两个并发加载请求

## MODIFIED Requirements

### Requirement: Capability Path Rejected Failure Visibility

TS Web channel SHALL 在 Capability invocation 确因路径访问策略而被阻止时，把 `safeErrorCode=CAPABILITY_PATH_REJECTED`、`safeErrorCategory=AUTHORIZATION` 或 `POLICY_DENIED`，以及不含被拒绝路径、文件系统细节或策略内部信息的安全失败事实投影到 `CAPABILITY_RESULT_DELTA` 或 `CAPABILITY_COMPLETED` envelope。可信后端共享 projector MUST 在该 code 与上述任一 category 组合时产生路径访问被策略阻止的语言中立失败摘要语义。`CAPABILITY_PATH_REJECTED` 携带其他受支持 category 时，共享 projector MUST 使用当前 category 的事实性失败语义。该 code 的 category 缺失时，共享 projector MUST 使用通用事实性失败语义。共享 projector MUST NOT 仅凭该 code 声称路径被策略阻止。前端 SHALL 只根据后端闭合失败摘要语义渲染本地化失败文案。所有组合均 MUST NOT 暴露被拒绝路径、文件系统细节或策略内部信息，也 MUST NOT 暗示 Capability 执行成功。

#### Scenario: 路径策略阻止产生安全错误事实

- **WHEN** 一个 Capability invocation 确因路径访问策略而被阻止
- **THEN** Web channel MUST 投影 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** Web channel MUST 投影 `safeErrorCategory=AUTHORIZATION` 或 `POLICY_DENIED`
- **AND** 投影 MUST 使用路径访问被策略阻止的语言中立安全摘要语义
- **AND** envelope MUST NOT 暴露被拒绝路径、文件系统细节或策略内部信息

#### Scenario: 路径拒绝的相容组合产生策略语义

- **GIVEN** 一个安全失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** `safeErrorCategory` 为 `AUTHORIZATION` 或 `POLICY_DENIED`
- **WHEN** 可信后端共享 projector 生成 Web 投影
- **THEN** 投影 MUST 携带路径访问被策略阻止的语言中立失败摘要语义
- **AND** 前端 MUST 依据该闭合语义显示本地化失败文案
- **AND** Web 投影和前端 MUST NOT 显示被拒绝路径、策略内部信息或成功状态

#### Scenario: 路径错误码与冲突类别服从类别语义

- **GIVEN** 一个 Capability 安全失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** `safeErrorCategory=CONFLICT`
- **WHEN** 可信后端共享 projector 生成 Web 投影
- **THEN** 投影 MUST 携带状态冲突的语言中立失败摘要语义
- **AND** 前端 MUST 显示对应的本地化失败文案
- **AND** Web 投影和前端 MUST NOT 声称路径访问被策略阻止

#### Scenario: 路径错误码缺少类别时安全降级

- **GIVEN** 一个 Capability 安全失败事实携带 `safeErrorCode=CAPABILITY_PATH_REJECTED`
- **AND** 该事实没有 `safeErrorCategory`
- **WHEN** 可信后端共享 projector 生成 Web 投影
- **THEN** 投影 MUST 携带通用事实性失败摘要语义
- **AND** 前端 MUST 显示对应的本地化失败文案
- **AND** Web 投影和前端 MUST NOT 声称路径访问被策略阻止

#### Scenario: 路径拒绝步骤不单独提升为请求失败

- **WHEN** 一个 Capability 因路径策略被阻止但当前 request 仍可继续
- **THEN** `RunStatus` MUST NOT 仅因 `CAPABILITY_PATH_REJECTED` 转换为 `FAILED`
- **AND** 该失败 MUST 通过 Capability 失败投影和既有 `DEGRADATION_NOTICE` 规则保持可见
- **AND** 后续 Capability 或模型轮次 MAY 按既有 routing policy 继续

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：用户可以查看由平台安全上限和集成呈现策略共同约束的 Capability 状态、摘要或安全详情；非终态步骤失败只陈述事实，请求终态只在有可靠行动依据时提供指导；live/history 与三种 Web 宿主保持一致。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实`、`Capability 生命周期事件不得显示内部协议标识`、`Capability 结果的用户可见投影由可信后端统一产生`、`工具结果投影不得因 Skill 或发现来源而变化`、`Capability Path Rejected Failure Visibility`

### 输入

- **变更类型**：修改
- **目标内容**：除既有 session、request、run 和 timeline facts 外，查看结果还使用启动期冻结的默认呈现级别、最终解析 Tool `capabilityId` 的精确匹配规则、SafeError 的 code/category/retryable、request terminal event 及当前 surface 已存在的用户行动入口；Skill 或 ToolSearch 来源不参与匹配。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实`、`工具结果投影不得因 Skill 或发现来源而变化`、`Capability Path Rejected Failure Visibility`

### 输出

- **变更类型**：修改
- **目标内容**：Capability 过程输出按有效级别返回状态、摘要或有界安全详情；失败输出只显示一次事实性原因并默认收起安全技术详情；请求终态只输出能够兑现的指导；未知、敏感、关联不可用或无法解释的协议语义安全降级，不向浏览器返回原始 Message 内容或内部协议文本。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实`、`Capability 生命周期事件不得显示内部协议标识`、`Capability 结果的用户可见投影由可信后端统一产生`、`Capability Path Rejected Failure Visibility`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统校验 canonical 关联，使用最终 Tool `capabilityId` 计算平台安全上限，取集成方期望级别与安全上限中更保守的一档；失败时按已审计且类别一致的具体 code、完整 category、通用兜底产生事实性语义，并区分请求终态与非终态步骤；live 与 history 输出同一安全投影，浏览器不从原始结果或协议标识重建详情。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实`、`Capability 生命周期事件不得显示内部协议标识`、`Capability 结果的用户可见投影由可信后端统一产生`、`工具结果投影不得因 Skill 或发现来源而变化`、`Capability Path Rejected Failure Visibility`

### 结果

- **变更类型**：修改
- **目标内容**：合法已知结果按配置呈现，非终态失败不虚构恢复或用户行动，请求终态只在行动可执行时提供指导，敏感或未知结果安全降级，非法配置阻止 ready，历史快速浏览不产生逐结果请求放大。
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`、`请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实`、`Capability 生命周期事件不得显示内部协议标识`、`Capability 结果的用户可见投影由可信后端统一产生`、`Capability Path Rejected Failure Visibility`、`大结果历史浏览不得产生逐结果请求放大`

### 规格

- **规格项**：Capability 结果呈现级别
- **变更类型**：新增
- **原规格值**：未定义稳定级别集合
- **目标规格值**：`STATUS_ONLY`、`SUMMARY`、`DETAIL`；最终级别不得突破平台安全上限
- **依据 Requirements**：`Capability 结果呈现策略受平台安全上限约束`

- **规格项**：大结果历史浏览容量边界
- **变更类型**：修改
- **原规格值**：单 request 最大用户可见过程步骤数为 500 的建议值，未定义结果详情请求和自动加载并发边界
- **目标规格值**：每个 request/run 最多 500 个过程步骤；已加载页面内每个 Capability 结果的附加请求为 0；自动 run-history 同时最多加载 4 个 run，单次稳定视口最多保留 16 个自动目标，同一 run 最多 1 个并发请求
- **依据 Requirements**：`大结果历史浏览不得产生逐结果请求放大`
