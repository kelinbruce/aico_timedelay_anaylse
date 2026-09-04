## 1. Python capability truth 收敛

- [x] 1.1 调整 `python-tool`，保留非零 `exit_code` 的结构化结果语义，但将 sandbox timeout 收敛为 `ToolTimedOutResultError`
  验证：`npx vitest run packages/agent-capability/tests/python-capability.test.ts`
  来源：`python-tool` requirement “Python tool returns structured execution result”；design 决策 1、2
- [x] 1.2 调整 `python-tool`，将 sandbox unavailable / deny / safe failure 收敛为 capability `FAILED` 路径，不再返回伪造的 `SUCCEEDED + exit_code=126`
  验证：`npx vitest run packages/agent-capability/tests/python-capability.test.ts`
  来源：`python-tool` requirement “Python tool returns structured execution result”；design 决策 2
- [x] 1.3 增加 negative verification，证明 Python 非零 `exit_code` 仍不会仅因非零退出而变成 capability `FAILED` / `TIMED_OUT`
  验证：`npx vitest run packages/agent-capability/tests/python-capability.test.ts`
  来源：`python-tool` requirement “Python tool returns structured execution result”；design 决策 1

## 2. 统一 failure payload 与 observability

- [x] 2.1 增加或更新 runtime/tool-loop characterization tests，证明 Python sandbox timeout / failure 走既有 `CAPABILITY_RESULT` failure payload、`CAPABILITY_COMPLETED` 和 `DEGRADATION_NOTICE` 路径
  验证：`npx vitest run packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  来源：`python-tool` requirement “Python tool returns structured execution result”；design 决策 3
- [x] 2.2 增加 negative verification，证明该收敛不需要在 `agent-core` 新增 Python 特判，而是继续复用既有 capability result 分支
  验证：code review 检查点：`packages/agent-core/src/tools/tool-loop.ts` 不新增基于 `Python` / `exit_code=126` 的专用分支；必要时运行相关 focused tool-loop tests
  来源：design 决策 3；proposal scope “统一 observability”

## 3. 验证和收尾

- [x] 3.1 运行本 change 的 focused 回归验证，确认 Python capability truth、runtime log 与后续上下文投影一致
  验证：`npx vitest run packages/agent-capability/tests/python-capability.test.ts && npx vitest run packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  来源：design 验证映射；proposal 影响范围
- [x] 3.2 检查 active change 文档与代码 diff 一致，确认没有把 Python 非零退出语义顺带改成 Bash 式 degraded
  验证：`git diff -- openspec/changes/refine-ts-python-bash-capability-failure-unification packages/agent-capability/src/builtins/python/python-tool.ts packages/agent-capability/tests/python-capability.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  来源：design 非目标；proposal scope

## 归档前更新基线检查（非实施任务）

归档前根据 proposal/design 更新：

- 同步 `openspec/specs/python-tool/spec.md`，补充 Python sandbox timeout / safe failure 的 capability truth 对齐规则。
- 如长期导航需要体现 Python failure truth 对齐的设计入口，则更新 `openspec/designs/spec-to-design-map.md`。
