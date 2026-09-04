# refine-ts-tool-loop-repeat-failure-guard

## Why

当 Skill 加载后继续通过 Bash/Python 等工具执行脚本时，工具失败会作为 `CAPABILITY_RESULT` 暴露给模型。当前 runtime/core 依赖模型自行吸收失败经验；如果模型重复发出同一工具、同一参数、同一失败结果，run 只能依靠 `maxToolIterations` 才停止，用户看到的是重复执行-失败的 loop。

## What Changes

- 在 Agent Core tool loop 内增加 request-local 重复失败保护。
- 对同一 run 内相同 capability、相同参数、相同 failure status/safeError、相同结构化失败输出的非终止型失败，第三次出现时终止当前 run。
- 第三次失败仍先按既有路径写入 `CAPABILITY_RESULT` 和 timeline，再发出 `DEGRADATION_NOTICE`，确保模型/用户可见最后一次失败证据。
- 不改变 Bash 非零退出第一次降级可见、可由模型修正的既有语义。

## Impact

- Affected package: `agent-core`
- Tests: `tests/agent-kernel/tool-loop.test.ts`
- No public Web API, gateway schema, persistence shape, or stream event type change.
