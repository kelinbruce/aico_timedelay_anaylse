# Attachment 生命周期

## 背景与现状（Context）

Attachment intake 现在产生权威的 `RequestAttachment` 事实，context / retry 流程已将这些事实作为稳定输入消费。Cleanup 通过移除不透明 blob 字节同时保留权威 attachment 事实来闭合生命周期。

## 决策（Decision）

- Cleanup 是一个由 `agent-attachment-runtime` 拥有的显式 capability。
- Cleanup 只由可信进程内流程触发。
- Cleanup 使用可信 owner scope、`agentId` 和 attachment 权威 record。
- Cleanup 可以删除 blob 字节并将 `availabilityStatus` 更新为 `UNAVAILABLE`。
- Cleanup 保留 `RequestAttachment` 元数据和历史证据。
- Cleanup 绝不拥有 request terminal 生命周期或调度器策略。
- 物化是 run 范围且 session 全局的：在每个 run 的 tool loop 之前，runtime 通过 `BlobStoreGateway.materializeBlob` 将 session 内（当前 request + 之前轮次）所有 `ACCEPTED`+`AVAILABLE` attachment 物化到该 run 的 `temp/attachments/{attachmentId}/{fileName}`；run terminal 清理移除整个物化视图。因此只要 blob 保持 `AVAILABLE`，历史 attachment 在后续轮次中仍可读取；只有 `availabilityStatus` 不再是 `AVAILABLE` 的 attachment 才降级为仅元数据。

## 流程（Flow）

1. 可信流程识别孤儿或不可用 attachment 候选。
2. Attachment runtime 加载权威 attachment record。
3. Cleanup 使用权威 session message 事实检查引用保护。
4. Cleanup 在被允许时删除 blob。
5. Cleanup 更新 attachment 可用性并发出安全证据。

## 非目标（Non-Goals）

- 无调度器或保留任务。
- 无批量扫描或管理员 cleanup 界面。
- 无 attachment 下载或 preview API。
- 普通清理不删除权威元数据。

## 验证（Verification）

- 可信 owner/agent scope 测试
- 引用保护测试
- blob 缺失和部分失败测试
- 审计与脱敏测试
- 架构边界评审
