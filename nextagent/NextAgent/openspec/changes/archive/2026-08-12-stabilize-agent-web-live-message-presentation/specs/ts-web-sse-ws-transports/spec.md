## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Tool 轮次执行说明与 Tool 调用连续呈现

当模型在同一 Tool 轮次输出公开说明和 Tool 调用时，系统 MUST 按“该轮前置 thinking、公开执行说明、关联 Tool 调用”的规范顺序向用户呈现过程。公开执行说明 MUST 使用关联消息中的安全公开正文，并 MUST NOT 被呈现为具有独立标题、独立状态图标、完成对勾或独立展开控制的过程步骤。

执行说明 MUST 随执行详情大面板统一显示或隐藏；大面板展开时，该说明 MUST 直接可见。系统 MUST NOT 为说明增加“接下来”或其他不属于关联消息正文的固定界面文案。既有 thinking、Tool、PIU 和普通过程步骤的图标、状态与 disclosure 语义 MUST 保持不变。

待定桥接内容和完成执行说明 MUST 使用与最终答案相同的公开正文排版和 Markdown 渲染语义，包括字体、字号、行高、字重、主文字色和换行规则。执行说明正文 MUST 与展开后的 thinking 正文使用同一内容列左边界，并且 MUST NOT 使用独立底色、独立边框、圆角容器或额外水平内边距表达其归属。

模型公开输出尚未完成、系统尚不能确定其后是否存在 Tool 调用时，具有非空 `stepId` 且不具有 `final=true` 的进行中累计内容 MUST 在执行详情中使用无独立图标的待定桥接位置流式呈现，并且 MUST NOT 同时出现在最终答案位置。后续产生 Tool 调用时，同一 `stepId` 的完成说明 MUST 在该位置原地接管进行中内容；后续没有产生 Tool 调用时，最终 Assistant 输出 MUST 接管既有最终答案位置，并且执行详情 MUST 不再保留该待定内容。语义确认过程 MUST NOT 清空后重新播放已经呈现的文字。

系统为 Agent Core model step 投影具有非空 `stepId` 且不具有 `final=true` 的 `LLM_CONTENT_DELTA` 时，Web stream payload 的 `content` 和 `text` MUST 是该 `stepId` 内的累计公开正文。系统 MUST 在同一 `stepId` 内按生成顺序累计已确认的输出续写片段和当前 invocation 正文，并 MUST 在 `stepId` 改变时建立独立累计边界；新 step 的正文 MUST NOT 包含任一先前 step 的正文。不同 step 产生相同文本时，系统 MUST 保留这些独立事实，并 MUST NOT 根据文本相等、前缀关系或相似度合并或删除其中任一事实。

SSE 与 WebSocket 的共享 Web 投影 MUST 保留运行时 `LLM_CONTENT_DELTA` 中安全的 `final` 布尔标识。浏览器 MUST 使用该 canonical 标识区分待定过程内容与最终 Assistant 输出，并 MUST NOT 仅根据 `REQUEST_COMPLETED` 到达或刷新后的历史快照推断终局语义。

最终 Assistant 输出接管待定内容时 MUST 直接使用既有最终答案的左对齐位置。接管过程 MUST NOT 改变正文的字体、字号、行高、透明度或换行规则，MUST NOT 清空、重建或重新打字，也 MUST NOT 播放横向位置过渡或淡入淡出动画。系统 MUST 复用既有执行详情高度与滚动锚点补偿保持正文首行的纵向阅读焦点。

只有同时包含 Tool 调用事实的公开内容适用本 Requirement 中的执行详情桥接规则。没有后续 Tool 调用的模型公开输出 MUST 继续遵循最终 Assistant Message 的既有输出与持久化语义。浏览器在同一次逐帧投影中 MUST 直接显示当前已经接收并合并的完整累计正文，MUST NOT 使用独立计时器把已经接收的正文再次拆分为逐字更新；该呈现规则 MUST NOT 改变 envelope 顺序、terminal 收敛或 history 恢复结果。

当一个请求在一个或多个已完成 Tool 轮次之后进入终止模型轮次时，最终 Assistant Message MUST 只包含该终止模型轮次形成的完整安全回答，包括该轮次内合法的输出续写片段和终态 hook 替换结果；它 MUST NOT 包含先前 Tool 轮次的公开执行说明、Tool 调用参数或 Tool 结果正文。先前 Tool 轮次的公开执行说明 MUST 继续通过其消息引用事件在过程区显示，并 MUST NOT 因最终 Assistant Message、刷新、重连或 history 加载而出现第二次。

**需求类别**：功能性需求

#### Scenario: 执行说明连接思考与同轮 Tool 调用

- **WHEN** 一个 Tool 轮次具有已完成 thinking、非空公开说明和至少一个 Tool 调用
- **THEN** 用户 MUST 先看到该轮 thinking，再看到消息中的安全公开说明，随后看到关联 Tool 调用
- **AND** 公开说明 MUST NOT 显示独立标题、独立状态图标、完成对勾或展开按钮
- **AND** 公开说明对应的完成事件 MUST 在用户可见序列中位于同轮关联 Tool 的 `CAPABILITY_STARTED` 之前
- **AND** 用户看到的说明正文 MUST NOT 包含系统额外添加的固定引导文案
- **AND** 说明正文 MUST 与展开后的 thinking 正文左边界对齐
- **AND** 说明正文 MUST 使用最终答案的公开正文排版且不得具有独立底色或边框

#### Scenario: 进行中公开输出保持待定桥接位置

- **WHEN** 模型正在流式输出具有非空 `stepId` 且不具有 `final=true` 的累计公开内容
- **AND** 系统尚未确认该轮是否产生 Tool 调用
- **THEN** 用户 MUST 在执行详情中的无独立图标桥接位置看到该内容
- **AND** 最终答案位置 MUST NOT 同时显示该内容
- **AND** 同一 `stepId` 的后续完成说明 MUST 原地接管该桥接位置且不得重新播放正文

#### Scenario: 后续 model step 不继承先前执行说明

- **GIVEN** 一个 model step 已经产生非空公开执行说明并进入 Tool 调用
- **WHEN** 后续 model step 发布具有不同非空 `stepId` 的非终态 `LLM_CONTENT_DELTA`
- **THEN** 新事件的 `content` 和 `text` MUST 只包含新 `stepId` 产生的累计公开正文
- **AND** 新事件 MUST NOT 包含先前 step 的公开执行说明

#### Scenario: 同一 model step 的输出续写保持累计

- **GIVEN** 一个 model step 因输出长度限制形成一个或多个已确认续写片段
- **WHEN** 系统为同一 `stepId` 发布后续非终态 `LLM_CONTENT_DELTA`
- **THEN** 后续事件 MUST 按生成顺序包含该 step 已确认的全部续写片段和当前 invocation 正文
- **AND** 该累计正文 MUST NOT 包含其他 `stepId` 的正文

#### Scenario: 不同步骤的相同正文保持独立

- **GIVEN** 两个不同 `stepId` 的 model step 分别产生完全相同的公开正文和 Tool 调用
- **WHEN** 系统投影这两个 step 的非终态 `LLM_CONTENT_DELTA`
- **THEN** 系统 MUST 保留两个具有各自 `stepId` 的独立事件事实
- **AND** 系统 MUST NOT 因正文相同而合并、隐藏或删除任一事实

#### Scenario: 没有后续 Tool 调用时保持最终答案语义

- **WHEN** 模型公开输出完成后没有产生 Tool 调用
- **THEN** 该输出 MUST 继续显示在既有最终答案位置
- **AND** 系统 MUST NOT 将其投影为执行详情中的桥接说明
- **AND** 执行详情 MUST 移除同一轮的待定桥接内容且不得在最终答案位置重新播放已经呈现的正文
- **AND** 最终答案 MUST 保持既有左对齐位置
- **AND** 接管过程 MUST 不改变正文排版、透明度或换行，并 MUST 保持正文首行的纵向阅读焦点

#### Scenario: 最终答案只随逐帧 Web stream 投影推进

- **GIVEN** 模型公开输出没有产生 Tool 调用
- **WHEN** 浏览器在一次逐帧投影中接收并合并新的累计正文
- **THEN** 最终答案位置 MUST 直接显示该累计正文的全部已接收内容
- **AND** 在下一次 Web stream 投影到达前 MUST NOT 使用独立计时器继续推进同一份正文
- **AND** terminal 到达后 MUST 直接显示最后累计正文且不得等待浏览器本地字符 backlog

#### Scenario: 多个 Tool 轮次后只提交终止轮次回答

- **GIVEN** 同一请求依次完成至少两个具有非空公开执行说明的 Tool 轮次
- **WHEN** 后续终止模型轮次产生不含 Tool 调用的最终回答
- **THEN** 最终 Assistant Message MUST 完整等于该终止模型轮次的安全回答
- **AND** 最终 Assistant Message MUST NOT 包含任一先前 Tool 轮次的公开执行说明
- **AND** 每个先前 Tool 轮次的公开执行说明 MUST 只在对应过程时序位置显示一次

#### Scenario: 终止轮次输出续写保持完整且不带入先前说明

- **GIVEN** 一个请求已经完成具有公开执行说明的 Tool 轮次
- **AND** 终止模型轮次因输出长度限制在同一轮次内完成合法续写
- **WHEN** 系统提交最终 Assistant Message
- **THEN** 最终 Assistant Message MUST 包含该终止模型轮次全部已确认续写片段
- **AND** 最终 Assistant Message MUST NOT 包含先前 Tool 轮次的公开执行说明

#### Scenario: 刷新历史不重新产生跨区域重复

- **GIVEN** 一个已完成请求包含 Tool 轮次公开执行说明和终止轮次最终回答
- **WHEN** 用户刷新或重新打开该历史会话
- **THEN** history MUST 在执行详情中恢复每个 Tool 轮次说明一次
- **AND** history MUST 在最终答案位置只恢复终止轮次最终回答
- **AND** 系统 MUST NOT 通过消息拼接、事件回退或浏览器缓存把先前说明加入最终答案

#### Scenario: Web 投影保留最终答案标识

- **GIVEN** runtime 发布携带 `final=true` 的 `LLM_CONTENT_DELTA`
- **WHEN** channel 将该事件投影为 SSE 或 WebSocket `StreamEnvelope`
- **THEN** 投影 payload MUST 保留 `final=true`
- **AND** 浏览器 MUST 在 live 状态立即移除未完成待定过程副本
- **AND** 最终答案 MUST 只在既有答案位置显示一次

#### Scenario: 最终答案直接完成待定内容接管

- **WHEN** 最终 Assistant 输出接管执行详情中的待定桥接内容
- **THEN** 系统 MUST 直接使用既有最终答案位置和排版显示正文
- **AND** 系统 MUST NOT 播放横向位置过渡、淡入淡出或重新打字效果

## Function 变更汇总

### 结果

- **变更类型**：修改
- **目标内容**：系统按顺序向用户呈现会话流中的公开执行说明、关联 Tool 调用和最终回答；最终回答只随逐帧 Web stream 投影推进，不在浏览器内再次逐字重放；最终回答接管待定过程正文时直接稳定显示于既有答案位置，不产生横向位移、淡入淡出或重复正文。
- **依据 Requirements**：`Tool 轮次执行说明与 Tool 调用连续呈现`

### 规格

- **规格项**：Tool 轮次说明
- **变更类型**：修改
- **原规格值**：在 thinking 与同轮 Tool 之间直接呈现，无独立标题、状态图标或展开控制
- **目标规格值**：在 thinking 与同轮 Tool 之间直接呈现，无独立标题、状态图标或展开控制；最终回答只随逐帧 Web stream 投影推进；最终回答接管时直接使用既有答案左边界且不播放位置动画
- **依据 Requirements**：`Tool 轮次执行说明与 Tool 调用连续呈现`
