# agent-runtime

职责：request admission、scheduler、same-session lane、cancellation、timeline publication、checkpoint、lifecycle hook stage placeholder 和 terminal commit boundary skeleton。

非职责：不处理 Web transport、业务语义路由、provider SDK、persistence driver、具体 Agent loop、具体状态机全集或 app composition。

Public exports：`@nextagent/agent-runtime`。

Allowed dependencies：`agent-common` 和架构授权的 `agent-contracts/agent-assembly`、`agent-contracts/runtime`、`agent-contracts/session`、`agent-contracts/gateway` subpath。

Forbidden dependencies：Web channel、app composition、Fastify request objects、database drivers、provider SDK、PaaS SDK、tracing/metrics SDK 类型。

替换边界：否。Runtime 是生命周期 owner。
