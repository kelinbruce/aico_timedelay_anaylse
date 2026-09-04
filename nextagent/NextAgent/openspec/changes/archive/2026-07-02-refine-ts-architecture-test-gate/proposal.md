## 背景与问题（Why）

NextAgent TS 后端平台的架构测试门（Architecture Test Gate）需要验证系统在功能、兼容性、可观测性三个维度上的行为契约是否满足 spec 约束。当前测试用例（位于 `tests/add-ts-architecture-test-gate/`）已经经过一轮修复，与真实 API 行为对齐（HTTP 200 vs 202、SSE only vs SSE+WS、trusted identity 模式、真实 data-testid 映射等），但缺乏对应的 OpenSpec 设计文档来规范测试用例的行为契约、设计决策和实施任务。

**触发原因**：测试用例与 spec 假设存在多处差异（HTTP 状态码、认证模式、端点存在性、data-testid 值），需要在设计层面明确真实 API 规则对测试用例的影响，并为后续维护和扩展提供规范化文档。

**必要性**：
1. 测试用例中大量 ⚠️ 标注的真实 API 差异需要正式文档承载
2. 测试经验库（TE-01~TE-10）的已验证状态需要归档
3. 前端 data-testid 映射、sessionStorage key 差异、SSE 检测策略需要明确的设计决策记录
4. 缺乏从 spec 约束到测试用例的追溯链

## 变更范围（What Changes）

本 change 不修改系统实现代码，仅新增和规范测试架构测试门的设计文档：

- **新增** ts-architecture-test-gate 的 OpenSpec 设计文档（proposal → specs → design → tasks）
- **新增** 各维度的行为规格 spec（functional、compatibility、observability）
- **新增** 架构设计文档，明确真实 API 规则对齐决策、双框架执行架构、已知问题
- **新增** 实施任务清单，明确每个测试用例对应的验证入口

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-architecture-test-gate-functional`: 功能维度测试的行为契约，覆盖 Submit→Terminal、Cancel propagation、Retry、Scope 双层校验、Pending Input、Stream Resume、History 一致、RequestRun 状态机、Lane 串行调度、Capability catalog、SSE stream、Command idempotency 等 12+ capability
- `ts-architecture-test-gate-compatibility`: 兼容性维度测试的行为契约，覆盖跨平台语义一致、双模式 API 行为一致、多 host 独立等 3 capability
- `ts-architecture-test-gate-observability`: 可观测性维度测试的行为契约，覆盖日志四层结构化、Audit event 追溯链、Metric 低基数等 3 capability
- `ts-architecture-test-gate-ui-interaction`: UI 交互维度测试的行为契约，覆盖 SSE stream UI 渲染、Pending Input 交互、断连重连、Session List 持久化、Composer 草稿、深色模式 scrollbar 等 6 capability

### 修改的 Capability
无。本 change 不修改已有 spec，仅新增测试门设计。

## 影响范围（Impact）

- **测试用例**: `tests/add-ts-architecture-test-gate/` 下的全部 .test.ts 和 .spec.ts 文件（17 文件 / 98 Vitest + 16 Playwright 用例）
- **测试框架**: Vitest (后端 API) + Playwright (E2E UI)
- **测试工具**: `helpers/api-client.ts` (Vitest) + `helpers/ui-helper.ts` (Playwright)
- **配置**: `vitest.config.ts` (include 范围) + `playwright.config.ts` (test path)
- **环境**: Trusted identity 模式 (默认) / localAuth.enabled=true (跨 scope 测试)

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-architecture-test-gate-functional/spec.md`：新增功能维度测试行为契约
- `openspec/specs/ts-architecture-test-gate-compatibility/spec.md`：新增兼容性维度测试行为契约
- `openspec/specs/ts-architecture-test-gate-observability/spec.md`：新增可观测性维度测试行为契约
- `openspec/specs/ts-architecture-test-gate-ui-interaction/spec.md`：新增 UI 交互维度测试行为契约

长期背景：
- `openspec/overview.md`：新增架构测试门的概述和真实 API 差异说明

设计视图：
- `openspec/designs/architecture/ts-architecture-test-gate.md`：新增架构设计（双框架、目录结构、真实 API 规则、已知问题）

验证入口：
- `vitest run` (Vitest 98 用例) + `npx playwright test` (Playwright 16 用例)
