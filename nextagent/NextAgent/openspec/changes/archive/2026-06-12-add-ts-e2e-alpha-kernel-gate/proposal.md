## 背景与问题（Why）

Alpha（串行底座）通过 `establish-ts-backend-architecture`、`establish-ts-core-contracts` 和 `ship-ts-minimal-agent-kernel` 三个 change 交付了最小问答内核：session 创建、submit question、SSE stream、terminal commit、history 读取、SafeError 边界、owner/agent scope 隔离和同 session 并发冲突拒绝。这些能力的正确性目前仅通过 contract test、unit test 和 architecture gate 验证。

P0 阶段的四个 E2E gate 覆盖的是首版增强能力（auth、cancel、retry、WebSocket、tool、title、feedback、packaging 等），其用例均依赖 P0 才引入的 product composition 边界。Alpha 核心路径缺少一个使用真实 product process、真实 HTTP/SSE 和真实 local persistence 的 E2E gate。在 P0 能力持续变更期间，Alpha 内核行为可能被意外破坏而无法在 P0 E2E gate 中捕获（因为 P0 gate 依赖尚未完成的 P0 active change）。

需要一个面向 Alpha 能力边界的最小 E2E gate，作为串行底座核心路径的回归保护。

## 变更范围（What Changes）

- 新增 Alpha E2E gate，使用真实 local product process、真实 HTTP/SSE 连接和真实 local persistence 验证 Alpha 最小问答内核的用户可观测行为。
- 为 e2e-alpha-01、02、03、04、05、06 建立唯一主要维护归属。
- 统一测试目录、启动/清理 helper、用例标签、超时、失败证据和命令入口。
- gate 只消费 Alpha 级 product composition（无需 auth、无需 WebSocket、无需 P0 工具注册、无需 P0 context assembly 增强）。
- 明确本 change 只验证 `ship-ts-minimal-agent-kernel` 已定义的 OpenSpec 行为，不新增或重新定义产品 API、runtime lifecycle、capability 或 persistence 语义。

BREAKING：无。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-e2e-alpha-kernel-gate`: 定义 Alpha 最小问答内核必须通过的真实边界 E2E gate。

### 修改的 Capability

无。

## 影响范围（Impact）

- 主要影响 `tests/e2e/` 的 Playwright 配置、Alpha 级真实 product process fixture、Alpha E2E specs 和执行脚本。
- 消费 `ship-ts-minimal-agent-kernel` 定义的核心行为：session create/submit、SSE stream、terminal commit、history read、SafeError、owner scope 隔离和并发冲突拒绝。
- gate 结果作为 Alpha 内核回归保护；不修改 `agent-contracts`。
- 维护唯一标准命令 `npm run test:e2e:alpha`，产出 machine-readable `ReleaseCheckResult`。
- 区别于 P0 `add-ts-e2e-product-journey-gate`：Alpha gate 不依赖 local auth、WebSocket、cancel/retry、tool、title、feedback、attachment、context compression 等 P0 能力。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-e2e-alpha-kernel-gate/spec.md`：新增 Alpha E2E gate 行为。

长期背景：
- `openspec/overview.md`：记录 Alpha 串行底座需要独立 E2E gate 作为核心路径回归保护。

设计视图：
- `openspec/designs/architecture/e2e-quality-gates.md`：增加 Alpha E2E gate 分类、真实边界、用例唯一归属和 evidence 规则（与 P0 E2E gate 平行）。
- `openspec/designs/modules/agent-app.md`：只增加 Alpha E2E 验证入口导航。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加本 capability 与验证入口导航。

验证入口：
- `npm run test:e2e:alpha`
- `openspec validate add-ts-e2e-alpha-kernel-gate --strict`
