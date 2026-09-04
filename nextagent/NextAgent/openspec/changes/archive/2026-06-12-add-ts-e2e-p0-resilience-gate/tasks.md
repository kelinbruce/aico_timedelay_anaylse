## 1. Gate 基础设施

- [x] 1.1 增加 `npm run test:e2e:resilience`、受控 process controller、显式故障点和持久化屏障 helper。
  验证：fixture test 实际断开连接、终止/重启 process，并确认使用相同 persistence root。
  来源：spec requirement “Resilience E2E 使用真实故障和持久化状态”；design D1
- [x] 1.2 增加 sequence、terminal、history 和 side-effect probe 的统一不变量断言。
  验证：注入重复 terminal/side-effect fixture 后 gate 实际失败。
  来源：spec requirement “恢复后保持 canonical 不变量”；design D3
- [x] 1.3 将故障控制限定在 test composition/process controller/fixture，side-effect probe 只服务 e2e-P0-28；不得新增产品入口、产品配置、runtime public API、recovery 状态或 checkpoint contract。
  验证：code review 和 architecture negative assertion 确认产品路径、candidate package 与 public API 不依赖 fault-control 或 side-effect probe。
  来源：design D5

## 2. Resilience E2E 用例

- [x] 2.1 实现 e2e-P0-05：断连后基于 lastSeenSequence 恢复且终态一致。
  验证：`npm run test:e2e:resilience -- --grep e2e-P0-05`。
  来源：spec scenario “Stream 断连后恢复”
- [x] 2.2 实现 e2e-P0-27：process restart 后 queued/executing run 恢复或安全失败。
  验证：`npm run test:e2e:resilience -- --grep e2e-P0-27`。
  来源：spec scenario “Process 重启后恢复”
- [x] 2.3 实现 e2e-P0-28：非幂等 capability 在不确定恢复点不重复执行。
  验证：`npm run test:e2e:resilience -- --grep e2e-P0-28`。
  来源：spec scenario “非幂等副作用不重复”

## 3. Negative Gate 和收尾

- [x] 3.1 增加 architecture negative assertion，证明 test fault-control module 不可从产品 entrypoint 依赖或打包。
  验证：`npm run lint:architecture` 实际对非法 fixture 断言失败。
  来源：spec requirement “Resilience E2E 使用真实故障和持久化状态”；design D5
- [x] 3.2 增加故障点未命中、恢复超时和 process 未清理的 negative fixture。
  验证：resilience gate negative test。
  来源：spec scenario “故障无法可靠触发”；design D4
- [x] 3.3 运行本 change 和仓库门禁。
  验证：`npm run test:e2e:resilience`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-e2e-resilience-gate --strict`。
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/ts-e2e-resilience-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/architecture/request-run.md` 和 `openspec/designs/spec-to-design-map.md`。
