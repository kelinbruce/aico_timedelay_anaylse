## 背景和现状（Context and Current State）

NextAgent 项目已有 source-level 测试框架（Vitest、Playwright）在 CI 中针对开发 workspace 运行。随着 NextAgent 开始发布二进制 runtime package，需要一个新的独立黑盒测试框架（TESTClaw）来验证提取出的 package 能正确配置、启动和运行。

当前问题：
1. 发布 package 完整性无法被系统性验证
2. 用户配置错误（例如明文 API Key）在交付前检测不到
3. 用户报告的运行时问题难以复现
4. 二进制 package 启动脚本（nextagent-start/stop/self-check）缺少独立验证

TESTClaw 作为独立黑盒测试层，验证提取出的二进制 package 能正确配置和运行。

## 目标和非目标（Goals and Non-Goals）

**目标：**
- 定义 TESTClaw 测试框架目录结构和技术栈
- 规定测试命令运行目录约束
- 定义测试报告生成格式
- 规定 API 配置安全引用机制
- 提供带服务生命周期管理的统一测试 runner 脚本

**非目标：**
- 不修改 NextAgent 源码或既有 CI 工作流
- 不定义 source-level 测试策略
- 不替代发布资格流程（由 add-ts-e2e-release-package-gate 承接）

## 设计决策（Design Decisions）

### 决策 1：测试框架独立于源码

把 TESTClaw 放在 `tests/TESTClaw/` 下，独立于源码开发工作流。理由：
- 二进制 package 测试不需要源码依赖
- 用户下载 package 后可以使用 TESTClaw 做本地验证
- 测试产物（test-output、target、data、logs、docs）不污染源码仓库

### 决策 2：二进制 package 命令必须在 target/ 目录运行

二进制 package 内的脚本使用 `process.cwd()` 解析 package 根目录，要求在 `target/` 下执行：
- `node bin/nextagent-self-check`
- `node bin/nextagent-start/stop`

Vitest 和 Playwright 测试从 `TESTClaw/` 目录运行，而不是 `target/`。

### 决策 3：E2E 测试需要运行中的服务

Playwright E2E 测试要求 NextAgent 服务位于 `http://127.0.0.1:3000`。统一 runner 脚本（`run-tests.ps1`）管理：
1. E2E 测试前自动启动服务（如果尚未运行）
2. 验证服务可达（针对 -NoStart 模式）
3. E2E 测试后自动停止服务（除非 -KeepRunning）

### 决策 4：统一测试 runner 脚本

`scripts/run-tests.ps1` 提供：
- 运行前 self-check 验证
- API 环境变量验证（OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_MODEL_NAME）
- NextAgent 服务生命周期（后台启动、HTTP 轮询就绪、自动停止）
- 针对中文测试名称的终端编码修复（chcp 65001 + UTF8 编码）
- 进度计时器（60 秒间隔）
- 实时输出记录到 `test-output/testclaw-YYYYMMDD-HHMMSS.log`
- 计时汇总

Vitest 使用 `npm.cmd run test`（避免 Windows 上 npx.ps1 的参数解析 bug），Playwright 使用 `npm.cmd run test:e2e`。

后端和 E2E 测试独立运行 — Vitest 失败不会阻塞 Playwright 执行。

### 决策 5：测试报告格式

双格式报告：
- JSON：机器可解析，用于 CI 集成
- HTML：人类可读，用于用户审阅

报告输出位置：
- `test-output/vitest-results.json`（Vitest）
- `test-output/playwright-results.json`（Playwright）
- `test-output/playwright-report/index.html`（Playwright HTML）
- `test-output/testclaw-YYYYMMDD-HHMMSS.log`（runner 日志）

### 决策 6：setup-package.mjs 自动创建 package.json

`scripts/setup-package.mjs` SHALL 自动检测并创建 `target/package.json`。理由：
- 二进制 package 默认不含 package.json，但 with-frontend profile 需要它
- 手动创建容易出错，会导致 ENOENT 启动错误

### 决策 7：API 环境变量验证

Runner 脚本在启动前验证 `OPENAI_API_KEY` 已设置。二进制 package 配置（`default-system.json`）对模型配置使用 `env:` 引用，这要求在启动 NextAgent 的同一会话中设置好环境变量。


### 决策 8：Playwright E2E 并行 worker

Playwright E2E 测试 SHALL 以并行 worker 运行（CPU 核数的 50%，最少 1，最多 4）。理由：
- E2E 测试演练 HTTP API 和 SSE stream，它们本就为并发访问设计
- 对 300+ 测试用例来说，单 worker 执行过慢
- Vitest 后端测试保持串行，因为它们直接访问内部 SQLite（并发写会引发冲突）

配置：workers: Math.min(4, Math.max(1, Math.floor(os.cpus().length * 0.5)))，并启用 ullyParallel: true。

### 决策 9：Vitest 保持串行

Vitest 后端测试导入内部 package 并写入内存 SQLite。并发文件执行会导致：
- SQLite 锁冲突（共享内存数据库）
- 内部状态断言中的竞态条件

Vitest 配置保持 ileParallelism: false 和 sequence: { sequential: true }。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 可测试性 | 通过 Vitest 和 Playwright 做黑盒 API + UI 测试 | 运行测试套件 |
| 可靠性 | 服务生命周期由 runner 脚本管理 | run-tests.ps1 中的自动启动/停止 |
| 安全性 | API Key 必须使用 env: 或 file: 引用 | nextagent-self-check |
| 易用性 | 带分步说明的 README | 用户可按 README 操作 |
| 可维护性 | 带日志和计时的统一 runner 脚本 | run-tests.ps1 输出 |

## 验证追溯（Verification Traceability）

| 需求 ID | 需求 | 实现状态 | 验证 |
|---|---|---|---|
| TESTCLAW-DIR-STRUCTURE-001 | 目录结构 | 已完成 | 检查 tests/TESTClaw/ 目录 |
| TESTCLAW-TARGET-SETUP-002 | Target 配置 | npm run setup | 解压 package 并运行 setup |
| TESTCLAW-API-CONFIG-003 | 安全引用 | 已完成 | nextagent-self-check |
| TESTCLAW-CMD-RUNDIR-004 | 命令运行目录 | README 说明 | 在 target/ 中运行 self-check |
| TESTCLAW-E2E-SERVICE-005 | 服务生命周期 | 已完成（run-tests.ps1） | 运行 E2E 测试并自动启动 |
| TESTCLAW-REPORT-GEN-006 | 报告生成 | 已完成 | 检查 test-output/ 目录 |
| TESTCLAW-GITIGNORE-007 | Gitignore | 已完成 | git status |
| TESTCLAW-RUNNER-SCRIPT-008 | 统一 runner | 已完成（run-tests.ps1） | .\scripts\run-tests.ps1 -All |
| TESTCLAW-ENCODING-FIX-009 | 终端编码 | 已完成（chcp 65001 + UTF8） | 运行带中文输出的测试 |
| TESTCLAW-PW-WORKERS-010 | Playwright 并行 worker | 已完成 | 检查 playwright.config.ts 的 workers 设置 |

## 失败与降级（Failure and Degradation）

| 失败场景 | 行为 | 恢复 |
|---|---|---|
| target/ 目录为空或缺失 | 所有测试失败，报告目录缺失错误 | 重新解压二进制 package 到 target/ |
| package.json 缺失 | nextagent-start 以 ENOENT 错误退出 | 运行 `npm run setup` 或手动创建 |
| config/default-system.json 配置错误 | nextagent-self-check 返回 invalid-config-sample | 修复配置后重跑 |
| API 环境变量未设置 | nextagent-self-check 失败；runner 脚本报错并阻断 | 运行前设置环境变量 |
| 服务启动超时（>30s） | E2E 测试失败 ERR_CONNECTION_REFUSED | 检查端口冲突和配置，重启服务 |
| E2E 期间服务崩溃 | 已完成结果保留；后续测试标记失败 | 重启服务并重跑 E2E |
| Vitest 模块加载失败 | 错误消息和非零退出码 | 检查 node_modules 安装 |
| Playwright 未安装 | E2E 命令失败并提示安装浏览器 | 运行 `npx playwright install` |

## 流程集成（Flow Integration）

TESTClaw 与 NextAgent 既有流程的关系：

1. **CI 关系**：TESTClaw 独立于 CI。CI 使用 source-level 测试；TESTClaw 验证构建出的二进制 package。
2. **发布资格关系**：`add-ts-e2e-release-package-gate` 承接发布前资格认证；TESTClaw 承接发布后用户侧验证。它们是上下游关系：
   - release-package-gate：发布前 gate → 通过后生成二进制 package
   - TESTClaw：发布后验证 → 用户下载 package 后的质量确认
3. **测试执行顺序**：后端和 E2E 测试独立运行。Vitest 不要求服务运行；Playwright 要求服务运行。

## 待确认问题（Open Questions）

无。
