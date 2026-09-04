# agent-contracts

职责：承载 boundary DTO、schema skeleton、public interfaces 和各模块 public namespace。

非职责：不实现 runtime、channel、gateway、model provider、capability executor、observability sink 或 app composition。

Public exports：root export 和 `agent-assembly`、`runtime`、`channel`、`session`、`attachment`、`context`、`model`、`capability`、`core`、`gateway`、`observability`、`app` subpath exports；产品代码必须使用授权 subpath，不得使用 root aggregate 绕过架构 allowlist。

Allowed dependencies：`agent-common` 和 schema/runtime validation libraries。

Forbidden dependencies：implementation packages、Fastify、SQLite/Kysely、OpenTelemetry SDK、model SDK、provider SDK、gateway adapter、app composition。

替换边界：否。该包定义替换实现必须遵守的 public contract。
