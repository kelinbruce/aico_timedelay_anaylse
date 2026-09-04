## 背景与问题（Why）

电信网络任务执行失败时，现有 runtime 日志只有安全错误摘要，无法还原工具执行、terminal submit 或模型 loop 的实际失败上下文。运行环境已确认执行异常数据不含敏感信息，且沙箱路径是隔离执行路径；因此本地 `RuntimeLogger` 诊断输出需要保留受控的 raw exception，配置的 operational runtime log 文件必须包含该诊断，支撑故障定位。

当前稳定 redaction 基线没有定义这一本地执行诊断例外，导致实现与规格不一致，也无法明确其不得进入 Web、stream、SafeError、audit、metric 或 trace 的边界。

## 变更范围（What Changes）

- 为本地 `RuntimeLogger` 定义执行异常诊断例外：工具执行失败和 terminal submit 失败可以记录结构化 `rawExceptionData`，包括异常名称、消息、stack、cause 和受控异常对象字段；配置的 operational runtime log 文件必须包含该事件。
- 保持凭据类字段和 token 文本脱敏；`prompt` 字段仍脱敏。执行 sandbox 路径和 URL 可在 `rawExceptionData` 中保留，以支持定位。
- 明确 `rawExceptionData` 仅属于本地 runtime 诊断，不得投影到 Web/SSE/WebSocket、SafeError、timeline、audit、metric 或 trace。
- 为模型调用增加首段内容到达延迟，以及本轮可用工具数量和名称；为无 tool call 的 loop 轮次增加结构化 runtime 诊断。以上日志不得包含模型内容或工具参数。

## Capability 影响（Capabilities）

### 新增 Capability
- `runtime-execution-exception-diagnostics`: 定义本地 runtime 执行异常详细诊断和模型 loop 安全诊断的边界。

### 修改的 Capability
- `redaction-policy`: 为本地 runtime 执行异常诊断增加受控例外，并保持其他观测消费者的严格 redaction。
- `runtime-logging`: 定义本地 runtime 执行异常详细日志的字段范围和隔离边界。

## 影响范围（Impact）

- 主要 owner：`agent-log` 拥有 operational runtime log 文件的受控字段投影；`agent-common`、`agent-core` 和 `agent-runtime` 仅分别提供统一序列化、Tool/model loop 和 terminal submit 的最小接入。
- 代码：`agent-common` 异常诊断序列化、`agent-core` 工具和模型 loop 日志、`agent-runtime` terminal submit 日志、`agent-log` 受控异常字段投影。
- 运维：配置的 operational runtime log 文件可提供异常根因、首段内容延迟、工具可用性和无工具调用轮次的定位线索。
- 安全：受控例外只适用于已确认的执行异常；凭据/token/prompt 仍脱敏，且不得扩散到客户端或统一 observability 投影链。
- 测试：覆盖 runtime log 文件、工具失败、terminal submit、模型首段内容和 loop 无工具调用行为。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/runtime-execution-exception-diagnostics/spec.md`：新增本地执行异常诊断行为契约。
- `openspec/specs/redaction-policy/spec.md`：修改，记录本地 runtime 执行异常诊断例外。
- `openspec/specs/runtime-logging/spec.md`：修改，记录本地 runtime 执行异常诊断例外。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/observability-boundaries.md`：更新本地 runtime 诊断例外及其消费者边界。
- `openspec/designs/modules/agent-common.md`：更新异常诊断序列化职责。
- `openspec/designs/modules/agent-core.md`：更新 model loop 诊断落点。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加新 capability 导航。

验证入口：
- `packages/agent-common/tests/runtime-logger.test.ts`
- `packages/agent-log/tests/runtime-logger.test.ts`
- `tests/agent-kernel/capability-governance.test.ts`
- `tests/agent-kernel/runtime-foundation.test.ts`
- `packages/agent-core/tests/agent-routing-core-observability.test.ts`
- `npx tsc --noEmit`
