## 1. Bash 结果分类修正

- [x] 1.1 将 Bash 对非零 exit code 的映射改为 `DEGRADED` 结构化结果，保留现有 stdout/stderr/exitCode/truncation payload shape。
  验证：`npm test -- --run packages/agent-capability/tests/bash-capability.test.ts`
  来源：`bash-tool` Capability modified requirement；design 决策 1、2
- [x] 1.2 保持 timeout、platform unsupported、sandbox unavailable、response invalid、output overflow 等执行边界失败继续返回 failed/timed-out outcome，不因本次变更被误降级。
  验证：`npm test -- --run packages/agent-capability/tests/bash-capability.test.ts`
  来源：`bash-tool` Capability modified requirement；design 决策 2

## 2. Tool Loop 行为验证

- [x] 2.1 增加 characterization test，断言 Bash 非零 exit code 进入 `DEGRADED` 路径后会发出 degradation notice，并把结果继续提供给后续模型步骤。
  验证：`npm test -- --run tests/agent-kernel/tool-loop.test.ts`
  来源：`bash-tool` Capability modified requirement；design 决策 3
- [x] 2.2 增加 negative verification，断言真正的 capability failed/timed-out outcome 仍然终止当前 run，不因 Bash 行为修正放宽为继续执行。
  验证：`npm test -- --run tests/agent-kernel/tool-loop.test.ts packages/agent-capability/tests/bash-capability.test.ts`
  来源：`bash-tool` Capability modified requirement；design 风险与取舍

## 3. 规格与收尾验证

- [x] 3.1 更新 active change 文档与实现对齐，并通过 OpenSpec 校验。
  验证：`openspec validate --all --strict`
  来源：proposal 范围；design 验证映射

## 归档前更新基线检查（非实施任务）

归档前根据 proposal/design 更新：

- 同步 `openspec/specs/bash-tool/spec.md` 的稳定行为；
- 如 archive 评审确认需要保留结果分类设计事实，再更新 `openspec/designs/modules/agent-capability.md`；
- 如上项发生，再同步 `openspec/designs/spec-to-design-map.md`。
