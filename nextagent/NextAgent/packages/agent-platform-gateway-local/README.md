# agent-platform-gateway-local

职责：本地 gateway adapter skeleton，隔离 SQLite/Kysely persistence、schema versioning/update entrypoint 和本地单实例恢复边界。

非职责：不把 driver-specific record、SQLite/Kysely 类型或 local path layout 暴露给 runtime、core、context 或 channel。

Public exports：`@nextagent/agent-platform-gateway-local`、`@nextagent/agent-platform-gateway-local/entrypoints/local`。

Allowed dependencies：`agent-common`、架构授权的 `agent-contracts/gateway` subpath、Kysely/better-sqlite3 adapter-local libraries；`src/entrypoints/**` 可依赖 `agent-app` composition API。

Forbidden dependencies：Web channel private paths、runtime private state、provider SDK、PaaS SDK；非 entrypoint gateway implementation 源码不得依赖 `agent-app`。

替换边界：是，gateway adapter 可整包替换。
