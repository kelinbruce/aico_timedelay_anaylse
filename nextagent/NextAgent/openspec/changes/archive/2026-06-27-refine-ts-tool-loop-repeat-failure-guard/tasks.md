# 任务

- [x] 1. 在 Agent Core 中新增 request 本地的重复 capability 失败跟踪。
- [x] 2. 为重复退化和失败的 Bash 结果新增 characterization 测试。
- [x] 3. 在本地工具链允许的范围内运行定向验证。

验证说明：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/tool-loop.test.ts` 和 `openspec validate refine-ts-tool-loop-repeat-failure-guard --strict` 在当前环境中均通过。
