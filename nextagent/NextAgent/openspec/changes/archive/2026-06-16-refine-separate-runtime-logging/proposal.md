## 背景与问题（Why）

当前 app composition 对两个不同的关注点使用同一个具体 logger：

- 从 `ObservabilityObservationEvent` 派生的 observability structured log；
- 业务 package 用于本地问题诊断的运营 runtime 日志。

这使业务 package 依赖本地重复的 logger 形态，也助长了仅为打印 runtime 诊断而 import `agent-observability` 的做法。runtime 诊断需要一个通用、安全的 logger contract，让业务 package 无需引入 Pino 或 observability SDK 依赖即可使用。

## 变更范围（What Changes）

- 在 `agent-common` 中新增 runtime logging contract。
- observability structured logging 保持为 `agent-observability` 的、由 observation 事件驱动的面。
- 复用既有 `logger.js` 工厂名，把具体 logger helper 移到共享 runtime logging 边界，并由 `agent-observability` 兼容性重新导出。
- 更新业务 package，使其依赖 `agent-common` runtime logger contract，而不是定义平行的本地 logger 接口。
- 通过 runtime logger 组装 app runtime 诊断，同时保持 structured log projection 分离。

## 影响范围（Impact）

- `agent-common`：新增 runtime logging 类型、noop logger 和 logger 工厂。
- `agent-observability`：structured log projector 仍归 observation 所有；logger helper 重新导出 common 工厂。
- `agent-app`：composition 对运营日志使用 common runtime logger，对 observability 日志使用 structured log transport。
- `agent-runtime` 和 `agent-context-engine`：用共享 common contract 替换重复的本地诊断 logger 接口。
- 测试：为 common runtime logger 行为和 observability/runtime 日志分离新增聚焦覆盖。
