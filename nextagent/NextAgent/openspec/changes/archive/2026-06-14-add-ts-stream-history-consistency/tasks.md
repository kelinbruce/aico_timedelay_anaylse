## 1. 最小 history consistency 行为

- [x] 1.1 验证 history read 使用 visible `SessionMessage`，不从 stream envelope、timeline replay 或 projection cache 重建最终历史。
- [x] 1.2 验证页面刷新/新设备时，已提交历史由 conversation history 恢复，当前 active run 未提交内容由 activeRun scoped stream replay 恢复。
- [x] 1.3 验证 gap refresh 成功后才使用 `resumeAfterSequence` 作为下一次 resume anchor。
- [x] 1.4 验证 gap refresh 失败时不推进 cursor，并保留降级或失败提示。

## 2. 归档准备

- [x] 2.1 使用标准 `## Why` 和 `## What Changes` proposal 标题，消除 archive proposal warning。
- [x] 2.2 在临时副本执行 archive dry run，并验证真实仓库不产生 archive 目录。
