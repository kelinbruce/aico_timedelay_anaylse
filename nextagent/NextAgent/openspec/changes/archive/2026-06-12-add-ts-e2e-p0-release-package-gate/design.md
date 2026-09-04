## 背景和现状（Context）

`add-ts-local-runtime-package` 拥有候选包布局和 evidence，`refine-ts-fullstack-packaging-boundary` 拥有前端 artifact/hosting 边界，`add-ts-health-check` 拥有 health 语义，`harden-ts-local-runtime-release` 只聚合权威结果。本 gate 的职责是从实际候选产物产生这些真实启动和 smoke evidence。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 对实际 candidate package 而不是 workspace 源码执行安装、配置、启动、HTTP/browser 验证和停止。
- 验证 backend-only 与 with-frontend profile 的产物边界。
- 产出安全、machine-readable startup/health evidence refs。

**非目标：**
- 不改变 package layout、manifest schema、route ownership 或 health 语义。
- 不在 gate 内生成 release verdict；verdict 仍由 `harden-ts-local-runtime-release` 聚合。
- 维护唯一标准命令 `npm run test:e2e:release-package`，写出 `ReleaseCheckResult`、`PackageCandidateEvidence` 和 `HealthProof`；不定义 adapter API 或 verdict 聚合。
- 不把开发态 `npm run dev:fullstack` 当作候选包 evidence。

## 设计决策（Decisions）

### D1. 唯一执行路径

`npm run test:e2e:release-package` MUST 先调用正式 package entrypoint 生成隔离 candidate，随后从 candidate root 使用其声明的启动入口启动 profile。测试 MUST 不依赖 workspace private path、源码 fallback、目录探测或 dev server。

### D2. 用例唯一归属

| 用例 | 主要验证目标 |
|---|---|
| e2e-P0-19 | 非法 app/model/gateway/secret 配置 fail closed 且诊断安全 |
| e2e-P0-20 | health/readiness/metrics 在启动和就绪阶段状态正确 |
| e2e-P0-25 | with-frontend 同一 server 提供前端/API/stream 且 route precedence 正确 |
| e2e-P0-26 | candidate package 可安装启动，manifest/config/evidence 完整 |

### D3. Candidate 与 evidence

每个执行必须记录 candidate id、profile、package manifest ref、实际 candidate startup 产生的 opaque `configValidationEvidenceRef`、startup evidence ref 和 health evidence ref。报告只保存 candidate-relative 安全路径或 opaque ref，不保存主机绝对路径、credential、raw config 或复制的 `ConfigValidationEvidence` 内容。

Evidence 组装只有一条路径：gate 从正式 candidate startup 输出捕获 opaque `configValidationEvidenceRef`，通过 `@nextagent/agent-app/release` public subpath 的唯一 mapper 将 health owner 权威结果转换为 `HealthProof`，再通过 `@nextagent/agent-app/packaging` public subpath 合并 config/startup/health refs 并完成 `PackageCandidateEvidence` handoff validation。gate 不得解析、复制或重新判定 `ConfigValidationEvidence`，不得定义第二套 evidence report DTO、schema、mapper 或 validator，也不得使用 `agent-app` private path。

Release qualification 只能调用本 gate 的唯一标准命令 `npm run test:e2e:release-package`，并读取该命令写出的权威 `ReleaseCheckResult`、`PackageCandidateEvidence` 和 `HealthProof`。本 gate 不定义 adapter API、generic payload、`outputRef` 或 release verdict。

### D4. Fail-closed

candidate 缺文件、版本不一致、缺失 `configValidationEvidenceRef`、配置阻断导致正式启动失败、启动超时、readiness 失败、API 被静态 fallback 吞掉、with-frontend 缺少 index 或测试依赖 workspace private path 时，gate MUST 失败。gate 依据正式启动结果阻断，不解引用 config evidence。

### D5. 最小实现边界

本 gate 只实现从正式 package entrypoint 生成 candidate、从 candidate root 启动 profile、执行 HTTP/browser smoke、通过指定 public subpath 组装 evidence 和清理临时产物所需的最小 helper。不得复制或重新实现 `pack()`、`qualify()`、health checker、配置 schema、evidence DTO/schema/validator、static hosting router 或发布 verdict 聚合逻辑。negative fixture 可以共享 harness，但每个失败原因 MUST 有独立断言，避免以单个综合坏包掩盖具体边界。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 非法配置 fail closed，report 不含 secret/绝对路径 | release-package E2E |
| 性能/容量 | 只验证 bounded startup/readiness，不定义 SLA | timeout report |
| 可靠性/恢复 | 启动/停止和临时产物清理确定性 | fixture tests |
| 可维护性 | 从正式 package entrypoint 驱动，不复制 pack/health/hosting/qualification 逻辑 | source/review assertion |
| 可测试性 | 使用实际 candidate root 和真实文件系统/端口 | release-package E2E |
| 审计/可追溯性 | evidence ref 可被 qualification 消费 | report assertion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 实际 candidate 启动 | 1.1、2.4 | `npm run test:e2e:release-package` |
| 配置/health/fullstack route | 2.1-2.3 | case specs |
| 不依赖 dev/workspace private path | 3.1 | negative fixture |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-e2e-release-package-gate/spec.md`
- E2E candidate/evidence 边界：`openspec/designs/architecture/e2e-quality-gates.md`
- 产品包验证导航：`openspec/designs/modules/agent-app.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 正式打包和启动增加执行时间。 -> 仅保留四个真实产物不可替代场景。
- [风险] 测试误用 workspace 源码而产生假阳性。 -> candidate 运行环境禁止 workspace private path，并提供 negative fixture。

## 迁移计划（Migration Plan）

复用现有 pack、manifest validation、health 和 fullstack hosting tests 的数据构造；真实候选产物路径迁入本 gate，低层行为测试继续留在原 owner。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/ts-e2e-release-package-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/modules/agent-app.md` 和 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
