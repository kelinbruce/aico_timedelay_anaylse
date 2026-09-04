<!--
Task writing rules:
- Each checkbox corresponds to exactly one independently verifiable deliverable; if it can be "partially completed", it must be split.
- Each implementation task must include "Verification: <specific command, test file, or code review checkpoint>".
- Each implementation task must include "Source: <spec requirement, design rule, or proposal scope>".
- When involving forbidden behavior, boundary constraints, permissions, dependency rules, or failure paths, must add negative verification task and actually trigger and assert failure.
-->

## 1. 测试框架目录与配置

- [x] 1.1 创建 tests/TESTClaw 目录结构
  验证：检查 tests/TESTClaw/ 含有 target/、tests/、scripts/、test-output/、package.json
  来源：TESTCLAW-DIR-STRUCTURE-001

- [x] 1.2 更新 .gitignore 以排除测试产物
  验证：git status 不显示 tests/TESTClaw/test-output/、tests/TESTClaw/target/、tests/TESTClaw/docs/、tests/TESTClaw/.skills/
  来源：TESTCLAW-GITIGNORE-007

- [x] 1.3 编写带使用说明的 README.md
  验证：README.md 包含目录结构、安装、测试命令、故障排查
  来源：design.md 可维护性结论

## 2. 测试代码与报告

- [x] 2.1 Vitest 后端测试代码（tests/suites/backend/）
  验证：npm.cmd run test 生成 test-output/vitest-results.json；测试文件位于 tests/suites/add-ts-contract-test-gate/
  来源：TESTCLAW-REPORT-GEN-006

- [x] 2.2 Playwright E2E 测试代码（tests/suites/ 下 5 个套件）
  验证：npm.cmd run test:e2e 生成 test-output/playwright-report/index.html；测试文件位于 tests/suites/add-ts-architecture-test-gate/
  来源：TESTCLAW-E2E-SERVICE-005、TESTCLAW-REPORT-GEN-006

- [x] 2.3 测试 helper 工具（tests/helpers/）
  验证：helper 模块被测试文件正确引用
  来源：design.md 可测试性结论

## 3. 统一测试 runner

- [x] 3.1 创建带服务生命周期管理的 run-tests.ps1
  验证：.\scripts\run-tests.ps1 -All 自动启动服务、运行测试、自动停止服务
  来源：TESTCLAW-RUNNER-SCRIPT-008

- [x] 3.2 新增 API 环境变量验证
  验证：未设置 OPENAI_API_KEY 时运行报错并退出
  来源：TESTCLAW-RUNNER-SCRIPT-008

- [x] 3.3 新增针对中文测试名称的终端编码修复
  验证：终端输出中中文字符正确显示
  来源：TESTCLAW-RUNNER-SCRIPT-008

- [x] 3.4 新增 -NoStart 服务可达性检查
  验证：服务未运行时 .\scripts\run-tests.ps1 -E2E -NoStart 报告错误
  来源：TESTCLAW-E2E-SERVICE-005

## 4. 验证与收尾

- [x] 4.1 运行完整测试套件并生成报告
  验证：test-output/ 含有 vitest-results.json、playwright-results.json、playwright-report/index.html
  来源：TESTCLAW-REPORT-GEN-006

- [x] 4.2 验证命令运行目录约束
  验证：在 target/ 中运行 nextagent-self-check 成功；从非 target 目录运行失败
  来源：TESTCLAW-CMD-RUNDIR-004

- [x] 4.3 验证 API 配置安全引用机制
  验证：配置中的明文 API Key 导致 nextagent-self-check 返回 invalid-config-sample 错误
  来源：TESTCLAW-API-CONFIG-003

- [x] 4.4 验证 Vitest 不阻塞 Playwright 执行
  验证：Vitest 失败时 Playwright E2E 测试仍会运行
  来源：TESTCLAW-RUNNER-SCRIPT-008


- [x] 4.5 配置 Playwright E2E 并行 worker
  验证：playwright.config.ts 的 workers 基于 50% CPU 核数且 fullyParallel: true
  来源：TESTCLAW-PW-WORKERS-010

## 归档前基线更新（非实现任务）

实现完成并验证后、归档前：

- 同步 `openspec/specs/testclaw-test-framework/spec.md`：新增行为契约
- 更新 `openspec/overview.md`：新增 TESTClaw 定位
- 更新 `openspec/designs/architecture/testing.md`：新增 TESTClaw 与 source-level 测试的关系
- 创建 `openspec/designs/modules/testclaw.md`：描述测试框架模块职责
- 更新 `openspec/designs/spec-to-design-map.md`：新增导航条目
- 检查长期文档不重复测试框架职责
