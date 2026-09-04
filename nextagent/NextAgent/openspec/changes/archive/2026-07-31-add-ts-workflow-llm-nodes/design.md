## 背景和现状（Context）

LLM 节点族是 workflow graph 中最容易越过安全边界和预算边界的一组节点。当前系统已有 `ModelInvocationService`、context assembly 和 model safe error mapping，但 workflow 节点如何消费这些能力尚未独立定稿。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 统一 LLM 节点通过 `ModelInvocationService` 调用模型
- 统一 prompt template、context assembly、output validation 入口
- 统一 budget check、超限压缩、失败降级和 safe output 规则

**非目标：**
- 不提供流式 Web 投影
- 不支持多轮对话式节点内部循环
- 不在 workflow 节点里引入 provider 专属参数模型
- 不 owner知识检索、候选选择、外部 capability side effect 或 pending input lifecycle

## 设计决策（Decisions）

1. 节点配置保持 Recipe YAML DSL 原样语义；runtime 如需内部映射也不得反向修改 DSL 命名
2. LLM 节点只依赖 `ModelInvocationService` 和 `agent-context-engine`
3. 节点落地结果必须经过输出 schema 或预定义 shape 校验
4. raw prompt、raw model output 不写入 `WorkflowNodeResult.output`
5. 预算超限优先尝试 compression；仍超限再失败或按 `onError` 降级
6. prompt template、model profile、output schema 等 LLM node-specific schema 由本 change 定义；`agent-contracts/core` 不为这些字段冻结强类型

## 跨 Change 边界矩阵（Cross-Change Boundary Matrix）

- `package-composition`：负责 service wiring 和 recipe load；LLM 节点只消费已装配的 `ModelInvocationService` 与 `agent-context-engine`
- `workflow-routing`：负责主请求 dispatch；LLM 节点不产生新的 workflow 入口或 registry owner
- `workflow-execution-engine`：负责调度、retry、timeout、cancel、observer visible delta；LLM 节点只定义单节点的模型语义与验证
- `workflow-gateway-nodes`：负责 graph control semantics；LLM 节点不承担 branch / join / start / end 语义
- `workflow-knowledge-nodes`：负责 retrieval、source refs、`api-choice` / `recipe-choice`；LLM family 不重复实现这些知识节点
- `workflow-capability-nodes`：负责外部 tool / API / python / child agent 调用；LLM family 不直接执行 side effect
- `workflow-interaction-nodes`：负责 pending input、display、guardrail、delay、interrupt、sub-recipe；LLM family 不 owner用户交互生命周期

## 触发机制（Trigger）

- 当 execution 调度到 LLM 节点且前置节点完成时触发
- 位于 workflow execution 阶段，属于同步节点启动 + 异步等待模型结果的组合
- 受 request lifecycle budget、recipe timeout 和 external cancel 共同约束

## 输入与前置条件（Inputs / Preconditions）

- 当前节点 `inputs`、可选 `outputSchema`、recipe / node model profile
- 当前 execution `contextVariables`
- `agent-context-engine` 可用的 prompt template / context assembly 配置
- 可信 `AbortSignal`

## 输出与副作用（Outputs / Side Effects）

- 产出 safe `WorkflowNodeResult.output`
- 产出模型调用生命周期事件、budget diagnostic、validation diagnostic
- 不直接写 stream / audit；只通过 engine event 暴露

## 核心判断逻辑（Core Decision Logic）

1. 根据节点类型构造 prompt intent 和输出约束
2. 调用 `agent-context-engine` 完成 prompt assembly / compression
3. 检查输入是否超出模型预算阈值
4. 通过 `ModelInvocationService` 发起调用
5. 对返回结果执行结构化解析与 schema validation
6. 合法结果写入 safe output；非法结果走 `retryPolicy` / `onError`

## 状态 / 产物契约（State / Artifact Contract）

- `WorkflowNodeResult.output`：只保留 safe 结构化结果
- `budget diagnostic`：记录 compression 是否发生、预算是否超限；生命周期与 execution 相同
- `validation diagnostic`：记录 schema 失败摘要；只供 observability / debugging 消费

## 流程接入（Flow Integration）

- 上游：任意 gateway / knowledge / capability 节点输出
- 下游：`exclusive-gateway`、`tool`、`restful`、`display-content` 等消费 safe output
- 消费方：`agent-observability` 消费安全事件；runtime recovery 只消费 snapshot 中的 safe output

## 失败与降级（Failure / Degradation）

- 模型超时 / cancel：节点响应 `AbortSignal`，不得静默继续
- prompt 超预算：先尝试 compression，失败后返回明确 budget 错误
- 结构化输出不合法：走 retry / onError，不得把非法 JSON 直接传下游
- template 缺失 / model profile 缺失：明确失败，不得隐式回退到默认 provider

## 验收样例（Acceptance Examples）

- 正常路径：`param-extract` 提取合法 JSON，schema 校验通过
- 边界路径：`question-rewriting` 输入过长，compression 后仍保持关键术语
- 失败路径：`intent-recognition` 返回非法 confidence，validation 拒绝并触发 retry / fail
- 安全路径：`translation` 节点结果可见，但 raw prompt / raw output 不进入 snapshot

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-9.7-执行模型节点` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/workflow-llm-nodes/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
