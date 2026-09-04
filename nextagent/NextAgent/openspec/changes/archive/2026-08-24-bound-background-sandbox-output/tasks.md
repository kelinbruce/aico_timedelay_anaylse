## 0. 存量 Requirement 迁移

- [x] 0.1 将 `bash-tool` 的 `Bash Rejects Unsupported Python Invocation Modes Before Sandbox Submission` 原子迁移到 `FN-5.5` canonical spec `command-script-tools`，来源只保留 `REMOVED`，目标完整承载原行为和零参数 REPL 增量。
  来源：design `存量 Requirement 迁移方案`
  验证：`openspec validate bound-background-sandbox-output --strict`，并检查两个 Requirement 只按来源/目标角色出现。

## 1. `FN-5.5 执行命令和脚本`

- [x] 1.1 使用现有 Python mode guard 拒绝 `python`、`python3` 的零参数调用，返回 `BASH_PYTHON_REPL_UNSUPPORTED`，且不调用 sandbox dependency。
  来源：`Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/bash-capability.test.ts`

## 2. `FN-6.3 沙箱执行命令`

- [x] 2.1 用 stdout/stderr pipe 替代后台进程直接文件描述符写入；每通道只写入 `10,485,760 bytes` 以内的顺序前缀，第一个超限字节触发一次停止落盘和根进程终止。
  来源：`Sandbox Failure And Resource Limits Are Explicit`；design `FN-6.3 沙箱执行命令 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`

- [x] 2.2 超限或输出文件写入失败时 completion 固定为 `FAILED/-1`；两类 signal 只保留各自规格允许的字段，写入异常仅通过 canonical `rawExceptionData` 进入本地 operational diagnostic。
  来源：`Sandbox Failure And Resource Limits Are Explicit`、`Sandbox Availability And Execution Are Observable`
  验证：聚焦测试及模型语义检视确认不含 command、args、output、path 或 task id。

- [x] 2.3 增加 stdout、stderr、恰好上限和超限单 chunk 边界测试，断言运行结果和两个 workspace 文件均满足硬上限。
  来源：`Sandbox Failure And Resource Limits Are Explicit` 三个边界 Scenarios
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts -t "background output"`

## 3. 跨 Function 与整体验证

- [x] 3.1 验证入口拒绝和出口硬限制独立成立；不得把后台资源安全依赖于 Bash 对特定 Python 模式的识别。
  来源：design `跨 Function 协作与端到端流程`
  验证：Bash suite 与直接 gateway background-output suite 均独立 PASS。

- [x] 3.2 完成 root build/test/contract/architecture/OpenSpec strict 和语义审查；如整仓基线存在非本 change 失败，必须单独复现并如实记录。
  来源：AGENTS.md 验证门禁；design `验证策略`
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
  实际结果：root build PASS；新增写盘异常 characterization 与模型/Bash/sandbox 联合套件 174 passed / 4 skipped；contract 387/387、architecture 308/308、OpenSpec 300/300 PASS。最新 root `npm test` 为 2167/2169，2 个既有 Skill trust/payload 基线失败均已在本 change 修改前复现；未宣称整仓全绿。`$nextagent-skill-review` 与 `$nextagent-code-review` 均未发现本 change P0/P1。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，按 design 的“长期基线刷新计划”完成 legacy Requirement 迁移，并归并 `sandbox-runtime`、`command-script-tools`、`FN-6.3`、`FN-5.5`、相关 Feature/module 和 `spec-to-design-map`。
