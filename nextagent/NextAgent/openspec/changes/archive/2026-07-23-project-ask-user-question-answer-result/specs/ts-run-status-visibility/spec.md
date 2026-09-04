## ADDED Requirements

### Requirement: AskUserQuestion answer result exposes only a bounded safe projection

当 Web channel 把 canonical `AskUserQuestion` 的已接受 `QUESTION` answer result 投影到 session stream 或 conversation capability-result item 时，两条路径 MUST 复用同一个 AskUserQuestion answer projector，并输出相同的有界安全投影。stream `CAPABILITY_RESULT_DELTA` payload MUST 合并该投影；conversation capability-result item MUST 通过可选 `pendingInputAnswer` 字段携带同一投影。投影 MUST 携带同一原始 tool call 的 `capabilityId`、`toolCallId`、`pendingInputId`、`kind="QUESTION"` 和 `status="RECEIVED"`。其中 `safeResult` MUST 使用 `kind="pendingInputAnswer"`，并只包含有序 `answers` 与 `truncated`。`answers` 的可信来源 MUST 是 durable `CAPABILITY_RESULT` 所代表的 runtime-accepted answer，不得是 Web answer request body 或 frontend local state。

安全投影 MUST 按 group、group 内 item 和字符串中的 Unicode code point 顺序遍历，接受至多 20 个 answer group、每组至多 9 个字符串、每个字符串至多 4096 个 Unicode code point，并把全部 projected answer string 的总长度限制为 24576 个 Unicode code point。任一 group、item、字符串或总长度被裁剪时，`truncated` MUST 为 `true`；没有裁剪时 MUST 为 `false`。总长度预算耗尽后，channel MUST 省略后续 item 和 group，不得生成空 answer string。除上述字段外，projector MUST NOT 把 stored result 或 runtime event 中的其他字段复制到 `safeResult`、`text`、`safeSummary` 或 `metadata`。conversation message 的既有 canonical `content` 保持兼容，但 frontend MUST NOT 从该字段推导回答展示。

只有 `capabilityId="AskUserQuestion"`、pending kind 为 `QUESTION`、状态为 `RECEIVED`、`toolCallId` 与 `pendingInputId` 均为非空字符串且 `answers` 为有序非空字符串数组时，channel 才能输出该 safe result。任一条件不成立时，channel MUST 省略 `safeResult` 并使用不包含回答正文的安全摘要；MUST NOT 猜测或修复关联坐标。

#### Scenario: Valid accepted answers keep order in the safe result

- **WHEN** Web channel 从 live event 或 durable capability-result message 收到 canonical `AskUserQuestion` 的有效已接受 answer result
- **THEN** projected `safeResult.kind` MUST 为 `pendingInputAnswer`
- **AND** answer group、group 内 answer 和字符串内容 MUST 保持 runtime-accepted order
- **AND** `pendingInputId` MUST 只作为 envelope payload 的受控关联字段，不得复制进 `safeResult`
- **AND** safe projector 输出中的 `text`、`content`、`safeSummary` 和 `metadata` MUST NOT 复制回答正文
- **AND** 该限制 MUST NOT 改变 conversation message 既有 canonical `content`

#### Scenario: Stream and conversation use the same safe projection

- **WHEN** 同一 runtime-accepted AskUserQuestion answer fact 同时通过 session stream 和 conversation API 投影
- **THEN** stream payload 与 conversation item `pendingInputAnswer` 中的 capability identity、pending input correlation、status、`safeResult`、safe summary 和 truncation state MUST 相同
- **AND** frontend MUST NOT 从 conversation message canonical `content` 再次解析或裁剪回答

#### Scenario: Over-budget accepted answer is deterministically truncated

- **WHEN** 可投影 answer result 的 group 数、任一 group 的 item 数、任一字符串长度或全部 answer string 总长度超过安全投影边界
- **THEN** Web channel MUST 按有序遍历保留至多前 20 个 group、每组前 9 个 item、每个 item 的前 4096 个 Unicode code point 和总计前 24576 个 Unicode code point
- **AND** projected `safeResult.truncated` MUST 为 `true`
- **AND** safe projector MUST NOT 把被裁剪内容复制到 projector 输出的其他字段

#### Scenario: Malformed or non-question result fails closed

- **WHEN** capability id、pending kind、status、tool call id、pending input id 或 answers shape 不满足该 safe projection 的全部前置条件
- **THEN** stream projection MUST 省略 answer `safeResult`，conversation projection MUST 省略 item 的 `pendingInputAnswer` 字段
- **AND** safe projector 输出 MUST NOT 包含任一 answer value
- **AND** frontend MUST 仍能显示不包含回答正文的安全 result summary

#### Scenario: USER_INPUT_RECEIVED remains answer-free

- **WHEN** Web channel 投影同一 pending input 的 `USER_INPUT_RECEIVED`
- **THEN** 该 event MUST NOT 携带 `answers`、`safeResult` 或任一回答正文
- **AND** answer 正文 MUST 仅通过对应 `CAPABILITY_RESULT_DELTA` 的 allowlisted safe result 或 durable history result 可见
