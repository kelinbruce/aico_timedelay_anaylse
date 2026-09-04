## 1. Directive Parser

- [x] 1.1 新增无副作用 directive parser，只识别 accepted request text 中的 `$skill:<name>` 和 `$workflow:<name>`，并拒绝 unsafe identifier、URL、路径、空白、scope override、provider override 和 shell 元字符。
  验证：新增或更新 parser 单元测试，覆盖 valid skill、valid workflow、`/skill` 不识别、`/workflow` 不识别、unsafe syntax rejected。
  来源：`directive-capability-routing` / Natural Language Capability Directives；design 决策 2、3、4

- [x] 1.2 parser 输出受控结果类型：`none`、`skill(name)`、`workflow(name)`、`invalid(reasonCode)`、`ambiguous(reasonCode)`，且 parser 不访问 catalog、不执行 capability、不写 runtime state。
  验证：parser 单元测试断言输出类型；code review 检查 parser 无 I/O、无 capability import、无 runtime state mutation。
  来源：design 决策 3

- [x] 1.3 实现 directive 冲突检测：同一目标重复可归一化，不同 skill、不同 workflow、skill + workflow 混用必须返回 ambiguous。
  验证：parser 单元测试覆盖 repeated same target、two different skills、two different workflows、skill plus workflow。
  来源：`directive-capability-routing` / Directive Conflict Handling

## 2. Router Mapping

- [x] 2.1 在 `agent-core` router normalization 点接入 `$skill:<name>`，只生成 existing governed target Skill routing input，不设置或覆盖 `routingConstraints.targetRecipe`。
  验证：router mapping / integration test 断言 `$skill:alarm-diagnosis` 进入 target Skill routing，且 `targetRecipe` 为空。
  来源：`directive-capability-routing` / Directive Mapping to Routing Constraints；`targeted-skill-routing` / Skill Directive Produces Target Skill Constraint

- [x] 2.2 在 `agent-core` router normalization 点接入 `$workflow:<name>`，只生成 `routingConstraints.targetRecipe`，不设置或覆盖 target Skill。
  验证：router mapping / integration test 断言 `$workflow:push-gate` 进入 `targetRecipe=push-gate`，且 target Skill 为空。
  来源：`directive-capability-routing` / Directive Mapping to Routing Constraints；`workflow-routing` / Workflow Directive Produces TargetRecipe Constraint

- [x] 2.3 保持 channel 边界不拥有 directive 语义；UI slash command 若生成 trusted routing constraints，只按既有 routing constraints 处理。
  验证：`npm run lint:architecture`；code review 检查 `agent-channel-web` / task channel 没有新增 `$skill:` / `$workflow:` parser ownership。
  来源：design 决策 7；proposal 影响范围

- [x] 2.4 收窄 agent-web submit DTO 和 route forwarding：web request body 不接受 `routingConstraints.targetSkill` / `routingConstraints.targetRecipe`，但仍允许非目标类 routing constraints；目标由用户问题文本解析生成。
  验证：agent-channel-web schema/route tests 覆盖 targetSkill rejected、targetRecipe rejected、非目标 constraints forwarded、`inputText` 中 `$workflow:` 不导致 web layer 添加 targetRecipe。
  来源：`directive-capability-routing` / Agent Web Requests Do Not Carry Target Directives；design 决策 7

- [x] 2.5 同步 `frontend/agent-web` 选中 Skill 提交行为：前端请求体不发送 `routingConstraints.targetSkill` / `routingConstraints.targetRecipe`，而是在提交文本中注入 `$skill:<capabilityId>`。
  验证：`cd frontend/agent-web && npm run test -- --run tests/skillCatalogService.test.ts tests/requestService.test.ts`；`cd frontend/agent-web && npm run build`。frontend requestService tests 覆盖 JSON submit、multipart submit、edit submit 均注入 `$skill:` 且不携带 `routingConstraints`。
  来源：`directive-capability-routing` / Agent Web Requests Do Not Carry Target Directives；proposal 影响范围

## 3. Governance and Negative Cases

- [x] 3.1 将 directive-derived target 纳入 routing constraint allow-list 和 schema/governance 双阶段校验，包含 internal `targetRecipe` allow-list；同时确认 agent-web public schema 禁止直接提交 target fields。
  验证：`npm run test:contract`；contract tests 覆盖 internal `targetSkill`、internal `targetRecipe` 和 forbidden override rejected；agent-channel-web tests 覆盖 public target fields rejected。
  来源：`routing-constraint-validation` / Routing constraints use an allow-list schema

- [x] 3.2 对 ambiguous / invalid directive 实现 fail closed 或 governed clarification，不得进入 model、skill、workflow 或 capability execution。
  验证：router negative tests 实际提交 ambiguous / invalid 输入并断言没有 capability/workflow invocation。
  来源：`directive-capability-routing` / Directive Conflict Handling；Directive Outcomes are Safe and Observable

- [x] 3.3 对 scope、kind、forbidden、availability、budget、deadline、cancellation 失败场景复用既有 governance，禁止跨 Agent、global catalog 或类型重解释 fallback。
  验证：integration tests 覆盖 `$skill:` 指向 workflow-only capability、`$workflow:` 指向 skill-only capability、outside Agent Scope、forbidden capability；断言安全拒绝或声明式降级。
  来源：`directive-capability-routing` / Directive Governance and Scope Isolation；`targeted-skill-routing`；`workflow-routing`

- [x] 3.4 routing outcome evidence 只记录 safe target type、safe target name 和 safe reason code，不记录 unsafe directive 原文、policy internals、私有 catalog facts、路径、credential 或 provider diagnostics。
  验证：observability/routing evidence tests 或 code review 检查点；若无现成 evidence 测试入口，新增最小 characterization test。
  来源：`directive-capability-routing` / Directive Outcomes are Safe and Observable；design 质量属性“审计/可追溯性”

## 4. Architecture Boundary

- [x] 4.1 确认新增代码不引入 private path import，不让 `agent-runtime`、channel、workflow engine 或 capability executor 拥有 directive parser。
  验证：`npm run lint:architecture`；code review 检查新增 imports 和 module ownership。
  来源：design 决策 1、7；AGENTS.md 架构边界

- [x] 4.2 确认 directive parser 和 mapping 没有新增配置开关、持久化表、recipe store、workflow event store、terminal commit 或 stream event 行为。
  验证：code review 检查点；`git diff -- packages openspec` 确认未触达 persistence schema / terminal commit / stream event owner，除非测试 fixture 明确需要。
  来源：proposal 非目标；design 非目标

## 5. Validation

- [x] 5.1 运行变更级 OpenSpec 严格校验。
  验证：`openspec validate add-ts-directive-capability-routing --strict`
  来源：OpenSpec artifact integrity

- [x] 5.2 运行相关工程验证。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：AGENTS.md 验证门禁；design 验证映射

- [x] 5.3 实施完成后检查 task 勾选证据，确保每个 task 均有对应测试、命令结果或明确 code review 检查点。
  验证：code review 检查 `tasks.md` 勾选项旁的验证记录或提交说明；不得只写“测试通过”。
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/directive-capability-routing/spec.md`。
- 同步 `openspec/specs/targeted-skill-routing/spec.md`、`openspec/specs/workflow-routing/spec.md`、`openspec/specs/routing-constraint-validation/spec.md` 中仍成立的 delta。
- 按需更新 `openspec/designs/architecture/agent-routing.md`。
- 按需更新 `openspec/designs/modules/agent-core.md` 和 `openspec/designs/modules/agent-channel-web.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 directive 语法、routing constraints schema、capability scope 校验或执行 owner。
