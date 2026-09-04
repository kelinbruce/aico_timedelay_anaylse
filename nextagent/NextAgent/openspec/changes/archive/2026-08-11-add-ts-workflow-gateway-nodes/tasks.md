## 1. 节点 handler 与边界

- [x] 1.0 对齐外部 recipe DSL：以 `docs/Recipe specification.md` 为准，补齐 `start-event`、`end-event`、`exclusive-gateway` 的命名/字段兼容，以及必要的私有 normalization；不得新增第二套用户可见 DSL
  验证：`npm run build`
  来源：design 决策 D6、D7

- [x] 1.1 在 `agent-workflow` 中新增 `start-event`、`end-event`、`exclusive-gateway` handler 注册
  验证：`npm run build`
  来源：design 决策 D1

- [x] 1.1A 明确 gateway node-specific schema owner：默认分支与 condition 私有字段只在本 change 定义；不得要求 `agent-contracts/core` 为其冻结强类型
  验证：code review 检查点通过；cross-artifact 文案一致
  来源：design 决策 D5

## 2. Gateway 行为实现

- [x] 2.1 实现 `start-event`：execution 接受后同步激活第一批下游节点，不产生业务 output
  验证：集成测试 G1
  来源：spec requirement `Start Event`

- [x] 2.2 实现 `end-event`：汇总 execution 终态并结束调度，不产生业务 output
  验证：集成测试 G2
  来源：spec requirement `End Event`

- [x] 2.3 实现 `exclusive-gateway` 顺序求值、最后一个 `condition: ""` fallback 分支和无命中失败
  验证：集成测试 G3、G4
  来源：design 决策 D8；spec requirement `Exclusive Gateway`

- [x] 2.4 固化 `exclusive-gateway` condition evaluator 输入边界：仅消费 `contextVariables`，不得直接读取 `nodeResults.output`
  验证：集成测试 G3、G4；code review 检查点通过
  来源：design 决策 D4；spec requirement `Exclusive Gateway`

## 3. 失败与可观察性

- [x] 3.1 为 gateway 节点输出 lifecycle event 和 safe diagnostic event，确保不包含业务 payload
  验证：`npm run test:contract`
  来源：spec requirement `Gateway Node Shared Constraints`

- [x] 3.1A 固化 safe diagnostic 最小字段集：`nodeId`、`nodeType`、`reasonCode`，并在条件场景输出 `selectedBranchId`、`conditionIndex`
  验证：`npm run test:contract`
  来源：design 决策 D6；spec requirement `Gateway Node Shared Constraints`

## 4. 验证

- [x] 4.1 集成测试：`start-event -> capability node -> end-event` 正常完成
  验证：`npm run test`
  来源：verification G1

- [x] 4.2 集成测试：`exclusive-gateway` 命中首个 true 分支、命中最后一个 `condition: ""` fallback 分支、无命中失败
  验证：`npm run test`
  来源：verification G3、G4

- [x] 4.3 Contract test：gateway 节点 `WorkflowNodeResult.output` 恒为空；事件不含敏感 payload
  验证：`npm run test:contract`
  来源：verification G5

- [x] 4.4 Architecture test：gateway handler 仅依赖 `agent-workflow` / `agent-contracts` / `agent-common`
  验证：`npm run lint:architecture`
  来源：design boundary

## 说明

`parallel-gateway` 已从本 change 移出，并由 `add-ts-workflow-parallel-gateway` 独立承接首版本地执行实现；本 change 不提供 parallel handler。
