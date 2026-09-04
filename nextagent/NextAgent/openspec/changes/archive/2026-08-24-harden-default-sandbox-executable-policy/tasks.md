## 1. `FN-6.3 沙箱执行命令`

- [x] 1.1 更新默认配置行为测试，使其断言 `sandbox.enabled=true`、allowlist 按顺序精确等于 `clipc`、`curl`、`python`、denylist 按 spec 顺序精确等于穷尽集合且两表无共同成员，并先在旧默认配置上确认测试失败。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + `仓库默认配置启用校验并使用最小 executable 白名单`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/configuration-composition.test.ts tests/agent-kernel/config-assembly.test.ts tests/contract/memory-configuration-contracts.test.ts tests/contract/gateway-configuration-contracts.test.ts`；修改实现前目标断言必须失败，修改后全部通过。
  完成证据：修改实现前，`tests/agent-kernel/config-assembly.test.ts:175` 以 `expected false to be true` 失败；修改后 release 配置收集的 74 个测试全部通过，contract 配置在整体验证中覆盖 `tests/contract/**`。

- [x] 1.2 更新仓库内置默认 sandbox 配置：启用校验，把 allowlist 收敛为 `clipc`、`curl`、`python`，并写入 spec 冻结的精确 denylist；保持既有 schema、composition 和 gateway enforcement 路径不变。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + `仓库默认配置启用校验并使用最小 executable 白名单`；design `FN-6.3 沙箱执行命令 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/configuration-composition.test.ts tests/agent-kernel/config-assembly.test.ts tests/contract/memory-configuration-contracts.test.ts tests/contract/gateway-configuration-contracts.test.ts`；预期默认配置为 `READY` 且目标断言全部成立。
  完成证据：同一聚焦命令完成 74/74；`npm run test:contract` 完成 387/387，默认配置加载、精确 allowlist、精确 denylist 与无交集断言通过。

- [x] 1.3 验证默认 executable policy 的禁止路径实际 fail closed：名单外 executable、denylist 成员和 shell composition 均不得启动进程，拒绝结果保持规范化安全错误。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + `默认白名单拒绝其他 executable`、`白名单模式拒绝 shell composition`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-capability/tests/bash-capability.test.ts`；预期 allowlist、denylist 优先、名单外拒绝和 shell composition 拒绝用例全部通过。
  完成证据：3 个测试文件共 90 个测试通过、4 个跳过。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、构建、contract 和 architecture 门禁，并确认仅有目标 change、默认配置和相关测试进入本次改动范围。
  验证记录（2026-08-24）：`npm run build`、`npm test`（172 files / 2242 tests）、`npm run test:contract`（50 files / 388 tests）、`npm run lint:architecture`（54 files / 321 tests）全部通过；`openspec validate --all --strict` 通过；本次改动范围仅含目标 change 的 spec/design/tasks 与归档基线文档。
  来源：proposal `影响范围` + design `验证策略`
  验证：运行 `openspec validate harden-default-sandbox-executable-policy --strict`、`npm run build`、`npm run test:contract`、`npm run lint:architecture`、`git diff --check`；预期全部通过，并人工核对 `git diff --name-only` 不包含既有 `.gitignore` 用户修改。
  当前证据：change strict 通过；全仓 OpenSpec strict 266/266；根测试 2103/2103；contract 387/387；architecture 307/307 且 dependency-cruiser 无违规；`git diff --check` 通过。`npm run build` 仍被本 change 未修改的 `packages/agent-workflow/tests/recipe-numeric-version.test.ts:24` 既有 TS2554 阻塞，因此本任务保持未完成。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 `sandbox-runtime`、`FN-6.3`、`F-6.3`、配置/模块设计和 `spec-to-design-map`，并删除长期文档中已不成立的默认 disabled、denylist-only 和两成员名单说明。
