## 1. Bash 未闭合引号诊断

- [x] 1.1 为未闭合引号的 Bash 命令新增特定的安全原因和提示。
  来源：`Bash Accepts Only Strict Single Commands`。
  验证：`npm.cmd test -- packages/agent-capability/tests/bash-capability.test.ts`。

- [x] 1.2 为畸形 Python Skill 查询引号新增回归覆盖。
  来源：`Bash Accepts Only Strict Single Commands`。
  验证：`npm.cmd test -- packages/agent-capability/tests/bash-capability.test.ts`。

## 2. 验证

- [x] 2.1 运行 OpenSpec lint。
  验证：`npm run lint:openspec`。
