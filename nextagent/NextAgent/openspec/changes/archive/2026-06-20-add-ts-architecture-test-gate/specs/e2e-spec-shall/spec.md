<!--
本文件是 active change 的行为规格 delta，路径为 specs/e2e-spec-shall/spec.md。
覆盖 65 个 Spec 的 148 个核心 SHALL/MUST 声明的端到端验证。
-->

## ADDED Requirements

### Requirement: Spec SHALL Verification Gate

系统 SHALL 对每个 spec 中标记为 SHALL/MUST 的声明提供端到端可观测的验证入口。每个验证用例必须能追溯到具体的 Spec Requirement 编号。

#### Scenario: Backend Architecture SHALL
- **WHEN** 验证 ts-backend-architecture spec 的 SHALL 声明
- **THEN** SafeError 输出不暴露 provider 细节，模块边界无 private path import

#### Scenario: Core Contracts SHALL
- **WHEN** 验证 ts-core-contracts spec 的 SHALL 声明
- **THEN** 所有 Gateway *Record 不出现在 Web response，owner scope 字段来自可信来源

#### Scenario: Minimal Agent Kernel SHALL
- **WHEN** 验证 ts-minimal-agent-kernel spec 的 SHALL 声明
- **THEN** submit 幂等性、session agentId 绑定、accepted 后 agentId 不可变

#### Scenario: Local Configured Auth SHALL
- **WHEN** 验证 ts-local-configured-auth spec 的 SHALL 声明
- **THEN** credentialRef 不接受明文 key，认证失败返回通用错误不泄露内部信息

#### Scenario: Request Cancel/Retry SHALL
- **WHEN** 验证 request-cancel 和 request-retry spec 的 SHALL 声明
- **THEN** cancel 只影响 pending/running 状态，retry 创建新 attempt 且旧输出不丢失

#### Scenario: Web Transports SHALL
- **WHEN** 验证 ts-web-sse-ws-transports spec 的 SHALL 声明
- **THEN** stream envelope 格式正确，projection 语义一致，断线重连后可恢复

#### Scenario: Fullstack Packaging SHALL
- **WHEN** 验证 fullstack-packaging-boundary spec 的 SHALL 声明
- **THEN** binary package 包含完整依赖，self-check 通过，所有端口可监听

#### Scenario: E2E Gate SHALL
- **WHEN** 验证 ts-e2e-alpha-kernel-gate、ts-e2e-product-journey-gate、ts-e2e-release-package-gate、ts-e2e-resilience-gate、ts-e2e-security-gate spec 的 SHALL 声明
- **THEN** 各 gate 的质量门禁条件全部满足

#### Scenario: Capability Catalog and Source SHALL
- **WHEN** 验证 capability-catalog、capability-source-configuration、builtin-skill-source、builtin-tool-framework、skill-manifest-contract、skill-tool、local-skill-source spec 的 SHALL 声明
- **THEN** Tool/Skill/Agent 统一注册，visibility 控制，manifest schema 校验通过

#### Scenario: Model and Context SHALL
- **WHEN** 验证 context-engine、context-assembly-contracts、context-token-estimator、model-invocation-contract、model-fallback-semantics、model-stream-normalization、model-provider-adapter、model-provider-configuration、model-info-contracts、model-profile-contracts spec 的 SHALL 声明
- **THEN** context 组装完整，model stream 正确归一化，provider error safe mapping

#### Scenario: Security and Sandbox SHALL
- **WHEN** 验证 secret-configuration-boundary、sandbox-deny-by-default-adapter、sandbox-runtime、redaction-policy、cross-platform-executable-semantics spec 的 SHALL 声明
- **THEN** credential 不泄露，sandbox deny-by-default，日志不含敏感信息

#### Scenario: Observability SHALL
- **WHEN** 验证 audit-event-contract、audit-sink、invocation-audit、internal-lifecycle-observability、structured-logging、trace-log-linking、agent-runtime-metrics、system-health-check spec 的 SHALL 声明
- **THEN** 审计事件格式正确，日志结构化不含敏感字段，trace 可关联

#### Scenario: Recovery and Idempotency SHALL
- **WHEN** 验证 local-runtime-recovery、local-runtime-package、local-runtime-release、runtime-recovery-idempotency-guard、local-run-timeline-store、idempotency-contract、conflict-resolution spec 的 SHALL 声明
- **THEN** 重启恢复完整，idempotency key 唯一，timeline sequence 单调
