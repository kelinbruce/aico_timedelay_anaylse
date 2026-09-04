## ADDED Requirements

### Requirement: AskUserQuestion process projection keeps one supplemental-information entry

agent-web MUST 使用同一 session、root request、`runId` 和 `pendingInputId` 关联 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED` 与 canonical `AskUserQuestion` 的 `pendingInputAnswer` result。`USER_INPUT_REQUIRED` MUST 提供问题与选项，`USER_INPUT_RECEIVED` MUST 提供已接收状态，`pendingInputAnswer` MUST 提供回答正文。frontend MUST 把三者投影为同一次补充信息交互的一个 process entry；匹配的 received event 与 answer result MUST 更新或补全该条目，MUST NOT 再显示为独立 response entry 或通用 `AskUserQuestion` tool result。conversation/history capability-result item MAY 不携带 live event 的 `requestContextId`；frontend MUST NOT 因该字段缺失而拆分同一 run 的 interaction。

同一 attempt 中的一个 `pendingInputId` MUST 最多形成一个 process entry。仅有 `USER_INPUT_REQUIRED` 时，该条目的 zh-CN 标题 MUST 为“等待补充信息”，其他 locale MUST 使用等价本地化语义；detail MUST 按原始顺序显示问题以及 option question 的可选项、单选/多选和允许自定义输入的可见含义。收到 `USER_INPUT_RECEIVED` 或 matching `pendingInputAnswer` 后，frontend MUST 更新同一个语义条目，而不是增加 response entry；回答阶段的 zh-CN 标题 MUST 为“用户补充信息”，其他 locale MUST 使用等价本地化语义；MUST NOT 使用“已响应”作为独立标题、状态后缀或第二个 process entry。frontend MUST NOT 为该 pending answer 创建新的顶层用户消息、conversation turn 或 root request。

存在 matching `pendingInputAnswer` 时，detail MUST 按 question position 显示问题与回答。单问题 MUST 显示一个问题—回答对；多问题 MUST 按原始顺序编号并逐项显示问题—回答对。对应问题包含 options 时，frontend MUST 把与 option `value` 精确匹配的回答显示为该 option 的 `label`；custom text 或没有匹配 label 的已接受回答 MUST 按 safe result 中的文本显示。多选回答 MUST 在对应问题内保持 runtime-accepted 顺序。`safeResult.truncated=true` 时，条目 MUST 显示本地化的内容截断提示，不得静默省略该事实。frontend MUST NOT 使用本地提交值补齐缺失的 stream/history result。

#### Scenario: Live answer enriches the existing interaction

- **WHEN** 当前页面依次接受同一 attempt 和 `pendingInputId` 的 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED` 与有效 `pendingInputAnswer`
- **THEN** process detail MUST 只显示一个标题表达“用户补充信息”的 entry
- **AND** 该 entry MUST 按问题位置显示问题与实际回答
- **AND** matching option value MUST 显示对应 label
- **AND** custom 或未匹配的 answer MUST 显示其 safe projected text
- **AND** 页面 MUST NOT 显示独立“已响应”entry 或通用 `AskUserQuestion` result entry
- **AND** 页面 MUST NOT 增加一条顶层用户消息

#### Scenario: Supported question shapes use one paired display

- **WHEN** 一个 AskUserQuestion 按原始顺序包含一至三个正常问题或系统兼容兜底接收的四至二十个问题，且问题使用自由输入、单选、多选或允许自定义输入中的任一形状
- **THEN** 每个问题与其同位置 answer group MUST 在同一个补充信息 entry 中配对显示
- **AND** 单选 MUST 显示一个 option label，多选 MUST 按已接受顺序显示全部 option label，custom MUST 显示安全投影文本
- **AND** 多问题 MUST 使用可见编号保持问题与回答的对应关系
- **AND** 该 pending input 的 process entry 数量 MUST 保持为一

#### Scenario: Truncated answer is visibly disclosed

- **WHEN** matching `pendingInputAnswer.safeResult.truncated` 为 `true`
- **THEN** 补充信息 entry MUST 显示仍被保留的问题与回答内容
- **AND** detail MUST 显示本地化的“内容过长，已截断”提示
- **AND** frontend MUST NOT 从 raw message content 或本地提交值恢复被裁剪内容

#### Scenario: Terminal settlement preserves the complete interaction

- **WHEN** 包含完整 AskUserQuestion interaction 的 active live attempt 收到 terminal event
- **THEN** active presentation MUST 在一次可观察状态转换中进入 settled presentation
- **AND** 单个补充信息 entry 的标题、问题—回答配对、顺序、截断提示和展开后的 detail MUST 保持不变
- **AND** 同一 session 的后续 submit 与 terminal completion MUST NOT 删除或缩减该 settled interaction

#### Scenario: Durable history reconstructs the same answer result

- **WHEN** conversation load、opening reconcile、manual refresh 或 gap recovery 返回 canonical `AskUserQuestion` durable result 对应的 conversation item `pendingInputAnswer`
- **THEN** history adapter MUST 把该字段映射为与 live `pendingInputAnswer` 同形的 history envelope
- **AND** history adapter MUST NOT 解析 raw stored capability payload 或重新执行 answer 安全裁剪
- **AND** 如果对应 process events 可用，frontend MUST 按同一 root、attempt 和 `pendingInputId` 恢复同一个补充信息 entry
- **AND** live result 与 history result 同时存在时 MUST 合并进该 entry
- **AND** frontend MUST NOT 同时显示补充信息 entry、独立 response entry 与重复的通用 tool result

#### Scenario: Durable answer without a matching question remains visible

- **WHEN** history 或 live projection包含有效 `pendingInputAnswer`，但当前可用 process events 不包含同一 `pendingInputId` 的 `USER_INPUT_REQUIRED`
- **THEN** frontend MUST 显示一个标题表达“用户补充信息”且包含实际安全回答的 entry
- **AND** frontend MUST 标明问题内容不可用
- **AND** frontend MUST NOT 把 result 隐藏、关联到其他 pending input 或降级为不包含回答的通用 tool result

#### Scenario: Received event without answer result remains generic

- **WHEN** frontend 只收到 `USER_INPUT_RECEIVED`，但没有对应 live 或 durable `pendingInputAnswer`
- **THEN** frontend MUST 更新同一补充信息 entry，并显示不包含回答正文的“回答内容暂不可用”安全文案
- **AND** frontend MUST NOT 创建独立“已响应”entry
- **AND** frontend MUST NOT 从 browser request body、composer cache 或其他 attempt 猜测回答

#### Scenario: Correlation never crosses attempts or pending inputs

- **WHEN** 同一 root 存在 retry/edit attempt，或同一 run 先后存在不同 `pendingInputId`
- **THEN** frontend MUST 只关联 session、root、`runId` 与 `pendingInputId` 全部匹配的 event 和 result
- **AND** 较早 attempt 或其他 pending input 的回答 MUST NOT 出现在当前 interaction

#### Scenario: Durable answer without request context joins the matching live interaction

- **WHEN** `USER_INPUT_REQUIRED` 携带 root、run、`requestContextId` 和 `pendingInputId`，而同一 durable conversation answer 只携带相同 root、run 和 `pendingInputId`
- **THEN** frontend MUST 把两者合并为同一个补充信息 entry
- **AND** frontend MUST NOT 把 conversation answer 的 request-id fallback 当作新的 attempt
- **AND** 不同 `runId` 的 answer MUST 继续保持隔离

#### Scenario: Live-only delivery loss recovers from conversation without cursor invention

- **WHEN** 当前页面未收到 live-only `pendingInputAnswer`，随后通过页面刷新、opening reconcile 或 stream gap recovery 加载到 durable result
- **THEN** frontend MUST 从 conversation/history 恢复回答展示
- **AND** frontend MUST NOT 把 live-only result 视为 `lastSeenSequence` 的推进依据
- **AND** frontend MUST NOT 为恢复回答创建额外 stream、额外 request run 或重复 process entry

#### Scenario: Duplicate live or history results are idempotent

- **WHEN** frontend 多次接收相同 attempt、tool call 和 `pendingInputId` 的 answer result
- **THEN** 每次投影后的可见 interaction MUST 与首次完整投影相同
- **AND** 该 `pendingInputId` 的 process entry 数量 MUST 始终为一
