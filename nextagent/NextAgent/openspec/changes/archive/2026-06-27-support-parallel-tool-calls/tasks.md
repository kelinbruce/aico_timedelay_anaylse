## 1. Tool loop 实现

- [x] 1.1 在 `agent-core` tool loop 中实现 ordinary tool call 的 prepare -> invoke -> finalize 三阶段，并让同一模型 round 的 ordinary capability invocation 并行启动。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Requirement「同轮工具调用受控并行执行」；design decision 1/4
- [x] 1.2 保留每轮 `maxToolCalls` 上限拒绝语义，超过上限时不得启动任何 capability invocation。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Scenario「每轮工具调用上限不因并行提升」
- [x] 1.3 保留 `AskUserQuestion` 等 pending-input producer 的互斥语义：执行到 pending-input tool call 后立即返回 `PENDING_INPUT`，不得调用后续 tool call。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Scenario「Pending-input 工具保持互斥语义」；既有 `ask-user-question-tool` pending handoff 契约

## 2. Characterization 和单元测试

- [x] 2.1 新增并行启动 characterization test：两个受控 deferred tool call 在第一个未完成时第二个已经进入 invocation。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Scenario「同轮多个工具调用并行启动」
- [x] 2.2 新增顺序回填测试：后完成的第一个 tool call 仍先于先完成的第二个 tool call 写入 model-visible capability result message。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Scenario「工具结果按模型顺序回填」
- [x] 2.3 新增部分失败测试：一个 tool call 返回 safe failed result 时，同批成功 tool call 的 result 仍按原顺序保留。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Scenario「同轮单个工具失败不丢弃其他结果」
- [x] 2.4 新增负向治理测试：risk policy deny、forbidden capability 或超过 `maxToolCalls` 时断言 capability invocation 未启动。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-core/tests/risk-policy-tool-loop.test.ts`
  来源：design decision 2/4；tasks rules negative verification
- [x] 2.5 新增并行日志可诊断性测试：runtime log 包含同轮 batch ordinal/size，并区分 invocation 与 ordered-finalize wait 耗时。
  验证：`vitest run packages/agent-core/tests/parallel-tool-loop.test.ts`
  来源：`ts-minimal-agent-kernel` Scenario「并行工具调用日志可定位到批次内具体调用」

## 3. E2E 覆盖

- [x] 3.1 补充 e2e 覆盖：测试模型在同一 round 返回多个工具调用，系统并行执行并在最终回答前收到全部 tool result。
  验证：`npm run test:e2e:alpha`
  来源：proposal「补充 e2e 测试」；design verification map

## 4. 验证和收尾

- [x] 4.1 运行 OpenSpec 严格校验，确认新增 proposal/spec/design/tasks 均可归档。
  验证：`openspec validate --all --strict`
  来源：OpenSpec 验证门禁
- [x] 4.2 运行相关和全量验证，确认主路径无回归。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：`ts-minimal-agent-kernel` Minimal Kernel Verification；AGENTS.md 验证门禁
- [x] 4.3 清理实现产生的临时 helper、未使用 import、调试日志和文档待确认项。
  验证：`git diff --check`；code review 检查无未使用临时状态
  来源：AGENTS.md 实现质量门禁；design Open Questions

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ts-minimal-agent-kernel/spec.md`。
- 同步 `openspec/specs/builtin-tool-framework/spec.md`。
- 更新 `openspec/designs/architecture/request-run.md` 中的模型 round 内 tool batch execution 流程。
- 更新 `openspec/designs/modules/agent-core.md` 中的 tool loop prepare/invoke/finalize 职责。
- 更新 `openspec/designs/modules/agent-capability.md` 中 capability invocation boundary 可并行调用但 contract 不变的事实。
- 更新 `openspec/designs/spec-to-design-map.md` 的导航和验证入口。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
