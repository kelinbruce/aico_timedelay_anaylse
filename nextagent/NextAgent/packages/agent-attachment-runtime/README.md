# agent-attachment-runtime

职责：附件后端可信校验、暂存、refs、availability check、安全 descriptor 和 cleanup policy boundary。

非职责：不定义具体 upload API、文件解析实现、存储 schema、Web transport 或 context window selection。

Public exports：`@nextagent/agent-attachment-runtime`。

Allowed dependencies：`agent-common` 和架构授权的 `agent-contracts/attachment`、`agent-contracts/gateway` subpath。

Forbidden dependencies：Web channel、runtime implementation、upload framework、database driver、app composition。

替换边界：否。
