## 背景与问题（Why）

NextAgent TS 后端已有 65 条稳定行为契约（OpenSpec specs），覆盖核心架构、运行时生命周期、模型调用、能力系统、上下文引擎、认证与安全、可观测性、E2E 质量门等领域。当前测试覆盖存在以下缺口：

1. **Gateway/SPI 契约验证缺口**：11 个 Gateway 接口和 2 个 Port 接口的契约语义（幂等性、scope 校验、状态转换、CAS 语义）缺乏系统化的黑盒端到端验证测试
2. **幂等性契约验证缺口**：submit/cancel/retry/hideMessage/appendEvent/saveCheckpoint 等核心写入操作的幂等性缺乏端到端可观测的验证用例
3. **Owner Scope 隔离验证缺口**：跨租户/跨用户的数据隔离缺乏端到端契约验证

现有后端测试（08-contract.test.ts）仅验证 API schema 形状，未覆盖契约的语义行为（如重复写入返回首次结果、scope 隔离、状态机转换约束）。

## 变更范围（What Changes）

1. 新增 `08-contract.test.ts` 中的 11 个 Gateway/SPI 契约验证测试用例，覆盖：
1. 新增 `tests/suites/add-ts-contract-test-gate/` 目录下 9 个测试文件共 144 个测试用例（含 11 个 Gateway/SPI 契约验证测试），覆盖：
   - 功能测试（01-functional.test.ts, 58）：Runtime Command、Session、Message、Active Context、RequestRun、Timeline、Checkpoint、Attachment、Model/Capability Gateway 全链路验证
   - 性能测试（02-performance.test.ts, 12）：启动时间、响应延迟、并发吞吐
   - 可靠性测试（03-reliability.test.ts, 10）：进程重启恢复、错误处理
   - 兼容性测试（04-compatibility.test.ts, 8）：跨版本、跨平台
   - 安全测试（05-security.test.ts, 6）：credential 边界、sandbox
   - 可服务性测试（06-serviceability.test.ts, 8）：日志、诊断
   - E2E 测试（07-e2e.test.ts, 16）：完整业务链路
   - 契约测试（08-contract.test.ts, 11）：Gateway/SPI 契约语义验证（submit 幂等性、cancel 终态约束、retry attempt lineage、owner scope 隔离、version CAS、safe error mapping 等）
   - 架构测试（09-architecture.test.ts, 15）：Package 依赖边界验证
2. 新增契约测试作为 TESTClaw Vitest 后端测试的独立门禁（test:contract gate）

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-contract-test-gate`: NextAgent TS 后端 Gateway/SPI 契约语义的端到端黑盒验证，覆盖 11 个 Gateway 接口和 2 个 Port 接口的幂等性、scope 隔离、状态机转换、CAS 语义和 safe error mapping 契约
- 测试文件位于 `tests/suites/add-ts-contract-test-gate/` 目录下，包含 9 个测试文件共 144 个测试用例

### 修改的 Capability

无。本变更只新增测试 capability，不修改已有 spec 的行为契约。

## 影响范围（Impact）

- **测试文件**：`tests/TESTClaw/tests/suites/add-ts-contract-test-gate/` 目录下 9 个测试文件（01-functional 至 09-architecture），共 144 个测试用例
- **测试框架**：TESTClaw vitest.config.ts 已更新 include 路径，支持 `add-ts-contract-test-gate/**/*.test.ts`
- **测试依赖**：所有契约测试通过 `@nextagent/*` alias 从 `target/node_modules` 加载编译后产物
- **CI 影响**：新增契约测试门禁，运行时间预计增加 1-2 分钟
- **源码验证面**：覆盖 agent-runtime、agent-session、agent-core、agent-model、agent-capability、agent-context-engine、agent-platform-gateway-local、agent-attachment-runtime 共 8 个核心模块

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/ts-contract-test-gate/spec.md：新增

长期背景：
- openspec/overview.md：新增 ts-contract-test-gate 测试能力基线条目

设计视图：
- openspec/designs/architecture/：无（契约测试不引入新架构）
- openspec/designs/modules/：无
- openspec/designs/adr/：无
- openspec/designs/spec-to-design-map.md：新增 ts-contract-test-gate 到验证入口映射

验证入口：
- `npx vitest run --config tests/vitest.config.ts tests/suites/add-ts-contract-test-gate/ --testTimeout=7200000 --hookTimeout=7200000`
