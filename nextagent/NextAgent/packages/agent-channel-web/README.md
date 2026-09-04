# agent-channel-web

职责：Fastify route plugin、SSE/WS-compatible stream adapter、presentation-safe errors；当前第一阶段唯一 channel implementation，用于 Web/LUI 访问。

非职责：不拥有 request lifecycle、session state、canonical timeline、业务语义路由或 terminal commit。

Public exports：`@nextagent/agent-channel-web`。

Allowed dependencies：`agent-common`、架构授权的 `agent-contracts/channel`、`agent-contracts/runtime` subpath、Fastify/Pino adapter-local types。

Forbidden dependencies：runtime private state、database driver、provider SDK、app composition private paths。

替换边界：是，channel adapter 可整包替换。
