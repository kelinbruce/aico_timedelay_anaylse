## 1. `FN-2.6 指定技能处理`

- [x] 1.1 新增 directed Skill 成功加载的行为测试，先复现当前缺失 lifecycle facts
  来源：功能行为：`FN-2.6 指定技能处理` + `定向 Skill 加载必须发布 Capability lifecycle facts` + `定向 Skill 成功加载`
  验证：在仓库根目录运行 `npx vitest run packages/agent-core/tests/targeted-skill-routing.test.ts --maxWorkers=1`；新增测试在实现前应失败，并断言缺少 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED`、消息引用或一致身份。

- [x] 1.2 新增 directed Skill 调用前失败的 negative 测试，锁定不伪造执行事实
  来源：功能行为：`FN-2.6 指定技能处理` + `定向 Skill 加载必须发布 Capability lifecycle facts` + `定向 Skill 在调用前不可用`
  验证：在仓库根目录运行 `npx vitest run packages/agent-core/tests/targeted-skill-routing.test.ts --maxWorkers=1`；测试必须实际触发目标不可用或被禁止路径，并断言没有 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 和 Capability Tool-use message。

- [x] 1.3 在 `TargetedSkillRouter` 中实现最小 directed Skill lifecycle 写入顺序
  来源：功能行为：`FN-2.6 指定技能处理` + `定向 Skill 加载必须发布 Capability lifecycle facts` + `定向 Skill 成功加载`、`定向 Skill 降级或最终失败`；白盒：design 的 `FN-2.6 指定技能处理 > 修改方案`
  验证：在仓库根目录运行 `npx vitest run packages/agent-core/tests/targeted-skill-routing.test.ts packages/agent-core/tests/targeted-skill-routing-failure.test.ts --maxWorkers=1`；成功、降级和最终失败均应输出引用持久化 message 的一致 lifecycle events，且 pre-start failure 不输出执行事件。

- [x] 1.4 回归既有 directed Skill 治理、observability、安全和 payload 行为
  来源：白盒：design 的 `FN-2.6 指定技能处理 > 修改方案`
  验证：在仓库根目录运行 `npx vitest run packages/agent-core/tests/targeted-skill-routing.test.ts packages/agent-core/tests/targeted-skill-routing-failure.test.ts packages/agent-core/tests/targeted-skill-routing-observability.test.ts packages/agent-core/tests/targeted-skill-routing-security.test.ts packages/agent-core/tests/targeted-skill-payload-discard-repro.test.ts --maxWorkers=1`；全部通过，且现有 `POLICY_APPLIED`、Skill body 持久化和安全失败语义不变。

## 2. `FN-2.4 查看请求状态`

- [x] 2.1 新增 ProcessDetail 手动 Skill 与嵌套 Skill 的标题和顺序测试
  来源：功能行为：`FN-2.4 查看请求状态` + `ProcessDetail 必须显示定向 Skill lifecycle` + `手动 Skill 与嵌套 Skill 都显示`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/streamValidation.test.ts src/features/chat/process/capabilityProcessTitle.test.ts`；断言同一轮中先显示“加载技能：<手动 SkillA>”，再显示“加载技能：<嵌套 SkillB>”，并复用同一标题模板和状态规则。

- [x] 2.2 新增旧 history 不补造 directed Skill 步骤的 negative 测试
  来源：功能行为：`FN-2.4 查看请求状态` + `ProcessDetail 必须显示定向 Skill lifecycle` + `旧历史不补造步骤`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/processDetailsProjection.test.ts`；输入只包含用户消息 `routingConstraints.targetSkill` metadata 或 `POLICY_APPLIED` 时，断言 ProcessDetail 不生成“加载技能”步骤。

- [x] 2.3 验证前端类型构建和既有 Capability 标题契约
  来源：功能行为：`FN-2.4 查看请求状态` + `ProcessDetail 必须显示定向 Skill lifecycle`；白盒：design 的 `FN-2.4 查看请求状态 > 修改方案`
  验证：在 `frontend/agent-web` 运行 `npm run build`；预期 TypeScript 构建通过，且无新增前端 fallback 标题推导或消息 metadata 读取路径。

## 3. 跨 Function 集成

- [x] 3.1 补充 directed Skill lifecycle 从 canonical timeline 到 run status projection 的 contract 测试
  来源：`FN-2.6 指定技能处理` + `定向 Skill 加载必须发布 Capability lifecycle facts`；`FN-2.4 查看请求状态` + `ProcessDetail 必须显示定向 Skill lifecycle`；白盒：design 的 `跨 Function 协作与端到端流程`
  验证：在仓库根目录运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/run-status-visibility.test.ts --maxWorkers=1`；断言 directed Skill 的 `CAPABILITY_STARTED` / `CAPABILITY_COMPLETED` 按既有 canonical timeline 和 stream/history 投影规则输出，不创建 transport-private 或 frontend-local 竞争事实。

- [x] 3.2 运行既有浏览器用户旅程 gate，验证三宿主 Capability 业务标题不回归
  来源：`FN-2.4 查看请求状态` + `ProcessDetail 必须显示定向 Skill lifecycle`；proposal 影响范围
  验证：在 `frontend/agent-web` 运行 `VITE_PROXY_TARGET=http://127.0.0.1:3000 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e -- tests/e2e/capability-business-language.spec.cjs`；预期 local、immersive、collaborative 三宿主 Capability 标题和资源刷新行为通过。

## 4. Change 整体验证

- [x] 4.1 运行后端 workspace 常规验证门禁
  来源：proposal 影响范围 + design 的 `验证策略`
  验证：在仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；预期全部通过。

- [x] 4.2 运行前端相关验证门禁
  来源：proposal 影响范围 + design 的 `验证策略`
  验证：在 `frontend/agent-web` 运行 `npm run build` 和 `npm test -- tests/processDetailsProjection.test.ts tests/streamValidation.test.ts src/features/chat/process/capabilityProcessTitle.test.ts`；预期全部通过。未运行 `npm run build:vite:modes` 的原因是本 change 不涉及 artifact、宿主模式或静态托管变更。

- [x] 4.3 运行 OpenSpec strict 验证
  来源：proposal 影响范围 + design 的 `验证策略`
  验证：在仓库根目录运行 `npx openspec validate --all --strict`；预期本 change 与全部既有 specs 验证通过。

## 归档前更新基线检查（非实施任务）

- 按设计中的 `长期基线刷新计划`，归档时同步 `targeted-skill-routing`、`ts-run-status-visibility`、FN-2.6、FN-2.4 和 F-2.4 长期文档。
- 检查长期文档没有重复定义 Capability lifecycle schema、ProcessDetail 标题规则或 directed Skill 执行语义。
- 确认没有为旧 history 回填事件，也没有新增前端从 routing metadata 推导过程步骤的路径。
