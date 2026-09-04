## 背景与问题（Why）

workflow service 和 recipe capability 就位后，还需要在 agent routing 内决定什么时候走 workflow，什么时候继续走现有 conversation loop。

本 change 只解决 workflow routing 问题，不解决 recipe 存储、timeline 映射或 event durable store。

## 变更范围（What Changes）

- **复用** capability catalog 中的 `WORKFLOW` capability 可用性判断，不新增独立 recipe registry
- **新增** trusted request-carried `routingConstraints.targetRecipe?: string`
- **新增** workflow routing 路径：
  - 显式 `targetRecipe` 命中当前 Agent Scope 的 `WORKFLOW` capability -> workflow
  - 未命中 -> conversation loop
- **可选新增** 轻量 intent match，但只产出 routing decision，不引入新的持久化事实
- **修正** boot-recipe 自动进入逻辑不存在：当前 workflow routing 仅支持显式指定（`routingConstraints.targetRecipe`、capability directive `$workflow:<name>` 或 routing policy rule），由 routing policy 确认是否走 workflow 分支。`RecipeDefinition.type === "boot-recipe"` 不触发自动进入。

## 不在范围内（Explicit Non-Goals）

- 不做 recipe 数据库存储
- 不做 workflow event table
- 不改写 timeline / terminal commit contract
- 不让 workflow routing 拥有 workflow execution history

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-routing`

### 修改的 Capability

- `agent-core` routing path 增加 workflow 分支

## 影响范围（Impact）

- `agent-core`
- `agent-contracts/runtime`
- `agent-channel-web`

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-routing-core/spec.md` 或对应 workflow routing spec

设计视图：
- `openspec/designs/modules/agent-core.md`
- `openspec/designs/architecture/ts-backend-architecture.md`
