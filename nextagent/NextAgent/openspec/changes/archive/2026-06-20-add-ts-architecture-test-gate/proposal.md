## 背景与问题（Why）

NextAgent TS 后端已有 65 条稳定行为契约（OpenSpec specs），覆盖核心架构、运行时生命周期、模型调用、能力系统、上下文引擎、认证与安全、可观测性、E2E 质量门等领域。当前测试覆盖存在以下缺口：

1. **业务流 E2E 验证缺口**：15 条核心业务流（从请求提交到终端交付）缺乏系统化的端到端可验证测试规格
2. **Spec SHALL 声明验证缺口**：65 个 spec 中的 148 个核心 SHALL/MUST 声明缺乏端到端可观测的验证用例
3. **并发冲突验证缺口**：5 个模块交叉点的 9 种并发/竞争态场景缺乏端到端验证
4. **非功能验证缺口**：15 个性能、可靠性、安全、容错性测试点缺乏端到端规格
5. **前端 UI 验证缺口**：16 个前端交互测试点（SSE 消费、意图识别、会话管理、认证设置）缺乏端到端规格

现有 30 个 Playwright E2E 测试只覆盖核心问答流、认证、幂等性、请求验证、会话管理等基本场景，远未覆盖全部 spec 声明的行为。

## 变更范围（What Changes）

本变更新增 5 个 test capability，以 spec-driven 形式声明 NextAgent 的 242 个 E2E 测试行为规格：

| 新增 Capability | 覆盖范围 | 测试点数 | 测试用例数 |
|---|---|---|---|
| `e2e-business-flow` | 15 条业务流的完整 E2E 路径验证 | 75 | 75 (55 active + 20 skip) |
| `e2e-spec-shall` | 65 个 Spec 的 148 个 SHALL/MUST 声明 E2E 验证 | 148 | 148 (144 active + 4 skip) |
| `e2e-concurrency` | 5 个模块交叉点的并发/竞争态场景验证 | 9 | 9 |
| `e2e-non-functional` | 性能、可靠性、安全、容错性测试点验证 | 33 | 33 (10 active + 23 skip) |
| `e2e-ui-interaction` | 前端 UI 交互测试点验证 | 17 | 17 (9 active + 8 skip) |

测试实现使用 Playwright，按 spec 分类组织目录结构：
- `tests/suites/business-flow/` — 15 条业务流（54 个 TC）
- `tests/suites/spec-shall/` — Spec SHALL 声明验证（148 个 TC）
- `tests/suites/concurrency/` — 并发/竞争态验证（9 个 TC）
- `tests/suites/non-functional/` — 非功能验证（15 个 TC）
- `tests/suites/ui-interaction/` — 前端 UI 交互验证（16 个 TC）
测试实现使用 Playwright，按 spec 分类组织目录结构（所有测试文件位于 `tests/suites/add-ts-architecture-test-gate/` 下）：
- `tests/suites/add-ts-architecture-test-gate/business-flow/` — 53 个文件（75 个 TC: 55 active + 20 skip）
- `tests/suites/add-ts-architecture-test-gate/spec-shall/` — 148 个文件（148 个 TC: 144 active + 4 skip）
- `tests/suites/add-ts-architecture-test-gate/concurrency/` — 9 个文件（9 个 TC）
- `tests/suites/add-ts-architecture-test-gate/non-functional/` — 15 个文件（33 个 TC: 10 active + 23 skip）
- `tests/suites/add-ts-architecture-test-gate/ui-interaction/` — 16 个文件（17 个 TC: 9 active + 8 skip）

## Capability 影响（Capabilities）

### 新增 Capability

- `e2e-business-flow`: 声明 15 条业务流的端到端行为规格，每条业务流从触发入口到终态的完整路径验证
- `e2e-spec-shall`: 声明 65 个 Spec 的核心 SHALL/MUST 端到端可验证行为，按 spec 分组
- `e2e-concurrency`: 声明模块交叉点的并发/竞争态行为规格，覆盖 runtime、gateway、channel-web、session/capability、context-engine、capability catalog 6 个交叉点
- `e2e-non-functional`: 声明性能、可靠性、安全、容错性的端到端行为规格
- `e2e-ui-interaction`: 声明前端 UI 交互的端到端行为规格，覆盖输入回复、SSE 消费、意图识别、会话管理、认证设置

### 修改的 Capability

无。本变更只新增测试 capability 规格和测试用例，不修改已有 spec 的行为契约。

## 影响范围（Impact）
> **注**：当前 282 个测试条目中，55 个使用 	est.skip() 标记为暂时跳过（其中 32 个文件为 skip-only）。实际活跃测试为 227 个。跳过的测试主要集中在需要特定环境配置（如 Bash tool、进程重启、性能测量、浏览器 UI）的场景，待条件满足后可逐一激活。


- **测试文件**：新增 242 个 E2E 测试用例（Playwright .spec.ts），分布在 5 个测试目录下
- **Spec 文件**：新增 5 个 test capability spec.md
- **源码验证面**：覆盖 agent-runtime、agent-core、agent-channel-web、agent-model、agent-capability、agent-context-engine、agent-app、agent-observability、agent-platform-gateway-local、agent-session、agent-channel-web-auth-local 全部 11 个核心模块
- **测试框架**：Playwright 1.60，使用 APIRequestContext（API 级别）和 Page（前端级别）
- **Mock 策略**：分层 mock，happy path 无 mock，error path 使用 page.route，并发使用真实并发 + timing 控制
- **Selector 策略**：优先 data-testid，fallback 使用 class/aria-label
- **CI 影响**：新增 E2E 测试套件，运行时间预计增加 10-15 分钟

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/e2e-business-flow/spec.md：新增
- openspec/specs/e2e-spec-shall/spec.md：新增
- openspec/specs/e2e-concurrency/spec.md：新增
- openspec/specs/e2e-non-functional/spec.md：新增
- openspec/specs/e2e-ui-interaction/spec.md：新增

长期背景：
- openspec/overview.md：新增 5 个 E2E test capability 基线条目

设计视图：
- openspec/designs/architecture/：无（E2E 测试不引入新架构，测试组织策略归入 design）
- openspec/designs/modules/：无
- openspec/designs/adr/：无
- openspec/designs/spec-to-design-map.md：新增 5 个 E2E test capability 到验证入口映射

验证入口：
- `npx playwright test business-flow/` — 业务流测试
- `npx playwright test spec-shall/` — Spec SHALL 验证
- `npx playwright test concurrency/` — 并发验证
- `npx playwright test non-functional/` — 非功能验证
- `npx playwright test ui-interaction/` — 前端 UI 验证
- `npx playwright test add-ts-architecture-test-gate/business-flow/` — 业务流测试
- `npx playwright test add-ts-architecture-test-gate/spec-shall/` — Spec SHALL 验证
- `npx playwright test add-ts-architecture-test-gate/concurrency/` — 并发验证
- `npx playwright test add-ts-architecture-test-gate/non-functional/` — 非功能验证
- `npx playwright test add-ts-architecture-test-gate/ui-interaction/` — 前端 UI 验证
