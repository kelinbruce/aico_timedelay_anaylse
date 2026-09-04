## 1. 契约和测试入口

- [x] 1.1 新增 runtime skill acquisition 的契约类型和安全 outcome vocabulary，覆盖 `ACQUIRED_REQUIRES_REPLAN`、`NOT_FOUND`、`UNAVAILABLE`、`REJECTED`、`INSTALL_FAILED`、`UNAUTHORIZED` 等结果，并确保结果不携带 endpoint、credential、managed path、staging path、raw package 或 provider-private loading key。
  验证：`npm run build`; `npm run test:contract`; focused contract/schema tests
  来源：spec `Runtime Skill Acquisition MUST Replan Within The Same Run`; design D2
- [x] 1.2 新增 agent loop 黑盒 characterization test fixture：初始 snapshot 无目标 Skill，deterministic model 先调用 `acquire_skill`，下一模型 step 再调用新 Skill。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/runtime-skill-acquisition-loop.test.ts --maxWorkers=1`
  来源：spec Scenario `Missing Skill is acquired and used in the same run`; design 验证映射
- [x] 1.3 新增 model invocation snapshot freeze negative test，证明 acquisition 成功不能修改已经开始的 model invocation toolset，只能影响下一 step。
  验证：`tests/agent-kernel/runtime-skill-acquisition-loop.test.ts` 中断言第一轮 model request 不含 acquired Skill body/hint，下一轮才出现 acquired Skill
  来源：spec `Model Invocation Capability Snapshot MUST Be Frozen`; design D1/D3

## 2. agent-capability acquisition service

- [x] 2.1 在 `agent-capability` 新增 `SkillAcquisitionService`，输入只接受 trusted owner/agent scope、provider id、可选 requested capability id 和安全 query，输出安全 acquisition result。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-acquisition.test.ts --maxWorkers=4`
  来源：design D2
- [x] 2.2 将 `SkillAcquisitionService` 接到现有 SkillHub source sync/install/index/catalog governance 路径，确保 acquisition 与 catalog refresh 共用同一条 managed install 和 index 实现路径。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-acquisition.test.ts packages/agent-capability/tests/skillhub-source.test.ts --maxWorkers=4` 断言 search/fetch/staging/install/index/descriptor/body loading 全链路，并断言 acquired SkillHub Skill 的 `listSkillResources` / `readSkillResource` 由 SkillHub provider 从已发布 installed folder 提供；code review 检查未新增 acquisition-only installer 或第二套 index/resource projection
  来源：spec `SkillHub Source MUST Support Runtime Acquisition Consumption`; design D5
- [x] 2.3 增加 acquisition failure negative tests，覆盖 remote unavailable、scope mismatch、manifest invalid、install failed，并断言安全结果不泄露 provider-private facts。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-acquisition.test.ts --maxWorkers=4`
  来源：spec Scenario `Acquisition failure degrades safely`; design Quality Attributes 安全/可靠性
- [x] 2.4 增加同一 run 内重复 acquisition 的去重或有界重试保护，避免同一 provider/query/skill 在一个 run 中无限重复远端调用。
  验证：focused unit test 断言 fake SkillHub gateway 调用次数受控；`npm run build`
  来源：design 风险与取舍 `[风险] 模型反复 acquire 同一 Skill`
- [x] 2.5 固化 runtime-generated Skill 与 SkillHub managed source 的边界，证明 `skill-creator` 写入 `generated-skills/<skill-name>/SKILL.md` 后通过 runtime-generated local discovery 生效，但不写入 SkillHub managed install/index。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/runtime-generated-skill-activation.test.ts tests/agent-kernel/runtime-skill-acquisition-loop.test.ts --maxWorkers=4`; negative assertion 检查 `remote-skill-content-index.json` 未被写入
  来源：spec `Runtime Generated Skill MUST Activate As Local Execution-Scope Source`; design D6

## 3. agent-core / agent-runtime 主 loop 集成

- [x] 3.1 注册 SkillHub provider-owned acquisition capability `acquire_skill`，使它在允许 SkillHub-backed acquisition 的 Agent 上进入初始 capability snapshot，且不归属通用 builtin toolset。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-acquisition.test.ts tests/agent-kernel/capability-governance.test.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=4`；focused catalog/governance test 断言未授权 Agent 不暴露 acquisition capability，授权 Agent 以 SkillHub provider-owned descriptor 暴露
  来源：design D1; spec `Runtime Skill Acquisition MUST Replan Within The Same Run`
- [x] 3.2 在 `agent-core` tool loop 中识别 acquisition result `ACQUIRED_REQUIRES_REPLAN`，完成当前 capability result append 后进入下一 planning/model round，并重新查询 catalog 构建 snapshot。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=4`；focused tool-loop test 断言 acquisition result 走通用 capability result path，并写入 request-local context patch
  来源：design D3; spec Scenario `Missing Skill is acquired and used in the same run`
- [x] 3.3 复用通用 capability execution evidence 记录 acquisition result，事件只包含 safe provider id、provider kind、safe skill id、outcome code、step/run 关联。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=4`；generic capability timeline assertions；safe serialization assertions
  来源：spec `Runtime Skill Acquisition MUST Be Observable And Recoverable`; design D4
- [x] 3.4 保持 acquisition 结果只通过普通 tool loop 进入后续 planning round，避免新增 terminal/cancel/supersede 专属 snapshot rebuild 分支。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/capability-governance.test.ts --maxWorkers=4`；focused tool-loop test 覆盖 acquisition 不产生专属 snapshot rebuild event
  来源：design 风险与取舍 `[风险] snapshot rebuild 与 terminal commit 竞争`

## 4. 黑盒集成和安全验证

- [x] 4.1 完成同一 request/run 内 acquire 后下一 step 调用新 Skill 的黑盒测试：fake SkillHub 返回远端 Skill，安装写 index 后下一模型 step 看到 descriptor，Skill Tool 成功加载 body 并执行。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/runtime-skill-acquisition-loop.test.ts --maxWorkers=4`
  来源：spec Scenario `Missing Skill is acquired and used in the same run`
- [x] 4.2 完成 active model invocation toolset 不热变更的 negative test，断言新 Skill 不出现在触发 acquisition 的同一次 model request tools 中。
  验证：`tests/agent-kernel/runtime-skill-acquisition-loop.test.ts`
  来源：spec Scenario `Acquisition does not mutate an active model invocation`
- [x] 4.3 完成 resume/replay 安全测试，证明恢复路径只使用已发布 index fact 或重新走 acquisition，不执行 staging folder 或 raw remote response。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/runtime-skill-acquisition-loop.test.ts --maxWorkers=1`；restart 后 remote unavailable/fetch forbidden，仍通过已发布 index 加载 Skill body
  来源：spec Scenario `Resume does not replay unsafe acquisition side effects`
- [x] 4.4 完成日志、stream、timeline、safe error 泄露 negative assertions，覆盖 endpoint、credential、managed install path、staging path、raw package bytes、raw provider response、provider-private loading key。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/runtime-skill-acquisition-loop.test.ts packages/agent-capability/tests/skill-acquisition.test.ts --maxWorkers=4`；timeline/stream/structured log/acquisition failure serialization negative assertions
  来源：spec Scenario `Acquisition emits safe timeline evidence`; design Quality Attributes 安全/审计
- [x] 4.5 完成同一 run 内生成 Skill 后下一 step 直接调用的黑盒测试，证明 generated Skill 不需要 SkillHub 同步即可在当前 execution scope 生效。
  验证：新增或扩展 `tests/agent-kernel/runtime-skill-acquisition-loop.test.ts`，deterministic model 写入 generated Skill 后下一 model step 调用 `Skill(name="<skill-name>")`
  来源：spec Scenario `Generated Skill becomes available in the next step`
- [x] 4.6 完成 generated Skill 不自动同步 SkillHub 的 negative test，断言不调用 SkillHub search/package/publish，不写 `skillhub-managed/remote-skill-content-index.json`。
  验证：agent-kernel fake SkillHub gateway call count assertions；filesystem assertion
  来源：spec Scenario `Generated Skill is not silently synchronized to SkillHub`; design D6

## 5. 架构边界和门禁

- [x] 5.1 增加或更新 architecture/source-level assertions，证明 `agent-runtime` / `agent-core` 不 import SkillHub gateway adapter、managed install implementation、archive parser 或 `agent-platform-gateway-remote` private path；`agent-platform-gateway-remote` 不 import `agent-capability` implementation。
  验证：`npm run lint:architecture`; `tests/architecture/skillhub-source-boundary.test.ts`
  来源：design D2/D4/D5; AGENTS 架构边界
- [x] 5.2 运行 focused gates 覆盖新增能力的 build、unit、contract 和 architecture 检查。
  验证：`npm run build`; `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-acquisition.test.ts tests/agent-kernel/capability-governance.test.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=4`; `npm test`; `npm run test:contract`; `npm run lint:architecture`
  来源：proposal 影响范围; design 验证映射
- [x] 5.3 运行 OpenSpec 严格验证。
  验证：`openspec validate add-ts-runtime-skill-acquisition-loop --strict`; `openspec validate --all --strict`
  来源：OpenSpec 规格优先和归档前一致性要求

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/runtime-skill-acquisition-loop/spec.md`。
- 同步 `openspec/specs/skillhub-source/spec.md` 中 acquisition consumption 的长期行为。
- 同步 runtime-generated local Skill 下一 step 生效且不自动同步 SkillHub 的长期行为。
- 按需更新 `openspec/overview.md`，保留同一 run 内动态 acquisition 的产品目标。
- 新增或更新 `openspec/designs/architecture/runtime-capability-acquisition.md`。
- 更新 `openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-capability.md`。
- 按需新增 ADR 记录“model invocation 内 toolset 不热变更”的长期取舍。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
