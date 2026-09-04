## 实施任务

> 按依赖顺序排列，每个 task 对应一个可独立验收的交付结果。
> 本次对账按 source review checkpoint 更新状态：已勾选项以 `tests/TESTClaw/tests/suites/add-ts-contract-test-gate/`、`tests/TESTClaw/tests/vitest.config.ts` 与 `tests/TESTClaw/README.md` 的静态证据为准；全量执行门禁仍保留未勾选，待实跑补齐。

### Phase 1: 测试基础设施

- [x] **T01**: 创建 `tests/suites/add-ts-contract-test-gate/` 目录，添加 9 个测试文件骨架
  - 对账依据：source review 确认 `01-functional.test.ts` 至 `09-architecture.test.ts` 共 9 个测试文件已落地，且 `08-contract.test.ts` 已包含 Gateway/Port 契约测试 describe 块

### Phase 2: 核心契约测试实现

- [x] **T02**: 实现 01-functional.test.ts（58 个用例）和 08-contract.test.ts（11 个用例），包含 Runtime Command 契约测试
  - 对账依据：source review 确认 `08-contract.test.ts` 已覆盖 Runtime Command 契约测试，且 `01-functional.test.ts` 与 `08-contract.test.ts` 已落地

- [x] **T03**: 实现 Session Store 契约测试（owner scope 隔离）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Session Store 契约测试

- [x] **T04**: 实现 Session Message Store 契约测试（append 幂等性、hide 可见性）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Session Message Store 契约测试

- [x] **T05**: 实现 Active Context Store 契约测试（version CAS、compaction 原子性）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Active Context Store 契约测试

- [x] **T06**: 实现 RequestRun Store 契约测试（status 状态机）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 RequestRun Store 契约测试

- [x] **T07**: 实现 Timeline Store 契约测试（sequence 单调性）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Timeline Store 契约测试

- [x] **T08**: 实现 Checkpoint Store 契约测试（幂等 key）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Checkpoint Store 契约测试

- [x] **T09**: 实现 Attachment Store 契约测试（metadata/blob 分离、availability）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Attachment Store 契约测试

- [x] **T10**: 实现 Model Gateway Port 契约测试（safe error mapping）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Model Gateway Port 契约测试

- [x] **T11**: 实现 Capability Gateway Port 契约测试（timeout/cancellation、result contract）
  - 对账依据：source review 确认 `08-contract.test.ts` 包含 Capability Gateway Port 契约测试

### Phase 3: 集成验证

- [ ] **T12**: 全量契约测试运行验证（所有 Gateway/Port 契约测试通过）
  - 验证：`.\scripts\run-tests.ps1 -Suite contract` 全部通过
  - 当前状态：未通过；本地直跑 `npx vitest run --config tests/TESTClaw/tests/vitest.config.ts tests/TESTClaw/tests/suites/add-ts-contract-test-gate/` 失败，`01-functional`、`02-performance`、`03-reliability`、`04-compatibility`、`08-contract` 缺少 `@nextagent/agent-app/testing` / `@nextagent/agent-common` 解析
- [ ] **T12b**: 全量测试运行验证（9 个测试文件 144 个用例全部通过）
  - 验证：`.\scripts\run-tests.ps1 -Backend` 全部通过
  - 当前状态：未执行；`tests/TESTClaw/scripts/run-tests.ps1` 需要预先准备 `tests/TESTClaw/target/` 二进制包目录并设置 `OPENAI_API_KEY`，当前仓库缺少 `target/`

- [x] **T13**: 更新 TESTClaw readme.md 添加 contract-test-gate 说明
  - 对账依据：source review 确认 `tests/TESTClaw/README.md` 已包含 `add-ts-contract-test-gate` 目录结构与运行说明
