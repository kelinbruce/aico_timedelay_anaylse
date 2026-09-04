## ADDED Requirements

### Requirement: [TS] App Composition Root 三职责边界

TS 后端 `agent-app` SHALL 只作为 composition root 承担三类职责：配置加载、依赖注入和服务启动。`agent-app` MUST NOT 拥有 request lifecycle、Agent 内部 routing、context assembly semantics、model provider semantics、capability business semantics、workflow execution semantics、memory extraction/aging/retrieval semantics、question recommendation semantics、frequent question ranking semantics、gateway persistence semantics、observability projection semantics、session history semantics 或 channel transport semantics。

配置加载 SHALL 只包括读取、校验、冻结 app/system/Agent package 输入，并产出 typed config、registry、AgentAssembly snapshot 和 safe diagnostic evidence。依赖注入 SHALL 只包括选择 owner package public factory，并注入 frozen config projection、ports、registries、clock/logger、credential resolver、gateway、model、capability、observability wrapper 或 lifecycle handle 等窄依赖。服务启动 SHALL 只包括注册 server/channel/health/ready gate，启动和停止 owner package 返回的 scheduler、worker、job 或 lifecycle handle。

Owner package MUST expose narrow public factory、adapter 或 probe API for its own behavior when app composition is required. `agent-app` MUST consume those APIs instead of inlining owner package business algorithms or domain output parsing. This requirement does not change public Web API、runtime command、stream event、gateway schema、model invocation contract、capability invocation contract or request lifecycle behavior.

设计入口：`openspec/designs/modules/agent-app.md`

#### Scenario: agent-app 只执行配置加载

- **WHEN** app startup loads default system config、application overlay、environment secret references、Agent package input or plugin startup list
- **THEN** `agent-app` SHALL validate and freeze those inputs before ready state
- **AND** the frozen output SHALL be typed config、registry、AgentAssembly snapshot or safe diagnostic evidence
- **AND** `agent-app` MUST NOT execute request-time memory、workflow、context、model、capability、session、gateway or observability business behavior during this configuration loading path

#### Scenario: agent-app 只执行依赖注入

- **WHEN** product composition wires memory、workflow、context、model、capability、question、gateway、session、observability、health or channel dependencies
- **THEN** `agent-app` SHALL call the owning package's public factory、adapter or probe factory
- **AND** it SHALL pass only narrow dependencies or frozen config projections required by that owner
- **AND** it MUST NOT inline owner-owned algorithms such as memory extraction candidate parsing、workflow LLM prompt preparation、capability tool catalog construction、model provider request construction、question prompt/output parsing、frequent question merge/ranking、gateway record mapping、runtime log observation shaping or context summary generation

#### Scenario: agent-app 只执行服务启动

- **WHEN** app startup enters ready/start phase
- **THEN** `agent-app` SHALL register product entrypoints、server/channel plugins、health/readiness wiring and lifecycle start/close callbacks
- **AND** it SHALL start or stop only lifecycle handles、scheduler、worker or job objects returned by owner package factories
- **AND** it MUST NOT implement scheduler policy、cleanup policy、memory lifecycle policy、workflow execution policy、request lifecycle state transition or channel stream projection behavior

#### Scenario: owner packages do not depend on agent-app

- **WHEN** memory、workflow、context、model、capability、question、gateway、session、observability、runtime or channel packages expose factories used by app composition
- **THEN** those packages MUST NOT import `agent-app` or app-private composition modules
- **AND** they SHALL communicate through public package exports、`agent-contracts`、`agent-common` or owner-owned public APIs
- **AND** architecture verification MUST fail on reverse dependencies from owner packages into `agent-app`

#### Scenario: composition refactor preserves external behavior

- **WHEN** business logic is migrated out of `agent-app` into owner package factories
- **THEN** startup readiness、capability availability、memory tool availability、workflow availability、question route availability、health/readiness safe diagnostics and lifecycle shutdown behavior SHALL remain externally compatible
- **AND** no new public Web API、runtime command、stream event、gateway schema、model invocation contract or capability invocation contract is introduced by this refactor
