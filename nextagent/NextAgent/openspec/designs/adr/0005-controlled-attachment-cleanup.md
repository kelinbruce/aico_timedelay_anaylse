# ADR 0005: 受控 Attachment 清理

## 状态（Status）

Accepted

## 背景与现状（Context）

Attachment record 必须对 history、retry 和 context assembly 保持权威。Blob 字节可能变得过时或不再必要，但系统仍需要持久的 attachment 事实用于诊断和下游决策。

## 决策（Decision）

- 保留 `RequestAttachment` 元数据。
- 在策略允许时允许删除 blob。
- 将被清理 blob 的 attachment 可用性更新为 `UNAVAILABLE`。
- 拒绝直接的 `BlobRef` / 基于路径的清理输入。
- Cleanup 不参与 request terminal 归属。
- 本 change 不引入调度器。

## 结果（Consequences）

- History 和 retry 保持稳定的 attachment 事实。
- Cleanup 是显式且可观测的。
- 存储可以在 blob 删除后保留元数据。
- 未来的保留或维护工作可以作为单独 change 稍后添加。
