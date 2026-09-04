## 1. Schema 修改

- [x] 1.1 将 `WorkflowVisibleDeltaSchema.content.maxLength` 从 `16_384` 改为 `150_000`
  来源：proposal 变更范围
  验证：`npx tsc -b` (packages/agent-contracts)

## 2. 运行时常量修改

- [x] 2.1 将 `maxTerminalMessageChars` 从 `16_384` 改为 `150_000`
  来源：proposal 变更范围
  验证：`npx tsc -b` (packages/agent-runtime)

## 3. 契约测试

- [x] 3.1 添加 contract test：验证 `WorkflowVisibleDeltaSchema` 接受 150000 字符 content、拒绝 150001 字符 content
  来源：design 可测试性
  验证：`npx vitest run --config vitest.config.contract.ts tests/contract/workflow-contracts.test.ts`

- [x] 3.2 添加 characterization test：验证远程 bridge 接受 150000 字符 content 事件、拒绝 150001 字符事件
  来源：design 可测试性
  验证：`npx vitest run --config vitest.config.contract.ts tests/contract/workflow-remote-gateway-adapter.test.ts`

## 4. 运行时 characterization 测试更新

- [x] 4.1 更新 `output-guard.test.ts` 中 3 个测试用例的 oversized 内容，使其超过 150000 字符
  来源：design 可测试性
  验证：`npx vitest run tests/agent-kernel/output-guard.test.ts`（6/6 passed）
  - "fails safely when terminal assistant content exceeds the runtime guard"：`repeat(800)` → `repeat(5000)`（35×5000=175000 > 150000）
  - "treats LLM content deltas as accumulated snapshots for terminal output guard"：`repeat(400)` → `repeat(5000)`（18×5000=90000 < 150000，累积 315000 > 150000）
  - "emits terminal message limit degradation only once after oversized accumulated content"：`repeat(800)` → `repeat(5000)`

## 5. 验证收尾

- [x] 5.1 运行完整 workflow 契约测试
  验证：`npx vitest run --config vitest.config.contract.ts tests/contract/workflow-`（71/71 passed）

- [x] 5.2 运行 output-guard characterization 测试
  验证：`npx vitest run tests/agent-kernel/output-guard.test.ts`（6/6 passed）

- [x] 5.3 OpenSpec 验证
  验证：`openspec validate --all --strict`（191/191 passed）

- [x] 5.4 全量构建
  验证：`npx tsc -b` (packages/agent-contracts, packages/agent-runtime)