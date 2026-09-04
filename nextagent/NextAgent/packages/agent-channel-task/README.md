# agent-channel-task

职责：Fastify route plugin、机机接口 channel implementation，对外提供 task/HTTP JSON API（创建任务、取消、重试、编辑重试、提交 pending input、SSE/WebSocket stream projection、async 回调投递）；identity 从 header 解析，transport-only，不拥有 request lifecycle。

非职责：不拥有 request lifecycle、session state、canonical timeline、业务语义路由或 terminal commit；不做认证，认证由 remote gateway 实现。

Public exports：`@nextagent/agent-channel-task`。

Allowed dependencies：`agent-channel-common`（复用 stream projection 与 identity context）、`agent-common`、架构授权的 `agent-contracts/channel`、`agent-contracts/runtime` subpath、Fastify adapter-local types。

Forbidden dependencies：runtime private state、database driver、provider SDK、app composition private paths。

替换边界：是，channel adapter 可整包替换。
