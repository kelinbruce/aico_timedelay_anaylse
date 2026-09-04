# agent-channel-web-auth-local

职责：localhost-only local configured authentication 的 Web auth adapter boundary 和 Web auth plugin/factory 占位。

非职责：不定义具体 endpoint、request/response payload、cookie/ticket 格式、签名规则、多用户管理、注册、改密、refresh token、server-side auth session store、IAM/remote auth，也不访问 request lifecycle、session/message、memory、attachment、RequestRun 或 capability durable facts。

Public exports：`@nextagent/agent-channel-web-auth-local`。

Allowed dependencies：Fastify adapter-local types。

Forbidden dependencies：`agent-channel-web`、runtime/core/session/context/model/capability/attachment/memory implementation packages、gateway adapter private state、provider SDK。

替换边界：是，local Web auth endpoint adapter 可整包替换。
