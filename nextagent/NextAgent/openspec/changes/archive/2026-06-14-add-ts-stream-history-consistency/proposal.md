## Why

`add-ts-stream-resume-replay` 解决 stream 断线和刷新后的观察恢复。本 change 只补齐一个下游黑盒问题：当 stream 发生 gap 或页面刷新后，历史对话最终内容不能由 stream envelope、timeline replay 或前端缓存重建，且 `resumeAfterSequence` 不能在 visible conversation refresh 成功前被当作 cursor 使用。

## What Changes

- 明确 history final content 只来自 visible `SessionMessage`。
- 明确 stream replay 只恢复 runtime process stream content，不重建最终历史内容。
- 明确 gap 后必须刷新同一 session 的 visible conversation；refresh 成功后，下一次 resume 才能使用 `resumeAfterSequence`。
- 明确 refresh 失败时保留当前页面最后成功接收的 timeline-backed cursor，并显示降级或失败状态。

## 非目标（Out of Scope）

- 不治理 terminal result consistency。
- 不新增 terminal-result Web API、public DTO 或 terminal facts mismatch 状态机。
- 不做 stream/history/terminal 三方全量一致性校验。
- 不新增 history 专用事实表、channel-owned replay/history source、projection cache truth 或后台 repair job。
- 不定义 history timeout/budget 细节、retention window 或 large payload 协议。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-stream-history-consistency`: 定义 gap 后 visible conversation refresh 如何 gates `resumeAfterSequence`，并固定 history final content 的事实来源为 visible `SessionMessage`。

### 修改的 Capability

- 无。

## 影响范围（Impact）

- 前端：gap 后必须通过同一 session 的 conversation refresh 成功结果来决定是否使用 `resumeAfterSequence`。
- Session history：继续使用 visible `SessionMessage` 作为历史最终内容来源。
- Web channel：不得用 stream envelope、timeline replay 或 projection cache 重建最终历史内容。
- 测试：覆盖 history visible message source、gap refresh 成功/失败的 cursor 行为、refresh 失败时不显示伪完整历史。

## 成功标准

- 已提交历史通过 visible `SessionMessage` 恢复。
- 当前 active run 未提交内容通过 activeRun scoped replay 恢复，不由 history 重建。
- `resumeAfterSequence` 只在 visible conversation refresh 成功后使用。
- refresh 失败时不推进 cursor，不输出伪完整历史。
