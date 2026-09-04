## Purpose

Define release candidate E2E gate that verifies actual package candidate startup, health/readiness, fullstack route precedence, and manifest/evidence integrity without workspace fallback.

## Requirements

### Requirement: Release package E2E 从实际候选产物执行

Release/package E2E gate SHALL 从正式 package entrypoint 生成的实际 candidate root 执行 e2e-P0-19、20、25、26。gate MUST 使用 candidate 声明的配置和启动入口，MUST NOT 使用 workspace private path、源码 fallback、目录探测或开发服务器替代候选产物。

#### Scenario: 实际候选产物通过
- **WHEN** candidate package 具备有效 manifest、配置样例、evidence 和启动入口
- **THEN** gate 从 candidate root 启动并完成所有必需 case

#### Scenario: Workspace fallback 被拒绝
- **WHEN** candidate 缺少必需产物但测试尝试使用 workspace 源码或 dev server 继续
- **THEN** gate MUST 返回 failed

### Requirement: Release package E2E 验证启动、health 和 fullstack serving

gate MUST 验证非法配置 fail closed、health/readiness/metrics 状态、with-frontend route precedence 和 candidate package 完整性。任一必需 case 缺失、skipped、timeout 或 failed 时 gate MUST 失败。

#### Scenario: 非法配置阻断启动
- **WHEN** candidate 使用非法 app、model、gateway 或 secret 配置启动
- **THEN** startup MUST fail closed
- **AND** diagnostic 不包含 raw secret 或主机绝对路径

#### Scenario: Fullstack route precedence 正确
- **WHEN** with-frontend candidate 已 ready
- **THEN** 同一 server 提供前端静态资源、API 和 stream
- **AND** static fallback 不得吞掉 API、stream 或 auth route

### Requirement: Release package E2E 产出 qualification 可消费证据

gate MUST 捕获实际 candidate startup 产生的 opaque `configValidationEvidenceRef`，产出安全的 package、startup 和 health evidence refs，并关联 candidate id 与 profile。release smoke evidence MUST be owned by the product-journey gate. gate MUST NOT 自行产生 release qualification verdict。

gate MUST NOT define, copy, parse, or reinterpret `ConfigValidationEvidence`; it MUST only capture the opaque ref emitted by the actual candidate startup. gate MUST use the single health-result mapper exported by `@nextagent/agent-app/release`, then use `@nextagent/agent-app/packaging` to merge config/startup/health refs and validate the completed `PackageCandidateEvidence`. gate MUST NOT define a competing evidence report DTO, schema, mapper, or validator, and MUST NOT import an `agent-app` private path.

The gate SHALL maintain the single standard command `npm run test:e2e:release-package`. The command MUST write machine-readable `ReleaseCheckResult`, authoritative `PackageCandidateEvidence`, and authoritative `HealthProof`. It MUST NOT define an adapter API, generic payload, `outputRef`, or release verdict aggregation.

#### Scenario: Evidence 可供 qualification 使用
- **WHEN** release/package E2E 完成
- **THEN** report 提供 candidate-relative 或 opaque evidence refs
- **AND** `harden-ts-local-runtime-release` 可以消费这些上游结果

#### Scenario: Blocked configuration cannot become valid package evidence
- **WHEN** actual candidate startup emits `ConfigValidationEvidence` with `ConfigReadinessState=BLOCKED`
- **THEN** the formal candidate startup MUST fail and gate MUST reject package evidence handoff
- **AND** gate MUST NOT resolve, replace, or reinterpret the configuration evidence
