# agent-web-structured-message-rendering Specification Delta

## MODIFIED Requirements

### Requirement: 回答内容混合渲染

回答内容区域 MUST 同时渲染 `LLM_CONTENT_DELTA` 事件和 `toolEventType: "ANSWER"` 的 `TOOL_STRUCTURED_DELTA` 事件，按 `sequence` 排序。`LLM_CONTENT_DELTA` 事件 MUST 被合并为文本。`TOOL_STRUCTURED_DELTA` ANSWER 事件 MUST 通过分发到对应的 `toolMessageType` renderer 组件来渲染。

对于 `toolMessageType: "PIU"` 的 ANSWER 事件，当事件 `content` 携带非空 `uuid` 字符串字段时，`buildAnswerSegments` MUST 在结果中保留该 uuid 的所有 PIU segment（不做移除）。`AnswerSegments` 组件 MUST 只为每个 uuid 渲染最后一个 PIU segment（更早的返回 null），并 MUST 通过 `pendingContents` prop 把该 uuid 已累积的全部内容传给 `PiuMessage` 组件。`PiuMessage` 组件 MUST 通过 `piu.emit` 逐个发出 `pendingContents` 中的内容，并跳过已发出的内容（按 JSON 字符串 key），以避免重复渲染。当 `uuid` 缺失或为空时，每个 PIU segment MUST 被独立渲染，保持既有行为。`uuid` 字段 MUST 同时支持从对象形态和 JSON 字符串形态的 `content` 中提取。

`AnswerSegments` 组件 MUST 为携带非空 `uuid` 的 PIU segment 使用基于 uuid 的 React key（`structured-PIU-uuid-{uuid}`），使 `PiuMessage` 组件在内容更新期间保持挂载，并让每个 PIU 数据事件触发一次 `piu.emit` 调用。不带 `uuid` 的 PIU segment MUST 使用既有的基于 sequence 的 key（`structured-PIU-{sequence}`）。

#### Scenario: LLM 文本与结构化回答共存

- **WHEN** 某个 turn 同时有 `LLM_CONTENT_DELTA` 事件和 `TOOL_STRUCTURED_DELTA` ANSWER 事件
- **THEN** 回答内容 MUST 按 sequence 顺序交错渲染它们
- **AND** `LLM_CONTENT_DELTA` 事件 MUST 贡献文本内容
- **AND** `TOOL_STRUCTURED_DELTA` ANSWER 事件 MUST 贡献结构化 renderer 组件

#### Scenario: 相同 uuid 的 PIU 被最新内容替换

- **GIVEN** 两个 `toolMessageType: "PIU"` 且 `content` 中带相同非空 `uuid` 的 `TOOL_STRUCTURED_DELTA` ANSWER 事件
- **WHEN** `buildAnswerSegments` 处理这两个事件
- **THEN** 结果 MUST 恰好包含一个 PIU segment
- **AND** 该 segment MUST 携带较后事件的内容和 sequence

#### Scenario: PIU 替换保留中间 segment

- **GIVEN** 一个 `uuid: "X"` 的 PIU segment，后跟一个 TEXT segment，再后跟另一个 `uuid: "X"` 的 PIU segment
- **WHEN** `buildAnswerSegments` 处理全部事件
- **THEN** 结果 MUST 包含该 TEXT segment 和恰好一个 PIU segment
- **AND** 该 PIU segment MUST 携带较后 PIU 事件的内容和 sequence

#### Scenario: 不同 uuid 的 PIU 不被替换

- **GIVEN** 两个 `uuid` 值不同的 PIU ANSWER 事件
- **WHEN** `buildAnswerSegments` 处理这两个事件
- **THEN** 两个 PIU segment MUST 都出现在结果中

#### Scenario: 不带 uuid 的 PIU 不被替换

- **GIVEN** 两个 `content` 均不携带 `uuid` 字段的 PIU ANSWER 事件
- **WHEN** `buildAnswerSegments` 处理这两个事件
- **THEN** 两个 PIU segment MUST 都出现在结果中

#### Scenario: 从 JSON 字符串 content 中提取 PIU uuid

- **GIVEN** 一个 `content` 为 JSON 字符串、其中包含 `{ "uuid": "X", ... }` 的 PIU ANSWER 事件
- **WHEN** `buildAnswerSegments` 处理该事件
- **THEN** MUST 从解析后的 JSON 字符串中提取 `uuid`，用于渲染层去重

#### Scenario: 相同 uuid 的 PIU：一次渲染内到达多个事件时批量 emit

- **GIVEN** 多个 `toolMessageType: "PIU"` 且 `content` 中带相同非空 `uuid` 的 `TOOL_STRUCTURED_DELTA` ANSWER 事件，在同一次 `buildAnswerSegments` 调用中到达
- **WHEN** `AnswerSegments` 渲染这些 segment
- **THEN** MUST 只渲染一个 `PiuMessage`（该 uuid 的最后一个 segment）
- **AND** MUST 按顺序为每个 PIU 数据事件调用 `piu.emit`
- **AND** JSON 相同的重复内容 MUST NOT 被发出两次

#### Scenario: 相同 uuid 的 PIU 保持 PiuMessage 挂载并逐条 emit 数据

- **GIVEN** 一个已渲染的 `uuid: "X"` 且数据为 A 的 PIU segment，后跟另一个 `uuid: "X"` 且数据为 B 的 PIU ANSWER 事件
- **WHEN** `AnswerSegments` 带更新后的 segment 重新渲染
- **THEN** `PiuMessage` 组件 MUST 保持挂载（基于 uuid 的同一 React key）
- **AND** MUST 以数据 B 调用 `piu.emit`
- **AND** 此前 MUST 已以数据 A 调用过 `piu.emit`
