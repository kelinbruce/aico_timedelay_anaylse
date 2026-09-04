# agent-context-engine

职责：context assembly boundary skeleton、query policy、window selection、compaction、prompt shaping 和 disclosure budget。

非职责：不实现长期记忆生命周期、具体 prompt 文本、retrieval ranking、Web API、runtime lifecycle 或 provider SDK 调用。

Public exports：`@nextagent/agent-context-engine`。

Allowed dependencies：`agent-common` 和架构授权的 `agent-contracts/agent-assembly`、`agent-contracts/context`、`agent-contracts/capability`、`agent-contracts/model`、`agent-contracts/gateway` subpath。

Forbidden dependencies：memory private paths、Web channel、runtime implementation、model provider SDK、database driver、app composition。

替换边界：否。
