# agent-common

职责：承载 shared ids、value objects、JSON value、language/locale skeleton、SecretReference、safe error shape 和跨边界基础 enum。

非职责：不承载边界 DTO、业务 port、adapter、runtime 实现、Web framework、persistence driver、provider SDK 或 app composition。

Public exports：`@nextagent/agent-common`。

Allowed dependencies：Node.js/TypeScript 标准能力。

Forbidden dependencies：`agent-contracts`、任何 implementation package、Fastify、SQLite/Kysely、OpenTelemetry SDK、model SDK、gateway adapter、app composition。

替换边界：否。该包是 foundation contract。
