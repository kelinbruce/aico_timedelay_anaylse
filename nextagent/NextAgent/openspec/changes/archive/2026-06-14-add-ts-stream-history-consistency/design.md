## 背景和现状（Context）

本 change 依赖 `add-ts-stream-resume-replay` 的最小恢复语义。它不重新定义 stream resume source、activeRun bootstrap、cursor rule 或 terminal result read path。

## 设计决策（Decisions）

### 1. 历史最终内容只来自 visible `SessionMessage`

History read 的黑盒结果是用户看到已提交的历史对话。这个最终内容只能来自 session read path 返回的 visible `SessionMessage`。

不得使用以下来源重建最终历史：

- stream envelope
- timeline replay
- projection cache
- frontend cache
- channel replay buffer

### 2. 当前 active run 未提交内容不属于 history final content

如果页面刷新或新设备打开会话时存在 `activeRun`，已提交历史由 conversation history 展示；当前 active run 已生成但尚未提交为 visible history 的内容由 `activeRun + lastSeenSequence=0` 的 run-scoped stream replay 恢复。

history 不负责从 timeline 重建当前 run partial content。

### 3. `resumeAfterSequence` 必须由 refresh 成功 gate

收到 stream gap notice 后，前端必须刷新同一 session 的 visible conversation。只有 refresh 成功返回可用的 conversation page，下一次 resume 才能使用 gap notice 中的 `resumeAfterSequence`。

refresh 失败、返回降级、不可用或 scope 不匹配时，前端不得使用 `resumeAfterSequence`，必须保留当前页面最后成功接收的 timeline-backed cursor，并显示降级或失败状态。

### 4. 失败必须显式

history refresh 失败不能被解释为完整历史。前端必须保留恢复失败或降级提示；后续重试仍从当前页面最后成功接收的 timeline-backed cursor 或重新 bootstrap active run 开始。

## 放弃方案

- 放弃 terminal result consistency 和 terminal facts mismatch 状态机。
- 放弃 history timeout/budget 细化。
- 放弃通过 timeline replay 或 stream envelope 重建最终历史。
- 放弃后台 repair job 作为当前 change 的必要路径。

## 验证策略

- 验证 history read 使用 visible messages。
- 验证 history 不从 stream envelope 或 timeline replay 重建最终内容。
- 验证 gap refresh 成功后才使用 `resumeAfterSequence`。
- 验证 refresh 失败不推进 cursor，并显示降级或失败。
