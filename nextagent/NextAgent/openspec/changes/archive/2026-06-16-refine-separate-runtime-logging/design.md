## 背景和现状（Context）

`agent-observability` 目前同时拥有 structured log projection 和具体的 `createStructuredLogger()` helper。这很别扭：具体 helper 对 app/runtime 运营日志很有用，而该 package 又是 observability 实现边界。业务 package 为避免 import Pino 或 observability 代码，只能各自定义小型本地 logger 接口。

期望的形态是两个面：

- observability 日志：来自脱敏 observation 的派生、schema 稳定的 evidence；
- runtime 日志：业务代码用于本地问题诊断的运营诊断信息。

两者可以使用兼容的 logger 实现，但它们的 contract 应保持分离。

## 设计决策（Decisions）

### D1. 把 runtime logger contract 放入 `agent-common`

`agent-common` 已经是 durable scalar vocabulary 和底层 utility contract 的共享词汇 package。结构化 logger contract 属于那里，因为多个业务 package 都需要它，而且它不得依赖实现 package。

### D2. 通过把具体工厂移到 common 边界之后复用 `logger.js`

具体工厂保持既有文件名和行为（构建后为 `logger.js`），但从 `agent-common` 导出。`agent-observability` 重新导出它以避免破坏既有 import，同时不再成为获取 runtime logger 的唯一途径。

### D3. 保持 structured log 归 observation 所有

`StructuredLogProjector`、`StructuredLogEntry`、redaction 和 observation 映射留在 `agent-observability`。runtime 日志不会成为第二条 observability 流。

### D4. 合并重复的结构化 logger 接口

`RuntimeDiagnosticLogger`、context 的 `DiagnosticLogger` 和 budget 日志形态统一到 `agent-common` 的 `RuntimeLogger`/`RuntimeLogSink`。可以保留窄别名以澄清用途，但它们必须别名到 common 类型，而不是重新定义平行形态。

## 验证（Verification）

- common runtime logger 的 unit test 覆盖 noop 行为和 file/stdout 工厂兼容性。
- 日志测试覆盖 structured projector 条目仍通过共享的 logger 兼容 transport 输出。
- 架构验证确认业务 package 仍不为 runtime 诊断 import Pino 或 `agent-observability`。
- OpenSpec strict 验证确认新的 runtime logging 面已被规格化。
