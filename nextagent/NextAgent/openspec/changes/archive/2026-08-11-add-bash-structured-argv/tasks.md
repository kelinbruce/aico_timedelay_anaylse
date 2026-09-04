# 任务

- [x] 更新 Bash Tool schema 和模型可见描述，增加结构化 `args` 输入。
- [x] 将结构化 `command` + `args` 接入既有 sandbox execution 路径。
- [x] 增加 JSON/Gremlin 参数、Python sandbox 路由和非法混用的聚焦测试。
- [x] 运行 TypeScript 编译验证：`npx.cmd tsc -b packages/agent-capability --pretty false`。
- [x] 运行聚焦测试验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts --testNamePattern "quote-heavy JSON|mixed command" --maxWorkers=1`。
- [x] 运行 diff 空白检查：`git diff --check`。
- [x] 尝试运行 OpenSpec strict 校验并记录环境限制：`npm.cmd run lint:openspec` 失败，原因是当前本地环境缺少可执行的 `openspec` CLI；需在具备 OpenSpec CLI 的环境补跑 `openspec validate add-bash-structured-argv --strict`。
