## 背景与问题（Why）

本地运行包、配置 fail-closed、health/readiness 和 fullstack hosting 都依赖真实打包产物、真实文件布局、真实启动命令和真实 route precedence。只验证源码或纯函数 `pack()` / `qualify()` 不能证明候选产物能够按发布说明启动并提供正确服务。

## 变更范围（What Changes）

- 新增 release/package E2E gate，为 e2e-P0-19、20、25、26 建立唯一主要维护归属。
- 从实际候选包启动 backend-only 和 with-frontend profile，验证非法配置 fail closed、health/readiness、静态托管与 API/stream precedence、manifest/evidence 完整性。
- 捕获实际 candidate startup 产生的唯一 `ConfigValidationEvidence` opaque ref，并产出 `harden-ts-local-runtime-release` 可消费的 startup 与 health evidence refs。
- 维护唯一标准命令 `npm run test:e2e:release-package`，产出 machine-readable `ReleaseCheckResult`、`PackageCandidateEvidence` 和 `HealthProof`；release smoke 由 product-journey gate 拥有。
- 不重新实现 `pack()`、`qualify()`、health checker、配置 schema、`ConfigValidationEvidence` 或 fullstack hosting。

BREAKING：无。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-e2e-release-package-gate`: 定义候选运行包和 fullstack serving 的真实产物 E2E gate。

### 修改的 Capability
无。

## 影响范围（Impact）

- 主要影响 `tests/e2e/` release-package project、候选包启动 helper、临时 registry/install fixture、文件和 route assertions。
- 消费 local runtime package、fullstack packaging、app config、health/readiness 和 release qualification 既有行为。
- 不修改 `agent-contracts`。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-e2e-release-package-gate/spec.md`：新增候选产物 E2E gate。

长期背景：
- `openspec/overview.md`：记录本地 release 需要真实候选产物启动证据。

设计视图：
- `openspec/designs/architecture/e2e-quality-gates.md`：承载 release/package E2E 边界和 evidence 规则。
- `openspec/designs/modules/agent-app.md`：增加候选包验证入口导航。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加导航。

验证入口：
- `npm run test:e2e:release-package`
- `openspec validate add-ts-e2e-release-package-gate --strict`
