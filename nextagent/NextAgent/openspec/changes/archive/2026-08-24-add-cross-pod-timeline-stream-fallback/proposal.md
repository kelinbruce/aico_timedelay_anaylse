## 情景与问题（Why）

多 Pod 部署下，SSE 连接和请求处理可能落在不同 Pod。当前 timeline 事件投递只在进程内进行，处理请求的 Pod 持久化的事件不会出现在连接所在 Pod 的进程内订阅者里。这导致前端 SSE 收不到其他 Pod 处理产生的事件，用户可见的消息流出现缺失。

当前 stream live 阶段在进程内订阅者空闲一段时间后直接结束流，没有从持久化层回补其他 Pod 事件的兜底逻辑。

## 变更范围（What Changes）

- **新增** cross-pod timeline 兜底投递：stream live 阶段进程内订阅者空闲时，按已消费序号查询持久化层获取其他 Pod 持久化的增量事件，去重后投递给当前 SSE 流。
- **新增** 空闲结束策略：进程内订阅者和持久化层查询连续无新事件达到上限后优雅结束流，空闲总时长与原空闲超时语义一致（约 5 分钟）。
- **同步** 兜底投递时维护 pending input 活跃状态，与进程内投递行为一致，确保后续空闲等待策略正确。
- **同步** 兜底投递后维护 stream 序号高水位，保证同一 Pod 后续订阅连接的序号连续性。
- **降级** 持久化层查询超时或失败时降级为空闲计数推进，不中断 SSE 流，不静默丢弃已成功投递的业务事件。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改 Capability

本 change 修改 Function `ts-stream-resume-replay` 的 live 阶段行为：在进程内订阅者空闲时增加持久化层兜底投递，使多 Pod 部署下 SSE 消费者不丢失其他 Pod 持久化的 timeline 事件。变化边界为 stream live 阶段的空闲兜底逻辑，不改变 cursor、replay、gap recovery 等既有黑盒契约。质量属性：可靠性/恢复。

## 需确认内容

无。本 change 只改 `agent-runtime` 内部 stream 兜底逻辑，不涉及 `agent-contracts` 变更，不影响 public contract。