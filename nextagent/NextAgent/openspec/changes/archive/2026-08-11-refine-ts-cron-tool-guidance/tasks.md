## 1. 模型可见契约

- [x] 1.1 优化 Cron Tool 总描述，覆盖 action 选择、调度形态、窗口拆分和生命周期限制。
  验证：metadata tests 断言关键规则存在且不出现“最多只能生成 5 个任务”的错误语义。
  来源：Requirement: Cron Tool 调用指导；design 决策 1、5、6。
- [x] 1.2 为 Cron 输入 schema 各字段增加通俗 description，不改变合法输入集合或默认执行行为。
  验证：schema description assertions；既有 schema negative tests。
  来源：Requirement: Cron Tool 调用指导；design 决策 2、3、4、7。
- [x] 1.3 补充间隔任务单次下发优先，以及调度时间与数据时间的意图边界。
  验证：metadata tests 分别断言单 create、调度正例和数据时间反例。
  来源：Requirement: Cron Tool 调用指导；design 决策 8、9。
- [x] 1.4 增加 provider-compatible 顶层参数披露，并明确 finite multi-fire window 与 `recurring=false` 的边界。
  验证：metadata tests 断言顶层 properties；既有 action-aware invalid cases 继续失败；描述断言 one-shot 仅首次匹配。
  来源：Provider 从顶层发现 Cron 参数、一次性 cron 只执行第一次匹配；design 决策 10、11。
- [x] 1.5 明确单个未来日历时刻默认 `recurring=false`，只有显式重复语义才创建周期任务。
  验证：metadata tests 断言 one-shot 正例、周期反例和 recurring 字段规则。
  来源：单个未来时刻默认一次性、明确重复词才创建周期任务；design 决策 12。
- [x] 1.6 修复 Cron list 对 `recurring=false` 的条件省略，确保列表结果显式返回生命周期事实。
  验证：Cron unit test 创建 one-shot 后 list 并断言 `recurring=false`；output schema 要求 jobs recurring。
  来源：List 保留 false 生命周期事实。
- [x] 1.7 明确 Cron prompt 只移除调度时间并保持用户任务语义，不得发散增加约束。
  验证：prompt schema description assertions 覆盖语义保真、禁止扩写和数据时间保留。
  来源：Prompt 保持原任务语义、Prompt 保留数据时间；design 决策 13。
- [x] 1.8 为目标日期内的常见间隔窗口增加确定性快速映射，默认终点不包含并优先单任务。
  验证：metadata tests 断言 `[start,end)`、`recurring=true`、单 create 和明确终点例外。
  来源：日期有限窗口快速映射、用户明确要求包含窗口终点；design 决策 14。

## 2. 一致性验证

- [x] 2.1 增加代表性 cron 表达式测试，覆盖通配符步长、范围步长、窗口端点和不支持语法。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/cron-tools.test.ts`。
  来源：描述与解析器一致 scenario；design 决策 4、5。
- [x] 2.2 运行 OpenSpec strict validation并完成 `nextagent-skill-review` 语义审查。
  验证：OpenSpec validator 通过；审查结论 PASS。
  来源：AGENTS 规格优先与验证门禁。
  结果：`nextagent-skill-review` 审查 PASS，需群内确认：None；`npx --yes @fission-ai/openspec@latest validate --all --strict` 通过（249 items）。
