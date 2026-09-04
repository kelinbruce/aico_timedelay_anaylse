## 背景和现状（Context）

capability 节点是 workflow 中最直接产生副作用的一组节点。它们必须遵守 capability governance、sandbox、安全 secret 注入、owner scope 和 agent scope 不变式，否则 workflow graph 很容易越权或产生不可恢复 side effect。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 统一 capability 节点的 owner boundary 和调用路径
- 在不调整 Recipe YAML DSL 的前提下，统一 `tool` / `restful` / `python` / `agent` / `tool-choice` 的输入输出语义；标准命名默认采用 `{}-{}`，现存 `tool_choice` 仅作兼容 alias
- 明确 side effect、secret、安全审计和失败重试策略

**非目标：**
- 不引入第二套 capability 调用路径
- 不支持 GraphQL / gRPC / WebSocket
- 不支持远端 agent 调用
- 不 owner recipe 路由、execution 调度、pending input 或知识检索

## 设计决策（Decisions）

1. `tool`、`agent` 统一走 `CapabilityInvocationService`
2. `python` 只能走 sandbox gateway，不得直连宿主进程
3. `restful` 对齐标准 Recipe YAML `api_name` 等输入，不允许 workflow 节点直接持有明文 secret
4. `tool-choice` 只做选择，不执行 side effect；现存 `tool_choice` 仅作兼容 token 解析到该标准类型
5. capability 节点 output 只落地 safe result，不落地 raw secret / raw stderr 大块内容
6. tool / restful / python / agent / tool-choice 的 node-specific schema 由本 change 定义；`agent-contracts/core` 不为这些字段冻结强类型
7. `tool` 节点（DSL `type: "tool"`）首版暂不实现（deferred）：当前无 recipe 使用该节点类型，engine 不注册 `TOOL` handler，recipe loader 不识别 `type: "tool"`。后续需要时经独立 OpenSpec change 启用。
9. `restful` batch 执行：`batchMode: "parallel"` 使用 worker pool 直接控制元素级并发度，`batchParallelism` 是唯一的并发控制参数。早期实现用两级批处理（`chunkArray` + group-level `Promise.all`），但当 `items.length <= batchSize`（默认 10）时只有一个 batch，`batchParallelism` 完全失效。worker pool 在每次取下一个元素前检查 abort 标志，已启动的元素允许完成，未启动的跳过。`batchSize` 在 parallel 模式下不参与执行控制；在 serial 模式下仅影响分组结构，不影响串行语义。

10. CLIP `bodyRequired=true && parameters.length===0` 时 `inputSchema` 放宽为 `{ type:"object", additionalProperties:true }`。`clipc describe` 对 `search_feature` 等工具返回 `body_required=true, params=[]`，执行层 `buildClipExecutionArgs` 已通过 `request.arguments['body'] ?? request.arguments` 兼容无 body 包裹的顶层参数传入，inputSchema 必须与 executor fallback 对齐，否则 `GovernedCapabilityInvocationPort` 的 input validation 会以 `CAPABILITY_INPUT_INVALID` 拒绝合法调用。`bodyRequired=true && parameters.length>0` 分支保持 `required:["body"]` + 声明参数不变。
11. CLIP `clipc execute` 命令格式从 `--request '{"params":{...},"body":{...}}'` envelope 改为 `-b '{...}'` 直传 body。远程部署的 `clipc` 版本不支持 `--request` envelope，返回 `invalid_request_body`。`-b` 直接将 JSON 作为 HTTP 请求体发送，与 API 期望格式一致。`parameters.length>0` 时追加 `--params` 传路径/查询/头参数；保留 `declaredSystemHeaders` 过滤逻辑，只转发 CLIP descriptor 声明的可信 trace header。


12. 流式 frame 解析容错原则：emitClipOutputFrame 和 emitBashOutputFrame 对 parseClipOutputFrame 调用加 try-catch。流式 stdout chunk 可能包含不完整 JSON 或非 JSON 内容（如 ANSI escape、调试信息），解析失败时记 debug 日志后跳过该 frame，不中断执行。最终结果由非流式的 parseClipExecutionOutput(stdout) 在执行完成后处理，流式 delta 只是 best-effort 增量投影，单 frame 解析失败不代表最终输出无效。仓库中已有 safeParseClipOutputFrame（silent 吞异常返回 undefined），但流式路径需要保留诊断日志（clip.streaming.frame_parse_error / bash.streaming.frame_parse_error）以排查 clipc 输出格式问题。

## 跨 Change 边界矩阵（Cross-Change Boundary Matrix）

- `package-composition`：负责 recipe file load、startup wiring、registry 注入；capability 节点只消费已注册 recipe / 已装配 service
- `workflow-routing`：负责请求进入 workflow 的 dispatch；capability 节点不决定请求是否进入 workflow，也不写回新的 routing constraint
- `workflow-execution-engine`：负责 ready 队列、retry、timeout、cancel、observer；capability 节点只提供单节点语义与 safe result
- `workflow-gateway-nodes`：负责 `start-event`、`end-event`、`exclusive-gateway` 控制流；capability 节点不负责 graph control semantics
- `workflow-knowledge-nodes`：负责 `api-choice` / `recipe-choice` 等候选召回与选择；本 change 只执行已选中的 tool / API / child agent
- `workflow-llm-nodes`：负责通用模型调用、prompt assembly、output schema 校验；本 change 仅允许 `tool-choice` 以 bounded candidate selector 方式消费模型能力
- `workflow-interaction-nodes`：负责 pending input、display、guardrail、delay、interrupt、sub-recipe；本 change 不得自建 pending store 或用户可见 stream owner

## 触发机制（Trigger）

- 当 capability 节点 ready 时，由 engine 触发
- 节点启动是同步调度；外部能力调用是异步等待
- 受 request timeout、node timeout、retry 和 cancel 控制

## 输入与前置条件（Inputs / Preconditions）

- 节点 `inputs`
- 当前 execution `contextVariables`
- 已注册且 `AVAILABLE` 的 capability / API / target agent
- 可信 owner scope、agent scope、`AbortSignal`

## 输出与副作用（Outputs / Side Effects）

- 产出 safe `WorkflowNodeResult.output`
- 产出 capability invocation diagnostic / sandbox diagnostic / secret injection diagnostic
- 可能产生真实外部 side effect，必须可追溯到 execution / node / retry 级安全键

## 核心判断逻辑（Core Decision Logic）

1. 校验 capability 或 API 引用是否存在并处于允许状态
2. 基于 `inputs` 和 `contextVariables` 解析参数
3. 对 secret / script / child agent 做安全检查
4. 调用对应 service / gateway
5. 将返回结果映射为 safe output

## 状态 / 产物契约（State / Artifact Contract）

- `WorkflowNodeResult.output`：保留 safe 结果、必要的 invocation summary 和可追溯键
- `capability diagnostic`：记录 capability id / api name / agent name、节点级安全可追溯键、状态摘要；供 observability / audit 消费
- `secret injection diagnostic`：只记录 secret reference 解析是否成功，不记录 secret 明文

## 流程接入（Flow Integration）

- 上游：gateway、llm、knowledge 节点输出
- 下游：knowledge / interaction / gateway 节点消费 capability result
- 消费方：runtime / observability / audit / recovery

## 失败与降级（Failure / Degradation）

- capability unavailable -> 明确失败，不得隐式切到其他 capability
- secret reference 解析失败 -> 明确失败
- sandbox timeout / denial -> 返回 safe error
- child agent 失败 -> 仅影响当前节点，不改变父 execution 的 agent scope

## 验收样例（Acceptance Examples）

- 正常路径：`tool` 成功返回结构化结果
- 边界路径：`tool-choice` 只选择、不执行 tool；现存 `tool_choice` 可被兼容解析
- 失败路径：`python` 访问越权资源被 sandbox 拒绝
- 安全路径：`restful` header 中的 secret 通过引用注入，但 output / log 中不出现明文

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.4-执行能力节点` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-capability-nodes/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**`workflow-capability-nodes` 存在同名 Requirement，且 delta 的批执行 Requirement 缺失、共享/Tool/RESTful Requirement 与 stable 正文不同。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
