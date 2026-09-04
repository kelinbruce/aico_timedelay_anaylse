## 1. LLM 节点 handler

- [x] 1.1 在 `agent-workflow` 中注册 `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract` handler
  验证：`npm run build`
  来源：design 决策 D1

- [x] 1.1A 明确 LLM node-specific schema owner：prompt template、model profile、output schema 等字段只在本 change 定义；不得要求 `agent-contracts/core` 为其冻结强类型
  验证：code review 检查点通过；cross-artifact 文案一致
  来源：design 决策 D6

- [x] 1.1B 边界对齐：显式固化与 `package-composition`、`workflow-routing`、`execution-engine`、`gateway-nodes`、`knowledge-nodes`、`capability-nodes`、`interaction-nodes` 的职责分工，避免在 LLM change 内重复承接 retrieval / side effect / pending owner
  验证：code review 检查点通过；cross-artifact 文案一致
  来源：design boundary matrix

- [x] 1.2 将 LLM 节点统一接线到 `ModelInvocationService` 和 `agent-context-engine`
  验证：`npm run build`
  来源：spec requirement `Shared LLM Node Execution`

## 2. Prompt 与预算控制

- [x] 2.1 实现 prompt template 解析、context assembly 和 compression 接线
  验证：集成测试 L1、L3
  来源：spec requirement `Shared LLM Node Execution`

- [x] 2.2 实现节点级 budget gate：输入超过阈值时先压缩，再失败或降级
  验证：集成测试 L2
  来源：spec requirement `Shared LLM Node Execution`

## 3. 节点语义实现

- [x] 3.1 实现 `llm-router` 的通用 completion 语义和 output validation
  验证：集成测试 L4
  来源：spec requirement `LLM Router`

- [x] 3.2 实现 `intent-recognition`、`question-rewriting`、`translation`
  验证：集成测试 L5、L6、L7
  来源：spec requirements `Intent Recognition` / `Question Rewriting` / `Translation`

- [x] 3.3 实现 `data-analysis`、`param-extract`
  验证：集成测试 L8、L9
  来源：spec requirements `Data Analysis` / `Param Extract`

## 4. 安全与验证

- [x] 4.1 实现结构化输出 schema validation 和 safe error mapping
  验证：`npm run test:contract`
  来源：spec requirement `Shared LLM Node Execution`

- [x] 4.2 实现 raw prompt / raw model output 排除规则
  验证：security test L10
  来源：spec requirement `Shared LLM Node Execution`

## 5. 验证

- [x] 5.1 集成测试：`intent-recognition` 输出 `intent` 和合法 `confidence`
  验证：`npm run test`
  来源：verification L5

- [x] 5.2 集成测试：`question-rewriting` 保留关键术语；超长输入先压缩
  验证：`npm run test`
  来源：verification L2、L6

- [x] 5.3 集成测试：`translation` / `data-analysis` / `param-extract` 输出合法 safe result
  验证：`npm run test`
  来源：verification L7、L8、L9

- [x] 5.4 Contract test：LLM 节点输出与 schema 一致，`WorkflowNodeResult.output` 不含 raw prompt / raw model output
  验证：`npm run test:contract`
  来源：verification L10

- [x] 5.5 Architecture test：LLM 节点不直连 provider SDK，只能通过 `ModelInvocationService`
  验证：`npm run lint:architecture`
  来源：design boundary

- [x] 5.6 Architecture test：LLM 节点不新增 retrieval、tool/API side effect、pending input 或 display projection owner
  验证：`npm run lint:architecture`
  来源：design boundary matrix
