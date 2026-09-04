# agent-channel-common

职责：channel 层共享的 transport/projection primitive，包括 trusted identity resolver 类型、canonical timeline 到 public stream envelope 的投影、SSE 格式化和 stream delivery orchestration。

非职责：不注册 route，不拥有 Web 或 Task API surface，不做认证、request lifecycle、session state、gateway persistence、capability execution 或 app composition。

Public exports：`@nextagent/agent-channel-common`。

Allowed dependencies：`agent-common`、架构授权的 `agent-contracts/channel`、`agent-contracts/runtime` subpath、Fastify adapter-local types。

Forbidden dependencies：`agent-channel-web`、`agent-channel-task`、auth implementation、runtime/session/core/context/model/capability implementation packages、gateway adapters、app composition private paths。

替换边界：否；这是 channel packages 的共享库，不是 product entrypoint。
