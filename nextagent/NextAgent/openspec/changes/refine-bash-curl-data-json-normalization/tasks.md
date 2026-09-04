## 1. Tokenizer 转义修复

- [x] 1.1 修正 `bash-policy.ts` tokenizer：双引号串内处理 `\"`、`\\`、`\$`、`` \` `` 和行续接，保留其它反斜杠。
  验证：tokenizer characterization tests（`bash-capability.test.ts`）全部通过。
- [x] 1.2 修正 `bash-tool.ts` 的 `hasUnclosedQuote` 使其与 tokenizer 转义语义一致。
  验证：含 `\"` 转义的未闭合命令返回 `balancedQuotes` + `BASH_COMMAND_UNCLOSED_QUOTE`。

## 2. curl data payload JSON 校验

- [x] 2.1 新增 `normalizeCurlDataArguments` 和 `normalizeCurlDataPayload`，覆盖 `-d`/`--data*` flag、粘连形式和长形式。
  验证：`tsc --noEmit` 通过。
- [x] 2.2 在 curl arg pipeline 接入 normalization（command-string 和 argv mode）。
  验证：集成测试验证合法 JSON 透传、单引号定界 JSON 修复、非 JSON 透传。
- [x] 2.3 新增集成测试：合法 JSON 透传、值内单引号保留、command-string 修复、argv 修复。
  验证：`npx vitest run` 新增 7 个测试（3 tokenizer + 4 curl）全部通过。

## 3. 验证

- [x] 3.1 运行 `openspec validate refine-bash-curl-data-json-normalization --strict`。
  验证：本 change strict validation 通过。仓库级 `openspec validate --all --strict` 为 245 passed / 11 failed，11 个失败均为既有无关 active changes（UI panel、RAG、spec duplicate header 等），与本 change 无关。
- [x] 3.2 运行 `npx tsc --noEmit -p packages/agent-capability/tsconfig.json`。
  验证：无类型错误。
- [x] 3.3 运行 bash-capability tests：46 passed / 1 failed（`header.X-Subject-Id` 断言为 HEAD 中既有失败，与本次改动无关）。
- [x] 3.4 运行 `nextagent-code-review` 模型语义检视。
  验证：检视结论为 PASS WITH FOLLOW-UP（详见检视报告）。
