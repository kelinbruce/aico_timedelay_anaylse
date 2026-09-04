<!--
This file is the behavioral spec delta for the active change.
After archiving, surviving requirements sync to openspec/specs/testclaw-test-framework/spec.md.
Use these second-level headings:
- ## ADDED Requirements: new capability or requirement
- 
### Requirement: TESTCLAW-PW-WORKERS-010 Playwright E2E Parallel Workers

Playwright E2E tests SHALL use parallel workers configured as 50% of CPU cores, minimum 1, maximum 4. The ullyParallel option SHALL be enabled.

Vitest backend tests SHALL remain sequential (ileParallelism: false, sequence.sequential: true) because they directly access internal SQLite gateway stores that do not support concurrent writes.

#### Scenario: Playwright runs with multiple workers
- **WHEN** user runs Playwright E2E tests
- **THEN** workers SHALL be set to Math.min(4, Math.max(1, Math.floor(os.cpus().length * 0.5)))
- **AND** ullyParallel SHALL be 	rue

#### Scenario: Vitest remains sequential
- **WHEN** user runs Vitest backend tests
- **THEN** ileParallelism SHALL be alse
- **AND** sequence.sequential SHALL be 	rue

## MODIFIED Requirements: modify existing behavior; must fully restate the modified requirement
- ## REMOVED Requirements: remove behavior; must include Reason and Migration
- ## RENAMED Requirements: rename only; use FROM:/TO: format.
-->

## ADDED Requirements

### Requirement: TESTCLAW-DIR-STRUCTURE-001 目录结构

TESTClaw 测试框架 SHALL 组织在 `tests/TESTClaw/` 之下，并包含以下必需子目录：
- `target/`：被测产品目录，NextAgent 二进制包解压到此处
- `tests/`：测试代码目录，包含 `helpers/`、`fixtures/`、`suites/` 子目录
- `scripts/`：runner 脚本目录，包含 `run-tests.ps1` 和 `setup-package.mjs`
- `test-output/`：测试报告输出目录

#### Scenario: 目录结构完整
- **WHEN** 用户检查 `tests/TESTClaw/` 目录
- **THEN** SHALL 存在 `target/`、`tests/`、`scripts/`、`test-output/`、`package.json`、`README.md`

### Requirement: TESTCLAW-TARGET-SETUP-002 目标目录配置

被测产品 SHALL 解压到 `target/` 目录，包含：
- `bin/`：启动脚本（nextagent-start、nextagent-stop、nextagent-self-check）
- `backend/`：编译后的后端代码
- `config/`：配置目录（default-system.json、default-agent.yaml）
- `node_modules/@nextagent/`：依赖包

`scripts/setup-package.mjs` SHALL 自动检测 `target/package.json` 是否存在；当不存在时，SHALL 自动创建一个带有 `name` 和 `version` 的最小 `package.json`。

#### Scenario: 目标目录包含必需文件
- **WHEN** 用户将 NextAgent 二进制包解压到 `target/` 目录
- **THEN** SHALL 存在 `bin/`、`backend/`、`config/`、`node_modules/` 目录

#### Scenario: setup-package 自动创建 package.json
- **WHEN** 用户执行 `npm run setup`（调用 `scripts/setup-package.mjs`）
- **AND** `target/package.json` 不存在
- **THEN** 脚本 SHALL 自动创建 `target/package.json`，内容为 `{"name":"@nextagent/local-runtime","version":"0.1.0"}`

### Requirement: TESTCLAW-API-CONFIG-003 API 配置使用安全引用

API 配置 SHALL 使用 `env:` 或 `file:` 引用；SHALL NOT 直接以明文写入 API Key。`target/config/default-system.json` 中的 `credentialRef` 字段 SHALL 遵守 secret-configuration-boundary 规则。

Secret 校验判定规则：
1. `nextagent-self-check` SHALL 扫描 `default-system.json` 中所有 `credentialRef` 字段值。
2. 如果 `credentialRef` 值不以 `env:` 或 `file:` 前缀开头，SHALL 判定为明文引用。
3. 明文引用 SHALL 产生 `invalid-config-sample` 错误。
4. 校验 SHALL 在服务启动之前执行；如果校验失败，服务 SHALL NOT 启动。

#### Scenario: credentialRef 使用安全引用
- **WHEN** 用户配置 API 连接
- **THEN** `credentialRef` SHALL 使用 `env:OPENAI_API_KEY` 或 `file:config/api-key.txt` 格式
- **AND** SHALL NOT 使用明文 API Key

#### Scenario: 明文配置被拒绝
- **WHEN** 用户在 `default-system.json` 中写入明文 API Key
- **THEN** `nextagent-self-check` SHALL 返回 `invalid-config-sample` 错误
- **AND** 服务 SHALL NOT 启动

### Requirement: TESTCLAW-CMD-RUNDIR-004 二进制包命令在 target/ 目录运行

二进制包命令 SHALL 在 `target/` 目录中执行，包括：
- `node bin/nextagent-self-check`
- `node bin/nextagent-start`
- `node bin/nextagent-stop`

测试框架命令（`npm.cmd run test`、`npm.cmd run test:e2e`、`.\scripts\run-tests.ps1`）从 `TESTClaw/` 目录运行，而不是 `target/`。

不在 target/ 中时的错误行为：
1. 如果 CWD 中不存在 `package.json`，nextagent-start SHALL 以退出码 1 和 ENOENT 错误退出。
2. 如果 `package.json` 存在但 `config/` 缺失，nextagent-self-check SHALL 返回 `invalid-config-sample` 错误。
3. 脚本 SHALL NOT 自动检测或切换工作目录。

#### Scenario: 命令在 target/ 目录中成功执行
- **WHEN** 用户在 `target/` 目录中执行 `node bin/nextagent-self-check`
- **THEN** 命令 SHALL 正确解析 package root 并执行配置校验

#### Scenario: 命令在非 target 目录中失败
- **WHEN** 用户从 `TESTClaw/` 目录执行 `node target/bin/nextagent-self-check`
- **THEN** 命令 SHALL 以错误退出

### Requirement: TESTCLAW-E2E-SERVICE-005 E2E 测试要求服务运行中

Playwright E2E 测试 SHALL 在 NextAgent 服务运行于 `http://127.0.0.1:3000` 的状态下执行。统一 runner（`run-tests.ps1`）SHALL：
1. 在 E2E 测试之前自动启动服务（除非提供 `-NoStart` 标志）
2. 在使用 `-NoStart` 模式时验证服务可达
3. 在 E2E 测试之后自动停止服务（除非提供 `-KeepRunning` 标志）

#### Scenario: E2E 测试在服务运行时执行
- **WHEN** 用户运行 `.\scripts\run-tests.ps1 -All`
- **THEN** runner SHALL 自动启动 NextAgent 服务
- **AND** E2E 测试 SHALL 连接到 `http://127.0.0.1:3000`

#### Scenario: 服务未运行时 E2E 测试失败
- **WHEN** 用户在服务未运行时运行 `.\scripts\run-tests.ps1 -E2E -NoStart`
- **THEN** runner SHALL 报告错误并退出

### Requirement: TESTCLAW-REPORT-GEN-006 测试报告生成

测试执行 SHALL 生成以下报告文件：
- Vitest JSON 报告：`test-output/vitest-results.json`
- Playwright JSON 报告：`test-output/playwright-results.json`
- Playwright HTML 报告：`test-output/playwright-report/index.html`
- Runner 日志：`test-output/testclaw-YYYYMMDD-HHMMSS.log`

报告 SHALL 包含测试总数、通过数、失败数、跳过数和失败详情。

#### Scenario: 生成 Vitest 报告
- **WHEN** 用户执行 `npm.cmd run test`
- **THEN** SHALL 生成 `test-output/vitest-results.json`
- **AND** 报告 SHALL 包含 `numTotalTests`、`numPassedTests`、`numFailedTests` 字段

#### Scenario: 生成 Playwright 报告
- **WHEN** 用户执行 `npm.cmd run test:e2e`
- **THEN** SHALL 生成 `test-output/playwright-results.json` 和 `test-output/playwright-report/index.html`

#### Scenario: 报告目录被自动创建
- **WHEN** `test-output/` 目录不存在
- **THEN** 框架 SHALL 在写入报告之前自动创建该目录

### Requirement: TESTCLAW-GITIGNORE-007 测试产物不提交

`tests/TESTClaw/` 下的以下目录 SHALL 在 `.gitignore` 中排除，并 SHALL NOT 提交到仓库：
- `node_modules/`：依赖，通过 `npm install` 重建
- `target/`：二进制部署目录和运行时状态
- `data/`：运行时测试数据（SQLite 数据库）
- `logs/`：运行时日志
- `test-output/`：测试运行产物（报告、日志、临时脚本）
- `docs/`：文档和评审产物
- `.skills/`：不进入仓库的本地 skill 文件

#### Scenario: Gitignore 排除测试产物
- **WHEN** 用户执行 `git status`
- **THEN** `node_modules/`、`target/`、`data/`、`logs/`、`test-output/`、`docs/`、`.skills/` 中任何一个都 SHALL NOT 出现在暂存清单中

### Requirement: TESTCLAW-RUNNER-SCRIPT-008 统一测试 runner

`scripts/run-tests.ps1` SHALL 提供一个统一测试 runner，具备：
- 预检 self-check（`nextagent-self-check`）
- API 环境变量校验（必须设置 OPENAI_API_KEY）
- NextAgent 服务生命周期管理（自动启动/停止，HTTP 轮询就绪状态）
- 针对中文测试名称的终端编码修复（chcp 65001，UTF8 控制台编码）
- 进度计时器（60 秒间隔）
- 实时输出日志
- 耗时汇总

使用 `npm.cmd run test` 运行 Vitest，使用 `npm.cmd run test:e2e` 运行 Playwright。后端与 E2E 测试 SHALL 独立运行——一次 Vitest 失败 SHALL NOT 阻塞 Playwright 执行。

#### Scenario: 自动启动的完整测试运行
- **WHEN** 用户在设置 API 环境变量后运行 `.\scripts\run-tests.ps1 -All`
- **THEN** runner SHALL：self-check、启动服务、运行 Vitest、运行 Playwright、停止服务、打印汇总

#### Scenario: 服务已运行时仅运行 E2E
- **WHEN** 用户运行 `.\scripts\run-tests.ps1 -E2E -NoStart`
- **THEN** runner SHALL 验证服务可达并运行 Playwright 测试

#### Scenario: 缺失 API key
- **WHEN** 用户在没有 OPENAI_API_KEY 的情况下运行 `.\scripts\run-tests.ps1`
- **THEN** runner SHALL 在开始测试之前报告错误并退出
