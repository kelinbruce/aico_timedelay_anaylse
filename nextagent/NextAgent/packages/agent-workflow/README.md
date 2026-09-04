# agent-workflow

职责：workflow execution service 的 package 边界、最小 factory 暴露面，以及后续 engine / nodes 实现归属。

非职责：不拥有 app composition、request routing、runtime lifecycle、gateway adapter、持久化或恢复策略。

Public exports：`@nextagent/agent-workflow`、`@nextagent/agent-workflow/engine`、`@nextagent/agent-workflow/nodes`。

Allowed dependencies：`agent-common`、`agent-contracts/core`、`agent-contracts/capability`、`agent-contracts/model`、`agent-contracts/gateway`、`ajv`。

Forbidden dependencies：`agent-app`、`agent-core`、gateway adapter、Web channel、provider SDK、database driver。

替换边界：否。
