## 1. `FN-5.9 调用技能`

- [x] 1.1 更新 Skill Tool 目标行为测试：覆盖 Auth、Authorization、Token、Credential、Password、Secret 和 API key 内容成功加载并在 hidden generated context 原样保留，同时把 raw host path 保持为独立 safe-failure negative case；实施前运行目标测试并确认凭据值用例失败。
  来源：`FN-5.9 调用技能` + 系统质量属性“安全、可维护性、可测试性” + Requirement `Skill Content 不实施认证与凭据值检查` + Scenarios `Skill Content 保留认证与凭据内容`、`非凭据内容边界检查保持生效`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`；实施前新增的凭据值正路径失败，实施后全部通过，host path、wrapper breakout 和控制字符用例继续断言失败。
  实际结果：实施前 25 tests 中新增凭据正路径 1 failed、其余 24 passed；实施后 25/25 passed。

- [x] 1.2 收敛 Skill inline body 校验：删除 Authorization/credential value scanner 及仅为该 scanner 服务的 placeholder/normalization 逻辑，保留 host path 与全部既有来源、结构和注入边界；合法 Skill Content 可观察为 `SUCCEEDED` 且正文原样进入 generated message。
  来源：design `FN-5.9 调用技能 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`；全部通过，且 `rg -n "authorizationValuePattern|credentialAssignmentPattern|credentialPlaceholderPattern|normalizeCredentialCandidate" packages/agent-capability/src/builtins/skill-tool.ts` 无匹配。
  实际结果：25/25 tests passed；指定 `rg` 返回无匹配。

- [x] 1.3 将 `/tmp/` 收敛为允许出现在 Skill Content 中的常见业务目录：补充正文原样进入 hidden generated context 的黑盒测试，从 host path pattern 中仅移除 `/tmp/`，并保持其他受保护宿主路径 safe-failure。
  来源：`FN-5.9 调用技能` + Requirement `Skill Content 不实施认证与凭据值检查` + Scenario `Skill Content 保留 /tmp/ 业务目录`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts`；实施前新增 `/tmp/` 正路径失败，实施后全部通过，Windows 绝对路径及 `/home/` negative case 继续失败。
  实际结果：实施前 `/tmp/` 目标用例 1 failed；实施后 Skill Tool 26/26 tests passed，既有 Windows 绝对路径及 `/home/` negative case 继续通过。

## 2. `FN-10.1 注册和执行钩子`

- [x] 2.1 更新终态输出 guard 目标行为测试：IPv4/IPv6 单独出现时保持原文且无 mutation，与 credential-like 内容同时出现时仅后者被脱敏；实施前运行目标测试并确认 IPv4 用例失败。
  来源：`FN-10.1 注册和执行钩子` + 系统质量属性“安全、可测试性” + Requirement `System output redaction guard protects final client-visible content` + Scenarios `业务 IP 内容保持原文`、`IP 与其他受保护内容同时出现`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-coverage-gaps.test.ts`；实施前新增 IPv4 断言失败，实施后全部通过，其他敏感模式与 private-key 用例继续通过。
  实际结果：实施前 IPv4 保留断言失败；实施后以 `-t "system.output-redaction-guard"` 运行 3/3 目标 tests passed；完整 `npm test` 131 files、1237/1237 tests passed。

- [x] 2.2 从 `system.output-redaction-guard` 默认 replacement 集合移除内部 IPv4 pattern，不增加 IP parser、allowlist、配置或旁路；IP-only 内容可观察为无 mutation 的 `PASS`。
  来源：design `FN-10.1 注册和执行钩子 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/lifecycle-hook-coverage-gaps.test.ts`；全部通过，且 `rg -n "INTERNAL_IP|192\\\\\\.168|172\\\\\\." packages/agent-runtime/src/lifecycle/system-output-redaction-guard.ts` 无匹配。
  实际结果：system output redaction guard 目标 tests 3/3 passed；指定 `rg` 返回无匹配。

## 3. Change 整体验证

- [x] 3.1 完成 OpenSpec、后端 build、相关 package、contract 与 architecture 门禁，确认本 change 不修改公共 contract、CLIP structured delta、日志/audit/stream/safe-error credential 保护或 package ownership。
  来源：proposal `影响范围` + design `验证策略（Verification Strategy）`
  验证：`openspec validate refine-reviewed-content-security-policy --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；全部通过。
  实际结果：change strict validation passed；全仓 OpenSpec 279/279 passed；build passed；unit/integration 131 files、1237/1237 tests passed；contract 40 files、339/339 tests passed；architecture 42 files、254/254 tests passed。

- [x] 3.2 针对 `/tmp/` Skill Content 路径放宽重跑后端 build、全量测试、contract、architecture 和全仓 OpenSpec 门禁，确认本次仅改变 Skill inline body 的 `/tmp/` 分类。
  来源：task `1.3` + 系统质量属性“安全、可维护性、可测试性”
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
  实际结果：build passed；unit/integration 131 files、1237/1237 tests passed；contract passed；architecture 42 files、254/254 tests passed；全仓 OpenSpec 279/279 passed。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable specs、Functions、Features 和 module design，并确认长期文档未形成平行内容安全策略。
