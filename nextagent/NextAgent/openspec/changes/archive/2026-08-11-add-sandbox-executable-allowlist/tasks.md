## 1. `FN-6.3 沙箱执行命令`

- [x] 1.1 为 restricted local sandbox 建立 allowlist 目标行为测试，覆盖白名单命中、未命中、显式空数组、denylist 冲突优先、字段缺失兼容和 disabled 跳过；修改实现前确认新增测试失败。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + “未配置白名单时保持黑名单行为”“白名单允许已授权 executable”“白名单拒绝未授权 executable”“显式空白名单拒绝全部 executable”“黑名单在名单冲突时优先”“关闭校验时跳过两种名单”
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；实现前新增 allowlist tests 必须失败且既有 denylist tests 通过。
  实际结果：实现前 exit code 1；新增“非白名单拒绝”和“空白名单拒绝”均因收到 `safeError: undefined` 失败，既有 denylist 命中/跳过/非命中测试通过。

- [x] 1.2 在可信配置、public gateway contract、composition 和 Bash config metadata 中加入 optional `allowedExecutables`，并保持字段缺失与显式空数组的差异。
  来源：design `FN-6.3 沙箱执行命令 / 修改方案` 第 1–2 项。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/configuration-composition.test.ts -t "sandbox executable allowlist"` 和 `npx vitest run --config vitest.config.contract.ts tests/contract/gateway-configuration-contracts.test.ts -t "explicit executable allowlist"`；字段缺失保留 `undefined`，显式空数组和配置值完整投影，schema 负例被拒绝。
  实际结果：两条命令 exit code 0，分别 2/2 与 1/1 目标测试通过；重复项和空字符串被 schema 拒绝。

- [x] 1.3 在 restricted local sandbox policy owner 中实现 allowlist 与 denylist 联合判定，复用既有安全拒绝映射且不改变执行路径控制。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` 全部 Scenarios；design `FN-6.3 沙箱执行命令 / 修改方案` 决策表。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts -t "allowlist|denylist priority|allows non-denied|invalid commands"`、`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/configuration-composition.test.ts -t "sandbox executable allowlist"` 和 `npm run typecheck`；全部名单分支、配置投影和跨 package contract 编译通过。
  实际结果：三条命令 exit code 0；adapter 7/7、配置 2/2 目标测试通过，workspace TypeScript typecheck 通过。push 前语义检视发现 allowlist 未命中产生的 `denied-executable` 尚未投影为 `COMMAND_NOT_ALLOWED`；新增 capability 黑盒测试先以实际 `SANDBOX_UNAVAILABLE` 红测失败，修复既有映射后与 shell composition 用例合计 2/2 通过。

- [x] 1.4 为白名单 direct-only 边界建立负例测试：允许的首个 executable 携带 shell composition 时必须拒绝且不启动子命令，`>` 等不触发 shell 的文本必须保持普通 argv 且不产生重定向副作用；实现前确认 shell composition 用例失败。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + “白名单模式拒绝 shell composition”“白名单模式不解释普通 argv 中的 shell-like 文本”。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts -t "allowlist direct-only"`；实现前 shell composition 用例必须失败，argv/redirection characterization 必须通过。
  实际结果：实现前 exit code 1；shell composition 用例因收到 `safeError: undefined` 失败，`>` 保持 literal argv 且未创建重定向文件的 characterization 通过。

- [x] 1.5 在 restricted local sandbox 中仅对已启用的 allowlist mode 拒绝 trusted shell path，并将 `shell-composition-not-allowed` 映射为既有 `COMMAND_NOT_ALLOWED`；未配置 allowlist 与 `sandbox.enabled=false` 保持原行为。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + “白名单模式拒绝 shell composition”“关闭校验时跳过两种名单”；design `FN-6.3 沙箱执行命令 / 修改方案` 决策表。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts -t "allowlist direct-only|trusted shell"`、`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/sandbox-execution-port.test.ts -t "shell composition"` 和 `npm run typecheck`；目标测试与类型检查全部通过。
  实际结果：三条命令 exit code 0；adapter 3/3、capability safe-error mapping 1/1 目标测试通过，workspace TypeScript typecheck 通过。

- [x] 1.6 将仓库内置默认配置调整为 `sandbox.enabled=false`，同时保留 `curl` 与 `clipc` 名单，并通过配置加载测试确认默认配置为 `READY`、`sandbox.enabled` 为 `false` 且 `sandbox.allowedExecutables` 精确等于 `["curl", "clipc"]`。
  来源：`FN-6.3` + `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` + “仓库默认配置关闭名单校验并保留 curl 与 clipc 名单”。
  验证：`npx vitest run --config vitest.config.contract.ts tests/contract/memory-configuration-contracts.test.ts -t "repository default-system"`；修改默认 enabled 前新增断言必须失败，修改后目标测试通过。
  实际结果：先修复同一默认 YAML 中阻塞配置加载的既有 `local-workflow` 缩进错误。初始 `curl` 默认断言先以 `undefined` 红测失败后转绿；按目标将断言调整为 `["curl", "clipc"]` 后再次以实际值 `["curl"]` 红测失败，加入 `clipc` 后目标配置加载测试通过。后续按最新目标增加 `sandbox.enabled=false` 断言，先以实际值 `true` 红测失败；修改默认配置后目标测试 1/1 通过。`clipc` trusted locator 相关 adapter 测试 6/6 通过，`official local entrypoint` contract 也由既有配置阻塞恢复为 1/1 通过。

## 2. Change 整体验证

- [ ] 2.1 验证 TypeScript 构建、后端测试、contract、architecture 和 OpenSpec 严格门禁，确认没有新增 private import、平行 policy owner 或最小内核回归。
  来源：proposal 影响范围 + design `验证策略（Verification Strategy）`。
  验证：依次运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-sandbox-executable-allowlist --strict`、`openspec validate --all --strict`；全部命令 exit code 为 0。
  实际结果：`npm run build`、`npm run lint:architecture`、两条 OpenSpec validate 均 exit code 0；NetAgent external dependency guard 9/9、allowlist adapter 16/16、配置 2/2、gateway contract 1/1、capability safe-error mapping 2/2、默认配置加载 1/1 目标测试通过。`npm test` 因既有 `per-call-skill-trust.test.ts` payload expectation 1 项失败（1806/1807 通过）；修复默认 YAML 缩进后，`npm run test:contract` 保留 2 项既有 expectation 失败：默认 gateway 缺少 `local-api-call` 期望和 workflow requestHeaders 期望。全量运行中另一次临时目录清理出现 `ENOTEMPTY`，对应测试隔离复跑 1/1 通过。全量门禁仍非全绿，因此本 task 保持未勾选。

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、Function、Feature、overview、architecture、modules 和 spec-to-design-map；ADR 无变化。
