## ADDED Requirements

### Requirement: Multi-question pending input uses one-question-at-a-time navigation

当 active `QUESTION` pending input 包含多个已接受问题时，agent-web MUST 在现有 response surface 中一次只呈现一个问题，并显示当前序号和问题总数。frontend MUST 在本地保存各题尚未提交的 answer draft，允许用户返回前一题检查或修改；翻页 MUST NOT 调用 answer route、创建新 request、创建额外 pending input、重新建立 stream 或推进原 run。

“下一步” MUST 复用当前问题类型的既有有效性规则：自由输入要求一个非空值，单选要求一个有效选择，多选要求一个或多个唯一选择，custom 激活时要求非空 custom text。当前题无效时不得进入下一题。最终提交只可在最后一题且全部问题有效时发生，并 MUST 通过现有 pending-input answer route 一次提交按问题顺序排列的完整 `answers[][]`。

frontend MUST NOT 仅因为 runtime 已接受的问题数超过 model-facing 3 题约束而拒绝显示或提交；它必须支持系统在 20 项技术边界内兜底接收的 pending input。该兼容能力不得改变模型每次最多 3 题的正常契约，也不得在 UI 中把 20 题宣传为建议额度。单问题交互 MUST 保持现有直接填写和提交行为。pending input id 变化时，页码和草稿 MUST 一起重置；页面刷新后的未提交草稿 MAY 重置，因为其仍是 frontend view state，不是 durable execution fact。

进度、上一步、下一步和最终提交 MUST 具有可访问名称并可通过键盘操作。切换问题后，焦点 MUST 移到新问题的 prompt 或首个输入控件，避免键盘与屏幕阅读器用户停留在已经隐藏的页面。

#### Scenario: Four-question input is answered one question at a time

- **WHEN** active pending input 包含 4 个有效问题
- **THEN** response surface MUST 只渲染当前一个问题并显示 `1 / 4`
- **AND** 第一题未完成时“下一步” MUST 不可用
- **WHEN** 用户完成当前题并逐题前进
- **THEN** 每次翻页 MUST 只改变本地页码并保留已填写草稿
- **AND** focus MUST move to the newly visible question
- **AND** 页面 MUST NOT 在翻页时发送 answer、conversation、request 或额外 stream 请求

#### Scenario: Previous navigation preserves editable drafts

- **GIVEN** 用户已经回答前两题并进入第三题
- **WHEN** 用户返回第一题
- **THEN** 第一题与第二题的草稿 MUST 保持可见
- **AND** 用户 MUST 能修改第一题后再次前进
- **AND** 最终提交 MUST 使用修改后的完整 ordered `answers[][]`

#### Scenario: Final page submits all answers once

- **GIVEN** 一个多问题 pending input 的全部问题均已有效回答
- **WHEN** 用户在最后一题触发提交
- **THEN** frontend MUST 通过现有 answer route 发送恰好一个 answer request
- **AND** request MUST 按原始问题顺序包含全部 answer groups
- **AND** frontend MUST NOT 为每道题分别提交或创建多个 pending input

#### Scenario: Submit failure keeps the current questionnaire state

- **WHEN** 最终 answer request 返回安全错误
- **THEN** response surface MUST 保留当前页码与全部本地草稿
- **AND** 用户 MUST 能修正答案或重试提交
- **AND** frontend MUST NOT 自动跳到第一题、丢弃已填内容或创建新的 run

#### Scenario: Twenty fallback-accepted questions remain usable without rendering all at once

- **WHEN** runtime 投影包含 20 个已接受问题
- **THEN** agent-web MUST 支持从第一题导航到最后一题
- **AND** 任一时刻 MUST 只渲染当前问题的输入控件
- **AND** 导航与最终操作 MUST 保持可达，页面不得因同时铺开全部问题而溢出或冻结

#### Scenario: Single question retains direct interaction

- **WHEN** active pending input 只包含一个问题
- **THEN** response surface MUST 直接显示该问题与最终提交动作
- **AND** frontend MUST NOT 显示无意义的上一步或下一步流程
