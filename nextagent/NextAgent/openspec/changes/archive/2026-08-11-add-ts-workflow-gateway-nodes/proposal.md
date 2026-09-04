## 背景与问题（Why）

`add-ts-workflow-engine-contracts`、`add-ts-workflow-package-composition` 和 `add-ts-workflow-execution-engine` 已经定义并实现了 workflow 的标准 contracts、Recipe YAML 解析口径和 engine 主调度机制，但 `start-event`、`end-event`、`exclusive-gateway` 这组三类基础 gateway 节点还需要独立的行为规格。

缺少这部分 change 时：
- `start-event`、`end-event`、`exclusive-gateway` 的执行语义只能散落在 engine 文档里，难以独立实现和验证
- gateway 节点无 payload 约束、exclusive 条件求值与 fallback 规则没有单独 contract
- 后续业务节点的流程控制语义缺少稳定上游

`parallel-gateway` 已从本 change 范围移出，后续由独立 change 承接；并行 gateway 执行语义由 `add-ts-workflow-parallel-gateway` 独立承接。
gateway 节点的默认分支与 condition 私有字段由本 change owner；`agent-contracts/core` 只保留 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 的 opaque pass-through 结构，不为这些 gateway 私有字段冻结强类型。
外部 recipe DSL 的权威来源是仓内 [docs/Recipe specification.md](/D:/code/NextAgent/docs/Recipe%20specification.md)；本 change 实现必须兼容其中定义的 `start-event`、`end-event`、`exclusive-gateway` 以及 `next.<node>.condition` 结构，不得额外向 DSL 暴露 `default` 等新字段。

## 变更范围（What Changes）

- **新增** `add-ts-workflow-gateway-nodes` change，覆盖以下标准节点：
  - `start-event`
  - `end-event`
  - `exclusive-gateway`
- **明确** [docs/Recipe specification.md](/D:/code/NextAgent/docs/Recipe%20specification.md) 是既定 DSL 规范源；本 change 只实现并消费 DSL，不得调整节点名、字段名、结构语义或默认规则
- **明确** gateway 节点共同约束：
  - 不产生业务 payload，`WorkflowNodeResult.output` 必须为空或 `undefined`
  - 不执行 model / capability / gateway 业务调用
  - 不使用节点级 retry
  - 不单独占用节点级 timeout；只受 recipe 总体预算和中断控制
- **明确** gateway 节点的 DSL 形状必须保持与 Recipe specification 一致：
  - `start-event` / `end-event` 无 `inputs` / `outputs`
  - `exclusive-gateway` 不新增专有顶层 DSL 字段，仅消费既有 `next` 分支声明
  - `condition: ""` 继续表示 true
- **明确** `exclusive-gateway` 的 condition 求值和 fallback 规则：
  - 按 `next` 声明顺序求值
  - 如需“default branch”语义，只能通过最后一个 `condition: ""` 的分支表达，不新增独立 `default` 字段
- **明确** `parallel-gateway` 不在本 change 承接，本地执行实现由 `add-ts-workflow-parallel-gateway` change 承接

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-gateway-nodes`：在 `agent-workflow` 中注册基础 gateway 节点 handler，实现无 payload 的流程控制节点

### 修改的 Capability

无

## 影响范围（Impact）

- `agent-workflow`：新增 `start-event`、`end-event`、`exclusive-gateway` handler，以及 condition evaluator 接线
- `agent-app`：必要时在 recipe 装载边界做受控 normalization，使外部 DSL 精确兼容 `docs/Recipe specification.md`
- `agent-runtime`：无新 owner；仅消费 engine 产出的 event / result
- `agent-model`、`agent-capability`：无依赖
- `agent-observability`：消费 gateway 节点生命周期事件

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-gateway-nodes/spec.md`：新增 / 更新
- `openspec/designs/modules/agent-workflow.md`：补充基础 gateway 节点 owner 和无 payload 约束
- `openspec/designs/architecture/workflow-contracts.md`：补充 `start/end/exclusive` 的行为与条件分支语义
- `openspec/designs/spec-to-design-map.md`：按需补充导航
- `openspec/overview.md`：无
- `openspec/designs/adr/<id>.md`：无

## 验证入口（Validation）

- Integration test：`start-event -> capability node -> end-event` 正常完成
- Integration test：`exclusive-gateway` 命中首个 true 条件；全部 false 时走最后一个 `condition: ""` fallback 分支
- Integration test：`exclusive-gateway` 无命中且未声明 fallback 分支时返回明确失败
- Contract test：gateway 节点的 `WorkflowNodeResult.output` 恒为空
