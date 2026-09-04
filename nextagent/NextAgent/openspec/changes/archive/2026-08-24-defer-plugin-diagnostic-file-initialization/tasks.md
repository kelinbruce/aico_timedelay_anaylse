## 1. `FN-10.32 管理插件开发诊断产物`

- [x] 1.1 为 `DeveloperDiagnosticArtifactWriter` 增加零记录生命周期与非法/超限记录无文件副作用的失败复现测试；修改后构造、`start()`、`status()`、`flush()`、未写入 `close()` 以及被拒记录均不得创建文件族成员
  来源：`FN-10.32` + `开发诊断记录使用独立的短期产物文件族` + `没有历史成员和接受记录时不创建文件族`；`FN-10.32` + 性能/容量 + `产物写入具有有界容量和生命周期` + design `FN-10.32 管理插件开发诊断产物 / 修改方案`
  验证：先运行 `npx vitest run packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts`，修改前新增黑盒断言必须观察到空文件已创建；实现后同一命令通过且日志目录不含该文件族成员
  验证记录：2026-08-14 修改前运行新增测试，观察到空 `.ndjson` 和 close 后仍返回 `ACCEPTED`；实现后同一命令 10/10 通过，push 前检视进一步将拒绝路径收敛为日志目录黑盒断言

- [x] 1.2 为首次合法记录、并发首次写入和 close 后写入增加边界测试；完成后第一条记录创建文件并写入，两次并发首次 `emit(...)` 只产生一个 active segment，close 后 `emit(...)` 返回 `DROPPED/OUTPUT_UNAVAILABLE` 且不创建文件
  来源：`FN-10.32` + `开发诊断记录使用独立的短期产物文件族` + `第一条合法记录创建文件族`；`FN-10.32` + 性能/容量 + `产物写入具有有界容量和生命周期` + `第一条记录启动文件生命周期`；design `FN-10.32 管理插件开发诊断产物 / 修改方案`
  验证：运行 `npx vitest run packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts`，预期首次写入、并发首次记录单 active segment 和关闭后无文件副作用全部通过
  验证记录：2026-08-14 运行该命令，首次写入、并发首次记录单 active segment、close 后无文件副作用及既有 writer tests 共 10/10 通过

- [x] 1.3 在 `agent-log` 内把 developer diagnostic active destination handle 收敛为首条合法记录触发的共享 lazy promise，并闭合 start/status/flush/close 与初始化失败语义；完成后不修改 `agent-app`、插件 API、配置 schema 或固定 file policy
  来源：design `FN-10.32 管理插件开发诊断产物 / 修改方案`
  验证：运行 `npm run build --workspace @nextagent/agent-log` 和 `npx vitest run packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts`，预期 TypeScript build 及 writer 全部测试通过
  验证记录：2026-08-14 两条命令均退出 0；`agent-log` TypeScript build 通过，writer tests 10/10 通过

- [x] 1.4 验证默认 sink、未知 `developerDiagnostics` 配置拒绝、固定文件策略、过载恢复、destination unavailable、maintenance failure 与幂等关闭均保持目标态
  来源：`FN-10.32` + 安全 + `本地状态只暴露有界安全证据` + `尚未接受记录时状态可用`、`本地开发者查询降级状态`；`FN-10.32` + 安全 + `原始调测内容与主输出面隔离` + `配置尝试控制 artifact 输出`；design `验证策略`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts packages/agent-app/tests/runtime-logging-config.test.ts packages/agent-app/tests/plugin-host-externals.test.ts`，预期全部通过且查询初始状态不调用 handle factory
  验证记录：2026-08-14 使用 release config 运行三份测试文件，3/3 files、55/55 tests 通过；默认 config 会排除 `packages/agent-app/tests/**`，未将其单文件结果误作三文件证据

- [x] 1.5 在 `agent-local-file-roll` 提取并公开无 active destination 的 maintenance handle，由 writer `start()` 启动并在首条合法记录时切换到完整 roll handle；完成后无历史成员不创建文件，既有 closed segment/archive 仍持续执行 reconciliation、压缩、elapsed retention 和 archive count，且同一时刻只有一个 scheduler
  来源：`FN-10.32` + 性能/容量 + `产物写入具有有界容量和生命周期` + `无记录启动时只维护历史成员`；design `FN-10.32 管理插件开发诊断产物 / 修改方案`
  验证：运行 `npx vitest run packages/agent-local-file-roll/tests/local-file-roll.test.ts packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts`，预期 maintenance-only 与 writer lifecycle 测试全部通过
  验证记录：2026-08-14 修改前 3 个新增断言按预期失败；实现后 2 files、32/32 tests 通过，覆盖历史 closed source 压缩且无 active destination、零记录无文件、maintenance/full handle 单 scheduler 切换与并发首次写入

- [x] 1.6 修正 close 后任意 `emit(...)` 的优先失败语义并补非法输入负例；完成后 close 后的合法、非法和超限输入均返回 `DROPPED/OUTPUT_UNAVAILABLE`，且不创建完整 handle
  来源：design `FN-10.32 管理插件开发诊断产物 / 修改方案`
  验证：运行 `npx vitest run packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts`，预期 close 后输入负例全部通过
  验证记录：2026-08-14 修改前 close 后循环 payload 实际返回 `INVALID_RECORD`；修正 closed guard 顺序后 focused writer tests 11/11 通过

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、后端 build、contract 与 architecture 门禁，并确认改动没有新增 public contract、production consumer、配置开关或无关文件
  来源：proposal `影响范围` + design `验证策略`
  验证：运行 `openspec validate defer-plugin-diagnostic-file-initialization --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`git diff --check`；预期全部通过，并以 `git diff --name-only` 人工确认范围仅包含 active change、`agent-log` writer 和直接测试
  验证记录：2026-08-14 change strict 通过；OpenSpec 全量 278/278；`npm run build` 退出 0；unit 167 files/2111 tests；contract 49 files/387 tests；architecture dependency cruise 1663 modules/7459 dependencies 无违规且 50 files/307 tests 通过；`git diff --check` 通过。`git status --short` 仅列出 active change 四个 artifacts、`agent-log` writer 和对应 unit test，无 `agent-contracts`、`agent-app`、`agent-local-file-roll` 或配置改动

- [x] 2.2 重新完成 OpenSpec、受影响 package build/test、contract 与 architecture 门禁，并确认共享 maintenance API 没有扩散到无关 consumer、配置或 `agent-contracts`
  来源：审查修正 + proposal `影响范围` + design `验证策略`
  验证：运行 `openspec validate defer-plugin-diagnostic-file-initialization --strict`、`openspec validate --all --strict`、受影响 focused tests/build、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`git diff --check`
  验证记录：2026-08-14 change strict 与 OpenSpec 全量 278/278 通过；focused release 4 files/77 tests；根 build 退出 0；unit 167 files/2113 tests；contract 49 files/387 tests；architecture dependency cruise 1663 modules/7459 dependencies 无违规且 50 files/307 tests 通过；`git diff --check` 通过。共享 maintenance API 仅由 `agent-log` 新增使用，无 `agent-contracts`、配置或 `agent-app` 变更

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、`FN-10.32`、overview、plugin composition architecture 与 `agent-log` module design；Feature、ADR 和 spec-to-design-map 不变。
