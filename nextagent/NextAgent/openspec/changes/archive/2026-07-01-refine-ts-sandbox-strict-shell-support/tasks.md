## 1. 收敛 gateway 执行语义

- [x] 1.1 调整 `restricted-local-sandbox` 的 Bash 请求分流逻辑，使 `sandbox.enabled=true` 下的 non-denied shell built-in / chaining 也能进入 sandbox execution，而不是因 `unsupported-executable` 预拒绝。
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  来源：`sandbox-runtime` / `Pre-Execution Validation Happens Before Sandbox Submission`；`sandbox-runtime` / `Sandbox Failure And Resource Limits Are Explicit`；design 决策 1、2、3
- [x] 1.2 收敛 deny 行为：`sandbox.enabled=true` 下 deny 命令仍被拒绝，`sandbox.enabled=false` 下跳过 deny 校验，并补充对应的 positive / negative tests。
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  来源：`sandbox-runtime` / `Pre-Execution Validation Happens Before Sandbox Submission`；`sandbox-runtime` / `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`；design 决策 1、3、4
- [x] 1.3 调整 trusted shell/direct execution 的 safe failure mapping，只把 `unsupported-executable` 留给真实 fail-closed 解析失败或 trusted shell 不可用场景。
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`，必要时补充 `npx vitest run tests/agent-kernel/config-assembly.test.ts`
  来源：`sandbox-runtime` / `Sandbox Failure And Resource Limits Are Explicit`；`sandbox-runtime` / `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`；design 决策 4

## 2. 收敛 Bash capability 与产品装配边界

- [x] 2.1 调整 Bash capability 的前置语义：保留 deterministic tokenization 和 malformed quote 拒绝，但不再因 shell composition 在 capability 层直接失败。
  验证：`npx vitest run packages/agent-capability/tests/bash-capability.test.ts`
  来源：`bash-tool` / `Bash Accepts Only Strict Single Commands`；design 决策 2、5
- [x] 2.2 调整 `agent-app` 对 `sandbox.enabled` 和 sandbox rejection 的产品语义装配，使 `enabled=true` 不再代表 direct-only strict shell denial，且 `enabled=false` 明确表示跳过 deny 校验。
  验证：`npx vitest run tests/agent-kernel/config-assembly.test.ts`
  来源：proposal `BREAKING` 范围；design 决策 3、4、5
- [x] 2.3 增加架构/边界检查，证明 Bash 仍只能通过 sandbox dependency 执行，不会因为 shell support 扩大而直接调用 host shell API。
  验证：`npm run lint:architecture`，并做 code review 检查点：Bash handler 未新增 direct host execution 路径
  来源：`bash-tool` / `Bash policy follows frozen local sandbox disable switch`；design 质量属性“安全”“可维护性”

## 3. 黑盒验证和收尾

- [x] 3.1 运行变更相关测试与 OpenSpec 校验，确认 `enabled=true` 下 shell built-in / chaining 成功且 deny negative case 仍失败，`enabled=false` 下跳过 deny 且 OpenSpec 结构有效。
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；`npx vitest run packages/agent-capability/tests/bash-capability.test.ts`；`npx vitest run tests/agent-kernel/config-assembly.test.ts`；`openspec validate refine-ts-sandbox-strict-shell-support --strict`
  来源：design / Verification Map；proposal / 验证入口
- [x] 3.2 清理实现过程引入的临时测试或过时断言，确认工作区只保留该 change 相关修改，且运行时代码与测试断言中不残留旧的 `cd -> unsupported-executable` 语义。
  验证：`git diff --stat`；`rg -n "cd.*unsupported-executable|strict validation still rejects unsupported executable|shell built-ins, chaining, or interpreter modes may be rejected" packages tests`
  来源：proposal / 影响范围；design / 风险与取舍

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，归档前按 proposal/design 的 Baseline Promotion Plan 处理：

- 同步 `openspec/specs/sandbox-runtime/spec.md` 和 `openspec/specs/bash-tool/spec.md` 的稳定行为契约。
- 按需更新 `openspec/designs/modules/agent-app.md` 与 `openspec/designs/modules/agent-capability.md` 的稳定设计描述。
- 如 spec 到 design 的导航发生变化，更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 `sandbox.enabled` 语义、Bash policy owner 或 shell execution 边界。
