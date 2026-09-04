## 背景与问题（Why）

interaction 节点族负责 workflow 与用户、护栏、延迟、中断和子流程之间的交互，是 execution / recovery / pending input 最容易交叉的部分。当前缺少专门 change 来约束它们如何复用 runtime pending input、stream projection 和 sub-recipe 调用。
interaction 节点的 pending input、guardrail、display projection、sub-recipe mapping 等 node-specific schema 由本 change owner；`agent-contracts/core` 只透传 opaque `inputs`、`outputs`、`outputParser`，不再冻结 interaction 私有字段。

## 变更范围（What Changes）

- **新增** `add-ts-workflow-interaction-nodes` change，覆盖：
  - `user-check`
  - `display-content`
  - `guardrail-check`
  - `delay-gateway`
  - `interrupt-gateway`
  - `sub-recipe`
- **明确** [Recipe YAML.md](D:/code/ADNClaw-TS/docs/Recipe%20YAML.md) 是既定 DSL 规范源；本 change 只实现并消费 DSL，不得调整节点名、字段名、结构语义或默认规则；内部标准节点命名默认采用 `{}-{}`，现存 DSL token `guardrail_check` 保留兼容解析到标准 `guardrail-check`
- **明确** pending input、stream projection、guardrail hook、delay、external resume 和 sub-recipe 嵌套深度规则
- **明确** `sub-recipe` 在 DSL 中继续使用 `recipe_name` 和显式 input / output mapping；如内部 contract 存在字段映射，也仅是实现细节

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-interaction-node-handlers`

### 修改的 Capability

- `agent-runtime`：继续拥有 pending input、cancel、checkpoint、terminal commit，不把 owner 下放给 workflow
- `agent-channel-web`：仅负责把 `display-content` 投影给客户端，不拥有 execution lifecycle

## 影响范围（Impact）

- `agent-workflow`：新增 interaction 节点 handler
- `agent-runtime`：提供 pending input / resume / cancel 边界
- `agent-channel-web`：消费 `display-content` 的安全投影

## 职责边界对齐（Boundary Alignment）

- 已完成的 `add-ts-workflow-package-composition` 继续 owner package、startup wiring 和 recipe load；本 change 不新增 recipe source、load path 或 registry owner
- 已完成的 `add-ts-workflow-routing` 继续 owner `targetRecipe` dispatch；`sub-recipe` 只消费已注册 recipe，不新增新的主请求路由入口
- 已完成的 `add-ts-workflow-execution-engine` 继续 owner ready 调度、waiting / resume 后的继续执行、retry、timeout、cancel；本 change 只定义 interaction 节点触发等待或投影的语义
- 已完成的 `add-ts-workflow-gateway-nodes` 继续 owner基础控制流网关；`delay-gateway`、`interrupt-gateway` 在本 change 中是交互等待语义，不扩展 `exclusive-gateway` / `start-event` / `end-event`
- 与 `add-ts-workflow-knowledge-nodes` 的边界：`recipe-choice` 负责选择 `recipe_name`，`sub-recipe` 只消费该结果执行子流程
- 与 `add-ts-workflow-llm-nodes` 的边界：`display-content`、`guardrail-check` 不 owner通用模型转换语义；如需模型调用，必须通过既有边界消费结果
- 与 `add-ts-workflow-capability-nodes` 的边界：interaction 节点不 owner外部 tool/API/python/agent side effect 路径

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/human-pending-input-core/spec.md`：补充 workflow `user-check` / `interrupt-gateway` 消费方式
- `openspec/specs/ts-stream-history-consistency/spec.md`：补充 `display-content` 投影约束
- `openspec/designs/architecture/workflow-contracts.md`：补充 interaction node 的 lifecycle 接线

## 验证入口（Validation）

- Integration test：`user-check` pause -> user answer -> resume
- Integration test：`display-content` 安全投影到客户端
- Integration test：`guardrail-check` 阻断违规内容；现存 `guardrail_check` 也会被兼容解析
- Integration test：`delay-gateway` 等待指定时长后继续
- Integration test：`interrupt-gateway` 等待外部 resume
- Integration test：`sub-recipe` 嵌套执行并通过显式 mapping 传递输入输出
