## 1. `FN-2.4 查看请求状态`

- [x] 1.1 为 Web stream 安全技术名称投影建立失败测试：覆盖 `Skill.name`、`Agent.agentId`、`ApiCall.apiName` 正向投影，以及重复匹配、普通 Tool 同名参数、非法名称和非白名单参数不可见；实施前确认目标断言失败
  来源：`FN-2.4` + `Capability 生命周期可显示受限技术目标名称` + `Skill 显示实际技术名称`、`普通 Tool 生命周期下的 ApiCall 显示 API 名称`；`FN-2.4` + 系统质量属性“安全” + `技术目标名称不得扩大结果披露边界` + `非白名单参数不随名称输出`、`非法名称被局部省略`、`普通工具不能借同名参数获得目标名称`
  验证：在仓库根目录运行 `npx vitest run packages/agent-channel-common/tests/process-message-projection.test.ts`；修改生产代码前，新增正向断言必须失败，负向基线保持通过
  验证记录：2026-08-05 使用 Node 22.22.2 运行该命令，新增 4 个正向断言按预期失败，既有及首批新增负向测试 17 个通过；代码审查后补充重复 `(toolCallId, toolName)` 关联场景，该 negative case 在门禁收紧前按预期失败

- [x] 1.2 将 `agent-channel-common` 的 Message 关联门禁收紧为恰好一个匹配，并在门禁后投影 optional `capabilityTargetName`，仅允许三个 wrapper/字段映射；完成后合法名称进入启动 payload，重复、缺失或非法名称安全降级
  来源：`FN-2.4` + `Capability 生命周期可显示受限技术目标名称` + `Skill 显示实际技术名称`、`普通 Tool 生命周期下的 ApiCall 显示 API 名称`；`FN-2.4` + 系统质量属性“安全” + `技术目标名称不得扩大结果披露边界` + `非白名单参数不随名称输出`、`非法名称被局部省略`、`普通工具不能借同名参数获得目标名称`；design `FN-2.4 查看请求状态 / 修改方案`
  验证：在仓库根目录运行 `npx vitest run packages/agent-channel-common/tests/process-message-projection.test.ts`；全部通过，且测试明确断言 payload 不含非白名单字段和值
  验证记录：2026-08-05 使用 Node 22.22.2 运行该命令；门禁收紧后 22 个测试全部通过，重复匹配输出 `contentUnavailable` 且不含任一目标名称

- [x] 1.3 为 Agent Web 过程标题建立失败测试：覆盖 wrapper 与技术名称组合、同一 `toolCallId` 从启动到完成保留名称、completion-only 回退及非法字段回退；实施前确认目标断言失败
  来源：`FN-2.4` + `Capability 生命周期可显示受限技术目标名称` + `Agent 名称在完成事件中保留`、`completion-only 路径安全降级`；`FN-2.4` + 系统质量属性“安全” + `技术目标名称不得扩大结果披露边界` + `非法名称被局部省略`
  验证：在 `frontend/agent-web` 运行 `npx vitest run tests/processDetailsProjection.test.ts`；修改生产代码前，新增名称组合和保留断言必须失败，既有 wrapper 回退断言保持通过
  验证记录：2026-08-05 使用 Node 22.22.2 运行该命令，首批新增 5 个目标断言按预期失败，其余 64 个测试通过；补充普通 Tool 伪造合法名称的 negative case 后，该断言也按预期失败

- [x] 1.4 在 Agent Web 复用单一防御 reader 与标题 helper，并按 `toolCallId` 保留合法技术名称；完成后 live、history 与三宿主共享的过程投影显示相同标题且不新增请求
  来源：`FN-2.4` + `Capability 生命周期可显示受限技术目标名称` + `Skill 显示实际技术名称`、`Agent 名称在完成事件中保留`、`普通 Tool 生命周期下的 ApiCall 显示 API 名称`、`completion-only 路径安全降级`；design `FN-2.4 查看请求状态 / 修改方案`
  验证：在 `frontend/agent-web` 运行 `npx vitest run tests/processDetailsProjection.test.ts` 和 `npm run build`；全部通过且 TypeScript 构建无错误
  验证记录：2026-08-05 使用 Node 22.22.2 运行相关 Vitest，70 个测试全部通过；运行 `npm run build`，TypeScript 构建通过

- [x] 1.5 验证技术名称与结果显示级别相互独立，`Bash`、`Read` 的既有安全详情及无 projector 的 `STATUS_ONLY` 降级保持不变
  来源：`FN-2.4` + 系统质量属性“安全” + `技术目标名称不得扩大结果披露边界` + `结果显示级别不改变名称和安全上限`；design `FN-2.4 查看请求状态 / 验证策略`
  验证：在仓库根目录运行 `npx vitest run packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts packages/agent-channel-common/tests/process-message-projection.test.ts`；在 `frontend/agent-web` 运行 `npx vitest run tests/processDetailsProjection.test.ts`；全部通过
  验证记录：2026-08-05 使用 Node 22.22.2 运行后端两个测试文件，112 个测试全部通过；名称正向测试直接覆盖 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 三档策略；运行前端投影测试，70 个测试全部通过

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、受影响后端与前端门禁，确认没有 Gateway、Runtime persistence、Message schema、生产默认配置或宿主分叉
  来源：proposal `影响范围`；design `验证策略（Verification Strategy）`
  验证：运行 `openspec validate expose-safe-capability-technical-name --strict`、仓库根目录相关 Vitest、`frontend/agent-web` 的相关 Vitest 与 `npm run build`；模型语义审查检查改动 diff，所有命令通过且审查无 P0/P1
  验证记录：2026-08-05 目标 change strict validation 通过；后端 112 个、前端 70 个 focused tests 通过；`agent-channel-common` 与 Agent Web TypeScript build 通过；architecture 45 个文件、280 个测试通过；`git diff --check` 通过；修复重复关联问题后模型语义复审为 PASS、无 P0–P3。仓库全量门禁另有当前 diff 未触达的既有失败：`fix-skill-projection-diagnostics` OpenSpec、Skill resource test 类型漂移、ModelInferenceOptions snapshot 漂移，以及沙箱 `listen EPERM`/相关超时

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec、Function、Feature、stream projection architecture、`agent-channel-web`/`agent-web` module 文档和 spec-to-design-map；检查长期文档没有重复定义公共字段、安全 owner 或结果展示策略。
