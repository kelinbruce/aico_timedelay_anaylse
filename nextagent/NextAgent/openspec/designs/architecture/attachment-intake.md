# Attachment Intake

## 背景与现状（Context）

Attachment intake 是把不可信 attachment 输入在 request 接受之前转换为权威 attachment 事实的请求入口边界。它位于 channel 入口和 runtime acceptance 之间，不拥有 cleanup 或 context 分类。

## 决策（Decision）

- Attachment intake 由 `agent-attachment-runtime` 拥有。
- 携带 attachment 的请求 MUST 使用 `multipart/form-data`。
- Intake MUST 只在校验成功后创建权威 `RequestAttachment` 事实和不透明 `BlobRef` 值。
- Intake MUST 对任何非法 attachment 或写入失败 fail closed。
- Intake MUST 只向下游传递 `attachmentIds`。

## 流程（Flow）

1. 请求入口接收 attachment 输入。
2. Runtime 校验 owner scope、attachment 数量、大小、类型和可读性。
3. Runtime 将被接受的字节存入 blob 存储。
4. Runtime 写入权威 `RequestAttachment` 元数据。
5. Runtime 返回 `attachmentIds`，供后续 acceptance 和 context 流程使用。

## 非目标（Non-Goals）

- 无 cleanup 调度或保留策略。
- 无 request-context 分类。
- 无 attachment preview 或下载 API。
- 无客户端声明的 attachment 权限字段。

## 验证（Verification）

- Multipart 入口校验测试
- 数量、大小和类型上限测试
- Owner/agent scope 拒绝测试
- blob 写入和元数据写入失败测试
- Safe error 与脱敏测试
