# 任务

- [x] 1. 为 source-evidence 幂等抽取融合新增 OpenSpec requirement。
- [x] 2. 更新 memory 抽取融合以跳过重复 source evidence。
- [x] 3. 为重复 dreaming 和独立佐证新增定向测试。
- [x] 4. 运行定向验证。

验证：

- `npm test -- packages/agent-memory/tests/memory-extraction.test.ts`
- `openspec validate refine-memory-extraction-idempotent-evidence --strict`
- `npm run build`
