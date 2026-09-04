# agent-model

职责：模型 provider adapter boundary skeleton、模型 profile、请求归一化、stream normalization、tool-use 片段归一化、fallback 结果和 safe provider error mapping。

非职责：不把 provider SDK、Vercel AI SDK、LangChain、OpenAI-compatible client 或平台 ModelGateway 类型暴露为跨模块 public contract。

Public exports：`@nextagent/agent-model`。

Allowed dependencies：`agent-common`、架构授权的 `agent-contracts/model` subpath、adapter-local provider libraries。

Forbidden dependencies：core/runtime/context private paths、Web channel、app composition。

替换边界：是，模型 provider adapter 可整包替换。
