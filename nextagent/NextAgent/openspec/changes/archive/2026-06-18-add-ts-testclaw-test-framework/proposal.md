## 背景与问题（Why）

NextAgent 项目当前有 source-level 测试框架（Vitest 单元测试、Playwright E2E 测试）在 CI 中针对开发 workspace 运行。随着 NextAgent 开始发布二进制 runtime package（local-build-YYYYMMDD-win32-x64.zip），需要一个新的独立黑盒测试框架来验证：

1. **Package 完整性**：解压后的目录结构、依赖完整性和启动脚本
2. **配置校验**：API 配置、secret 引用、系统配置正确性
3. **二进制 package 启动**：nextagent-start/stop/self-check 脚本正常工作
4. **端到端功能**：针对真实运行中的 package 的 HTTP API、SSE 流式、session 管理、request 生命周期
5. **性能和可靠性**：真实运行条件下的性能指标和可靠性

当前没有专用的二进制 package 测试框架，这意味着：
- 交付前无法系统性验证发布质量
- 用户报告的运行时问题难以复现和诊断
- 配置错误（例如明文 API Key）在发布前检测不到

TESTClaw 作为 NextAgent 二进制 package 的独立验证层填补这个空缺。

## 变更范围（What Changes）

### 新增测试框架目录

- 新增 ` 	ests/TESTClaw/ ` 目录，承载完整的二进制 package 测试框架
- 该框架独立于源码开发工作流，可以独立运行

### 测试框架结构

``text
tests/TESTClaw/
├── target/                    # NextAgent binary package extracted here
├── tests/
│   ├── helpers/               # Test helper utilities
│   ├── fixtures/              # Test fixtures
│   ├── suites/
│   │   ├── add-ts-contract-test-gate/  # Vitest backend tests (9 files, 144 tests)
│   │   └── add-ts-architecture-test-gate/ # Playwright E2E tests (241 files)
│   │       ├── business-flow/
│   │       ├── spec-shall/
│   │       ├── concurrency/
│   │       ├── non-functional/
│   │       └── ui-interaction/
│   ├── vitest.config.ts
│   └── playwright.config.ts
├── scripts/
│   ├── setup-package.mjs
│   ├── run-tests.ps1          # Unified test runner script
│   └── lint-tests.mjs         # Test code static checker
├── packages/
│   └── agent-app/config/      # Default agent and system configuration templates
├── .gitignore                 # Excludes runtime/output dirs from version control
├── README.md
├── package.json
├── data/                      # Runtime test data (sqlite databases)
├── logs/                      # Runtime logs
├── test-output/               # Test artifacts (results, reports, logs)
└── docs/                      # Documentation and review artifacts
``

### 测试内容

- **Vitest 后端测试**（9 个套件、144 个测试）：功能、性能、可靠性、兼容性、安全、可服务性、e2e、contract、architecture
- **Playwright E2E 测试**（5 个套件、241 个文件）：UI 交互、业务流程、并发、非功能、spec 合规

### 测试 runner 脚本

` scripts/run-tests.ps1 ` 提供统一测试 runner，负责：
- 运行前 self-check（nextagent-self-check）
- NextAgent 服务生命周期（为 E2E 测试自动启动/停止）
- API 环境变量验证
- 针对中文测试名称的终端编码修复
- 实时进度计时器
- 计时汇总和日志输出到 ` 	est-output/ `

### 测试命令

``powershell
# Full test run (backend + E2E, auto-starts service)
.\scripts\run-tests.ps1 -All

# Backend only
.\scripts\run-tests.ps1 -Backend

# E2E only (NextAgent already running)
.\scripts\run-tests.ps1 -E2E -NoStart
``

Self-check 必须从 ` 	arget/ ` 目录运行：
``powershell
cd target
node bin\nextagent-self-check
``

## Capability 影响（Capability Impact）

### 新增 Capability

- ` 	estclaw-test-framework `：NextAgent 二进制 package 黑盒测试框架

### 修改的 Capability

- 无（本 change 新增独立测试框架，不修改既有 capability）

## 影响范围（Impact Scope）

### 代码影响

- 新增目录：` 	ests/TESTClaw/ `
- 不影响既有源码或 CI 工作流

### 配置影响

- ` .gitignore ` 排除运行时和产物目录：` 
ode_modules/ `、` 	arget/ `、` data/ `、` logs/ `、` 	est-output/ `、` docs/ `、` .skills/ `

### 测试影响

- 为二进制 package 发布提供独立验证入口
- 测试报告可用于发布质量评审

### 运维影响

- 用户可以下载二进制 package 并使用 TESTClaw 做本地验证

## 归档前基线提升计划（Baseline Promotion Plan）

### 行为契约

- ` openspec/specs/testclaw-test-framework/spec.md `：新增，定义 TESTClaw 框架结构、命令、报告格式和验证流程

### 长期背景

- ` openspec/overview.md `：新增 TESTClaw 作为二进制 package 测试框架的定位

### 设计视图

- ` openspec/designs/modules/testclaw.md `：新增，描述框架模块职责、helper、配置依赖和报告生成
- ` openspec/designs/architecture/testing.md `：补充 TESTClaw 与 source-level 测试的关系
- ` openspec/designs/spec-to-design-map.md `：新增 testclaw-test-framework 导航条目