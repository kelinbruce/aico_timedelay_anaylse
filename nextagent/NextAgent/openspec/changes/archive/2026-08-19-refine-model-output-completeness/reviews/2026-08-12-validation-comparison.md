# PR #1110 Node 22 双侧验证对照

- 运行环境：Windows x64，Node.js `22.22.0`
- 基线：`origin/main=ff1a56191`
- PR：合入上述基线后的 `codex/fix-inferred-model-output-truncation`

| 门禁 | origin/main | PR | 结论 |
|---|---:|---:|---|
| `npm run build` | FAIL：`skill-manifest.test.ts:674 TS2554` | FAIL：同文件、同行、同错误 | 已复现的基线失败；PR 无新增 build error |
| `npm run test:contract` | 381/381 | 382/382 | PASS |
| `npm run lint:architecture` | 304/304 | 304/304 | PASS |
| `npm test` | 2060/2060 | 2069/2069 | PASS |
| focused model/Core | N/A | 125/125 | PASS |
| focused NetAgent guard | N/A | 9/9 | PASS |
| OpenSpec strict | PASS | PASS | PASS |
| `git diff --check` | N/A | PASS | PASS |

首次并行执行两侧 `npm test` 时，PR 的 browser smoke 因双方争用固定端口 `127.0.0.1:18410` 出现 `EADDRINUSE`；停止并行后单独复跑 PR 得到 2069/2069。该并行环境冲突不计为产品失败。

基线豁免仅覆盖上述 `skill-manifest.test.ts:674` 的单一 TypeScript 错误。它不在 PR diff 中，PR 与 main 的错误文本一致；本 change 不修改该测试或相关 capability manifest 行为。
