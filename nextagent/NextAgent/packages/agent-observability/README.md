# agent-observability

职责：AsyncLocalStorage request/run context、Pino structured logging helper、OpenTelemetry integration wrapper、metric tag policy 和 redaction policy。

非职责：不把 tracing/metrics SDK 类型暴露为核心契约，不承载业务状态机、provider SDK、gateway storage 或 app composition。

Public exports：`@nextagent/agent-observability`。

Allowed dependencies：`agent-common`、Pino、OpenTelemetry integration libraries。若需要 runtime / gateway / model 事实，只能通过 `agent-app` composition 注入的 observation 输入获得。

Forbidden dependencies：agent-contracts observability facade pollution、runtime private state、Web framework leakage into core contracts、database driver、provider SDK。

替换边界：是，observability sink/integration 可整包替换。
