# 任务

- [x] 1. 为程序性文本内容更新 OpenSpec delta。
- [x] 2. 更新 `procedureText` 的核心 contract 和 runtime 校验。
- [x] 3. 更新 memory 工具的归一化、schema、描述和测试。
- [x] 4. 更新抽取候选生成/校验以及 gateway FTS/brief 推导。
- [x] 5. 运行定向验证并确认无 SQLite 表字段变更。

验证：

- `npm test -- packages/agent-memory/tests/memory-tools-provider.test.ts packages/agent-memory/tests/memory-extraction.test.ts tests/contract/memory-core-contracts.test.ts tests/agent-kernel/local-gateway-contract.test.ts`
- `npm run test:contract`
- `npm run build`
- `npm run lint:architecture`
- `npm test`
- `openspec validate refine-memory-procedural-text-content --strict`
- `openspec validate --all --strict`

Schema 说明：`long_term_memory` 表字段未改变；程序性文本存储在既有 `content_json` 中。
