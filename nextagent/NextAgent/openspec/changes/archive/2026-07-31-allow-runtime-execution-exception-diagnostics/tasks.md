## 1. 本地执行异常诊断

- [x] 1.1 在 `agent-common` 建立统一 `rawExceptionData` 序列化，并接入 Tool 执行失败和 terminal submit 失败的本地 runtime log。
  验证：`packages/agent-common/tests/runtime-logger.test.ts`、`packages/agent-log/tests/runtime-logger.test.ts`、`tests/agent-kernel/capability-governance.test.ts`、`tests/agent-kernel/runtime-foundation.test.ts`。
  来源：`本地 runtime 执行异常诊断保留受控详细信息`、D1、D2。
- [x] 1.2 对 credential/token/prompt 执行脱敏，保留 sandbox 路径和 URL，并验证 `rawExceptionData` 不进入 SafeError 或用户可见输出。
  验证：`tests/contract/core-contracts.test.ts`、`packages/agent-common/tests/runtime-logger.test.ts`、tool/runtime focused tests。
  来源：`本地执行异常诊断不得扩散到产品输出面`、D2。

## 2. 模型 loop 诊断

- [x] 2.1 在模型首段非空 content 到达时记录 `model.call.first_content`，并输出非负 `firstContentLatencyMs` 而不输出 content。
  验证：`packages/agent-core/tests/agent-routing-core-observability.test.ts`。
  来源：`模型 loop 诊断只记录安全执行元数据`、D3。
- [x] 2.2 在模型调用日志中记录 `toolCount` 和 `toolNames`，并在零 tool call 轮次记录 `tool.loop.no_tool_calls`，不记录工具参数或模型内容。
  验证：`packages/agent-core/tests/agent-routing-core-observability.test.ts`。
  来源：`模型 loop 诊断只记录安全执行元数据`、D3。

## 3. 验证和收尾

- [x] 3.1 运行 change 严格验证、TypeScript 编译和仓库 push 门禁验证。
  验证：`openspec validate allow-runtime-execution-exception-diagnostics --strict`、`npx tsc --noEmit`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  来源：验证映射、push gate。
- [x] 3.2 执行 OpenSpec/架构/安全语义检视，确认本地 runtime diagnostic 不进入统一 observation 或产品输出面。
  验证：`nextagent-code-review` PASS；检查 `runtimeRawExceptionLogFields` 的调用点和 OpenSpec delta。
  来源：`本地执行异常诊断不得扩散到产品输出面`、D1。

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/runtime-execution-exception-diagnostics/spec.md`、`openspec/specs/redaction-policy/spec.md` 和 `openspec/specs/runtime-logging/spec.md`。
- 更新 `openspec/designs/architecture/observability-boundaries.md`、`openspec/designs/modules/agent-common.md`、`openspec/designs/modules/agent-core.md` 和 `openspec/designs/spec-to-design-map.md`。
- 检查长期基线仅将本地 runtime diagnostic 作为受控例外，不重复定义统一 observation redaction。
