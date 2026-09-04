# agent-session

职责：session/message/read model skeleton、latest-request policy skeleton、history consistency、active request、pending/handoff facts 和 owner scope boundary skeleton。

非职责：不定义会话保留期、过期、自动清理、调度器、数据库 schema、Web transport 或 runtime lifecycle。

Public exports：`@nextagent/agent-session`。

Allowed dependencies：`agent-common` 和架构授权的 `agent-contracts/session`、`agent-contracts/gateway` subpath。

Forbidden dependencies：Web channel、runtime implementation、database drivers、remote client、provider SDK、app composition。

替换边界：否。
