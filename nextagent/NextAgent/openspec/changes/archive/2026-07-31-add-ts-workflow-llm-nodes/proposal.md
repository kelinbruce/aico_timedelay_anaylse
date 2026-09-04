## 背景与问题（Why）

workflow contracts 已收敛到标准 Recipe YAML 结构，但 LLM 节点族还没有独立 change 来定义模型调用边界、prompt assembly 接线、预算检查和安全输出规范。

缺少该 change 时：
- `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract` 的输入输出语义不稳定
- prompt template、model profile、output schema validation 的 owner 边界不清楚
- 预算超限、模型失败、结构化输出不合法时的降级路径没有统一要求

LLM 节点的 prompt template、model selection、output schema 等 node-specific schema 由本 change owner；`agent-contracts/core` 只透传 opaque `inputs`、`outputs`、`outputParser`、`llmDefaults`，不再冻结 LLM 私有字段。

## 变更范围（What Changes）

- **新增** `add-ts-workflow-llm-nodes` change，覆盖以下标准节点：
  - `llm-router`
  - `intent-recognition`
  - `question-rewriting`
  - `translation`
  - `data-analysis`
  - `param-extract`
- **明确** [Recipe YAML.md](D:/code/ADNClaw-TS/docs/Recipe%20YAML.md) 是既定 DSL 规范源；本 change 只实现并消费 DSL，不得调整节点名、字段名、结构语义或默认规则
- **明确** 这些节点全部通过 `ModelInvocationService` 调用模型，不直连 provider SDK
- **明确** prompt template 由 `agent-context-engine` 组装，workflow node 只传 template id、上下文变量和输出约束
- **明确** LLM 输入预算、结构化输出校验、安全落地和失败降级

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-llm-node-handlers`：在 `agent-workflow` 中注册 LLM 节点 handler

### 修改的 Capability

- `context-engine`：作为 prompt shaping 依赖被消费，不新增 owner 责任
- `workflow-execution-engine`：注册新的 node handler，不改变公共 port

## 影响范围（Impact）

- `agent-workflow`：新增 LLM 节点 handler、output validation、budget gate
- `agent-context-engine`：被用于 prompt assembly / compression / template 解析
- `agent-model`：经 `ModelInvocationService` 被调用
- `agent-observability`：消费安全事件，但不接收 raw prompt / raw output

## 职责边界对齐（Boundary Alignment）

- 已完成的 `add-ts-workflow-package-composition` 继续 owner package、startup wiring 和 recipe load；本 change 不新增 recipe registry、source load 或配置入口
- 已完成的 `add-ts-workflow-routing` 继续 owner主请求 dispatch；LLM 节点不决定请求是否进入 workflow
- 已完成的 `add-ts-workflow-execution-engine` 继续 owner节点调度、retry、timeout、cancel 和 observer bridge；本 change 只定义 LLM 节点语义与 safe output
- 已完成的 `add-ts-workflow-gateway-nodes` 继续 owner控制流网关；LLM 节点不承担 graph control semantics
- 与 `add-ts-workflow-knowledge-nodes` 的边界：本 change owner通用模型转换、分类、提取；knowledge change owner检索、evidence-bounded QA 和候选选择
- 与 `add-ts-workflow-capability-nodes` 的边界：本 change 不 owner tool/API/python/agent side effect；`tool-choice` 等特化选择语义仍由 capability family owner
- 与 `add-ts-workflow-interaction-nodes` 的边界：本 change 不 owner pending input、display projection、guardrail、sub-recipe 或用户可见 stream lifecycle

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/designs/modules/agent-workflow.md`：补充 LLM 节点 handler 接线
- `openspec/designs/architecture/workflow-contracts.md`：补充模型预算、安全输出、validation 规则
- `openspec/specs/context-engine/spec.md`：补充 workflow LLM 节点的 prompt assembly 消费方式

## 验证入口（Validation）

- Integration test：`llm-router` 按输出 schema 产出 safe result
- Integration test：`intent-recognition` 返回 `intent` 和 `confidence`
- Integration test：`question-rewriting` 保留关键电信术语
- Integration test：`translation` 完成中英翻译
- Integration test：`data-analysis` 对结构化数据输出分析结果
- Integration test：`param-extract` 对 schema 约束的嵌套参数提取成功
- Security test：`WorkflowNodeResult.output` 不包含 raw prompt / raw model output
