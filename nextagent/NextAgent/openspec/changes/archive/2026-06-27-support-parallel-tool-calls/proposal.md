## 背景与问题（Why）

当前 Agent loop 在同一轮模型响应中接收到多个 tool call 时，会按顺序逐个执行。这个行为简单安全，但会让互不依赖的只读查询、受控文件读取、检索或轻量诊断工具产生不必要的串行延迟。电信网络智能体场景中，一次诊断经常需要并列读取多份上下文、配置片段、告警线索或知识检索结果；这些工具调用在同一模型 round 中已经被模型声明为同批行动，系统应能在不放大权限和不绕过审计边界的前提下并行执行。

现在处理的必要性是：用户已经明确需要 AgenticLoop 支持“返回多个工具调用时的并行工具调用”，并要求补充 e2e 测试。该能力影响 request lifecycle、capability invocation、取消传播、错误聚合和可诊断性，必须先通过 OpenSpec 明确行为契约和边界。

## 变更范围（What Changes）

- Agent core 在一个模型 round 内接收到多个 tool call 时 SHALL 通过受控并行执行器并发调用 capability invocation boundary。
- 每轮 tool call 接收上限仍为现有 `maxToolCalls`，本 change 不提升 `0..5` 的治理上限。
- 并行只改变同一轮多个 tool call 的执行调度；模型 round 顺序、tool result 回填顺序、max tool iterations、routing constraints、capability governance、sandbox gateway boundary、safe error 和 terminal commit 语义保持不变。
- tool result MUST 按模型返回的 tool call 顺序回填给下一轮模型，避免并发完成顺序影响 prompt 语义。
- 任一 tool call 返回 `FAILED` / `TIMED_OUT` safe result 时，SHALL 作为该 tool call 的 safe failed result 回填；同轮其他 tool call 的成功结果仍应保留，除非请求级 `AbortSignal` 已触发。Capability invocation 抛出的异常沿用既有 request failure 语义。
- 请求级取消、超时或 shutdown MUST 传播到同轮所有进行中的工具调用。
- 不新增 public Web API、runtime command、client 配置项、持久化表或新的 capability invocation contract。
- **BREAKING**：无。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-minimal-agent-kernel`: Agent 主路径在同一模型 round 内执行多个 tool call 的调度语义从串行改为受控并行，同时保持 terminal consistency、safe error 和验证门禁。
- `builtin-tool-framework`: Tool 执行框架需要明确多个 Tool capability invocation 可在同一 Agent round 中并行发生，Tool implementation 不得依赖同一 round 内的串行副作用顺序。

## 影响范围（Impact）

- 代码：`packages/agent-core/src/tools/tool-loop.ts` 及其调用方；必要时调整 agent-core/tool-loop tests 和 e2e fixture。
- 测试：补充能够证明同轮多个 tool call 并行启动、结果仍按原始顺序回填、失败不会吞掉其他结果、请求取消会传播到所有并行工具的 unit/contract/e2e 测试。
- 配置：不新增配置；继续使用现有 `maxToolCalls` 和 `maxToolIterations`。
- 安全和审计：不扩大模型可调用工具集合，不绕过 capability resolver/executor/audit/sandbox 边界；日志和 safe error 继续不得泄漏 raw tool arguments/result、路径、credential 或高基数字段。
- 运维：并行执行可能提升单个 request round 的瞬时资源占用；该占用被现有每轮最多 5 个 tool call 限制约束。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：补充 Agent loop 同轮 tool call 受控并行、顺序回填、取消传播和验证要求。
- `openspec/specs/builtin-tool-framework/spec.md`：补充 Tool capability 可并行 invoked，Tool implementation 不得依赖同轮串行副作用顺序。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/request-run.md`：归档前补充同一模型 round 内 tool execution 的并行调度语义和 terminal consistency 边界。
- `openspec/designs/modules/agent-core.md`：归档前补充 agent-core 对并行 tool execution 的职责、非职责和排序约束。
- `openspec/designs/modules/agent-capability.md`：归档前补充 capability invocation boundary 可被同一 round 并行调用但不改变 executor contract。
- `openspec/designs/adr/<id>.md`：无；本 change 不引入长期需要独立 ADR 承载的取舍。
- `openspec/designs/spec-to-design-map.md`：归档前补充 `ts-minimal-agent-kernel` / `builtin-tool-framework` 到上述设计入口的导航。

验证入口：
- `npm test -- --run <parallel-tool-loop related tests>`
- `npm run test:e2e -- --run <parallel-tool-call related e2e>`（若仓库现有 e2e 命令不同，以实际 package script 为准）
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
