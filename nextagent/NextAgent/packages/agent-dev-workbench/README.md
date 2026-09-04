# agent-dev-workbench

职责：local runtime package 专用的 Agent Dev Workbench dev tooling package，拥有 `/__nextagent/dev/workbench` dev-only 页面工件、dev-only 查询 API、dev DTO runtime schema validation、SQLite local development read adapter、process graph projection、action detail projection 和 bounded log evidence projection。

非职责：不拥有 request lifecycle、session state、canonical timeline、terminal commit、生产 `/api/v1` Web API、用户 stream transport、生产 observability/log schema、raw capture decorator、dev raw buffer 或系统 lifecycle hook；不提供 retry、edit、cancel、replay、resume、fork、pending input answer 或配置修改命令。

Public exports：`@nextagent/agent-dev-workbench`。

Allowed dependencies：`agent-common`、架构授权的 `agent-contracts/gateway` subpath、Fastify adapter-local types、TypeBox schema helpers、Node local read primitives、package-owned dev frontend build/runtime dependencies（React/Vite/Ant Design/G6）。

Forbidden dependencies：`agent-channel-web`、`frontend/agent-web` route/feature ownership、production frontend hosting artifact、runtime private state、app composition private paths、provider SDK、gateway adapter private paths、raw prompt/model/tool/provider payload sources。

替换边界：是，dev tooling package 可整包替换，不影响 production package composition。
