# agent-core

职责：Agent orchestration skeleton 和 Agent 内部 request routing policy boundary。

非职责：不实现完整 Agent loop、具体路由规则、runtime lifecycle、provider SDK、gateway adapter、Web transport 或 app composition。

Public exports：`@nextagent/agent-core`。

Allowed dependencies：`agent-common` 和架构授权的 `agent-contracts/agent-assembly`、`agent-contracts/runtime`、`agent-contracts/context`、`agent-contracts/model`、`agent-contracts/capability`、`agent-contracts/session` subpath。

Forbidden dependencies：provider SDK、gateway adapter、PaaS sandbox SDK、Web channel、database driver、app composition。

替换边界：否。
