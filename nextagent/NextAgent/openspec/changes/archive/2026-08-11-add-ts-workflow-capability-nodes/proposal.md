## 背景与问题（Why）

workflow graph 中负责真正触达外部能力的节点还缺少独立 change。尤其是 `tool`、`tool-choice`、`restful`、`python`、`agent` 涉及 capability governance、sandbox、secret、远慢边界和跨 agent 调用，必须单独定义 owner 和失败策略。
capability 节点的 tool / api / script / agent 等 node-specific schema 由本 change owner；`agent-contracts/core` 只透传 opaque `inputs`、`outputs`、`outputParser`，不再冻结 capability 私有字段。

## 变更范围（What Changes）

- **新增** `add-ts-workflow-capability-nodes` change，覆盖：
  - `tool`
  - `tool-choice`
  - `restful`
  - `python`
  - `agent`
- **明确** [Recipe YAML.md](D:/code/ADNClaw-TS/docs/Recipe%20YAML.md) 是既定 DSL 规范源；本 change 只实现并消费 DSL，不得调整节点名、字段名、结构语义或默认规则；具体节点统一命名规范默认采用 `{}-{}`，现存 `tool_choice` 保留兼容解析
- **明确** capability 节点必须通过已有统一边界调用：
  - `tool` / `agent` -> `CapabilityInvocationService`
  - `restful` -> 平台 gateway / API capability boundary
  - `python` -> sandbox gateway
  - `tool-choice` -> `ModelInvocationService` + bounded candidate set
- **明确** secret、sandbox、agent scope 继承和 side effect 安全规则

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-capability-node-handlers`

### 修改的 Capability

- `agent-capability`：作为被 workflow node 消费的统一调用边界
- `agent-runtime`：无新增 owner，仅为 cancel / timeout 提供生命周期信号

## 影响范围（Impact）

- `agent-workflow`：新增 capability 节点 handler
- `agent-capability`：提供 tool / agent 调用 port
- `agent-platform-gateway-*`：提供 REST / sandbox / secret 解析能力
- `agent-model`：仅被 `tool-choice` 作为模型选择器消费

## 职责边界对齐（Boundary Alignment）

- 已完成的 `add-ts-workflow-package-composition` 继续 owner package、startup wiring 和 recipe load；本 change 不新增 recipe 装载、registry 或配置入口
- 已完成的 `add-ts-workflow-routing` 继续 owner `targetRecipe` dispatch，并通过 capability catalog 解析 `WORKFLOW` capability；本 change 不做 recipe 选择后的路由决策，也不创建新的 dispatch path
- 已完成的 `add-ts-workflow-execution-engine` 继续 owner ready 调度、retry、timeout、cancel 和 observer event；本 change 只定义 capability 节点语义，不重写 scheduler
- 已完成的 `add-ts-workflow-gateway-nodes` 继续 owner `start-event`、`end-event`、`exclusive-gateway`；本 change 不承接控制流网关语义
- 与 `add-ts-workflow-knowledge-nodes` 的边界：`api-choice` 属于 knowledge 节点，capability change 只消费其选择结果；不得在本 change 里重新实现候选召回或排序
- 与 `add-ts-workflow-llm-nodes` 的边界：`tool-choice` 只做 bounded tool 选择，不承接通用 prompt assembly 或通用 LLM 转换节点语义
- 与 `add-ts-workflow-interaction-nodes` 的边界：本 change 不 owner pending input、display projection、sub-recipe 或 stream projection

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-tool/spec.md`：补充 workflow `tool` 节点接入方式
- `openspec/specs/sandbox-runtime/spec.md`：补充 workflow `python` 节点的 sandbox owner 约束
- `openspec/designs/architecture/workflow-contracts.md`：补充 capability 节点族 owner 和 side effect 规则

## 验证入口（Validation）

- Integration test：`tool` 节点成功调用已治理 capability
- Integration test：`tool-choice` 从 bounded set 选择 tool，并兼容现存 `tool_choice`
- Integration test：`restful` 节点通过安全配置调用 API
- Integration test：`python` 节点在 sandbox 内执行
- Integration test：`agent` 节点调用子 agent 且不污染父作用域
- Security test：secret 不进入 output / log；sandbox 拒绝越权访问
