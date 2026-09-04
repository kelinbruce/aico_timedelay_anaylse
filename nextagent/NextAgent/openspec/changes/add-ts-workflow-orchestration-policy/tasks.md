## 0. Implementation Preconditions

- [ ] 0.1 在实现前确定 model-generated TS workflow source 的最大源码大小、编译超时和执行超时，并写入 spec/design 或拆出独立 change。
  验证：OpenSpec review 检查点：`design.md` 待确认问题已关闭或转为独立 deferred change。
  来源：design / `待确认问题`
- [ ] 0.2 在实现前确定 YAML DSL 中 `loop`、`exception`、`sub-recipe` 的首版支持范围，并为不支持节点添加 validation failure 行为。
  验证：OpenSpec review 检查点：支持矩阵已进入 active spec/design；`npm test -- --run workflow-yaml-compiler`
  来源：design / `待确认问题`
- [ ] 0.3 在实现前确定 loop-to-workflow learning 的“多次成功”和“路径稳定”判定阈值，并写入 trusted learning policy 规格或拆出独立 change。
  验证：OpenSpec review 检查点：learning policy 阈值已明确，或已创建 deferred change。
  来源：design / `待确认问题`

## 1. Routing Policy

- [ ] 1.1 扩展 Agent routing decision contract，增加 workflow/model-loop mode selection 所需的受控 decision shape，不新增 runtime-owned routing state。
  验证：`npm run test:contract -- --run agent-routing-core`
  来源：`agent-routing-core` / `Agent routing selects workflow or model loop mode`；design decision 1
- [ ] 1.2 实现按当前 `agentId` 解析 workflow target 的 registry dispatch，禁止跨 Agent Scope 同名 workflow 命中。
  验证：`npm test -- --run workflow-routing`
  来源：`agent-routing-core` / `Routing selects a registered workflow`；design decision 2
- [ ] 1.3 实现 trusted ordered routing rules，使规则可显式选择 workflow 或 model loop，并按声明顺序首个命中生效。
  验证：`npm test -- --run workflow-routing-policy`
  来源：`workflow-orchestration-policy` / `Developer Governed Workflow Routing Policy`
- [ ] 1.4 实现 complete routing policy SPI 的受控输入和输出 validation。
  验证：`npm run test:contract -- --run workflow-routing-policy`
  来源：`agent-routing-core` / `Complete routing policy implementation is controlled`；design decision 3, 4
- [ ] 1.5 为 invalid policy output、unregistered workflow target、malformed fallback 和 cancellation late result 添加 negative tests。
  验证：`npm test -- --run workflow-routing-policy-negative`
  来源：`agent-routing-core` / `Policy implementation attempts unsupported decision`；`Policy implementation is canceled`

## 2. Workflow Source Pipeline

- [ ] 2.1 明确并实现 model-planned workflow candidate 的输入边界，使模型输出只能进入 candidate validation，不得直接触发节点执行。
  验证：`npm run test:contract -- --run model-planned-workflow`
  来源：`workflow-orchestration-policy` / `Model Planned Workflow Candidate`；design decision 5
- [ ] 2.2 为 TS workflow source compilation 接入 sandbox gateway boundary，host 只接收 canonical workflow output 和 safe diagnostics。
  验证：`npm test -- --run workflow-sandbox-compiler`
  来源：`workflow-orchestration-policy` / `TS workflow source is governed before execution`；design decision 9
- [ ] 2.3 为动态 TS workflow source 直接 host import/eval 添加 architecture negative test。
  验证：`npm run lint:architecture`
  来源：`workflow-orchestration-policy` / `Dynamic workflow code uses sandbox boundary`
- [ ] 2.4 实现 YAML DSL parser/compiler，将预定义 YAML workflow 编译为 canonical TS workflow representation。
  验证：`npm test -- --run workflow-yaml-compiler`
  来源：`workflow-orchestration-policy` / `YAML workflow compiles to canonical workflow`；design decision 7
- [ ] 2.5 为 YAML 与 TS 生成相同 canonical graph 的 fixture 添加等价执行测试。
  验证：`npm test -- --run workflow-canonical-execution`
  来源：`workflow-orchestration-policy` / `Canonical execution does not expose source format differences`

## 2A. Loop-To-Workflow Learning

- [ ] 2A.1 为 model loop 成功执行轨迹生成 safe trajectory summary，确保学习输入不包含 raw prompt、raw model output、raw capability payload、secret、credential、local path 或 attachment content。
  验证：`npm test -- --run workflow-learning-trajectory`
  来源：`workflow-orchestration-policy` / `Learning input is safe`；design decision 6
- [ ] 2A.2 实现 trusted learning policy，将多次成功且路径稳定的 model loop 轨迹总结为 learned workflow candidate，不直接注册为可执行 workflow。
  验证：`npm test -- --run workflow-learning-candidate`
  来源：`workflow-orchestration-policy` / `Repeated deterministic loop path produces a workflow candidate`；design decision 6
- [ ] 2A.3 将 learned workflow candidate 接入与 model-planned workflow 相同的 governance、validation、sandbox compilation、DAG validation 和 publication 流程。
  验证：`npm test -- --run workflow-learning-publication`
  来源：`workflow-orchestration-policy` / `Learned candidate is not executable before publication`
- [ ] 2A.4 为未发布 learned candidate 添加 negative tests，断言 Agent routing 不会选择且 workflow engine 不会执行任何节点。
  验证：`npm test -- --run workflow-learning-negative`
  来源：`workflow-orchestration-policy` / `Learned candidate is not executable before publication`
- [ ] 2A.5 为已发布 learned workflow 添加路由集成测试，断言后续相似请求可从 model loop 改走 workflow。
  验证：`npm test -- --run workflow-learning-routing`
  来源：`workflow-orchestration-policy` / `Published learned workflow improves future routing`；`agent-routing-core` / `Routing selects a published learned workflow`

## 3. DAG Validation And Optimization

- [ ] 3.1 实现 DAG validator，覆盖唯一 start node、missing target、unreachable required node、forbidden cycle 和 unsafe branch condition。
  验证：`npm test -- --run workflow-dag-validator`
  来源：`workflow-orchestration-policy` / `Workflow DAG Validation And Optimization`
- [ ] 3.2 实现保守 DAG optimizer，输出拓扑 levels、side-effect barrier 和 parallelizable group 标记。
  验证：`npm test -- --run workflow-dag-optimizer`
  来源：design decision 8；`Optimizer preserves side-effect order`
- [ ] 3.3 为 side-effecting node 顺序保持添加 characterization tests，断言 optimizer 不重排模型调用、capability 调用、gateway 调用、用户交互、sandbox 执行和 sub-workflow invocation。
  验证：`npm test -- --run workflow-dag-side-effect-order`
  来源：`workflow-orchestration-policy` / `Optimizer preserves side-effect order`
- [ ] 3.4 为 DAG validation failure 添加执行前拒绝测试，断言任何 node handler 未被调用。
  验证：`npm test -- --run workflow-dag-negative`
  来源：`workflow-orchestration-policy` / `Invalid DAG is rejected before execution`

## 4. Scope, Fallback And Observability

- [ ] 4.1 实现 workflow source、policy output 和 model candidate 中 `agentId` / owner 字段的忽略或冲突拒绝策略。
  验证：`npm test -- --run workflow-scope-security`
  来源：`workflow-orchestration-policy` / `Scope cannot be overridden by workflow source`
- [ ] 4.2 为 workflow target missing、validation failure 和 runtime failure 实现显式 fallback 行为，默认不得隐式进入 model loop。
  验证：`npm test -- --run workflow-fallback`
  来源：`workflow-orchestration-policy` / `Workflow failure does not hide terminal truth`；design decision 10
- [ ] 4.3 为 routing、candidate reject、compiler result、DAG optimization summary 和 execution lifecycle 增加 safe diagnostic projection。
  验证：`npm test -- --run workflow-observability`
  来源：`workflow-orchestration-policy` / `Workflow events are safe by default`
- [ ] 4.4 添加 redaction negative tests，断言 diagnostics 不包含 prompt、raw model output、raw provider error、raw capability payload、secret、credential、local path、attachment content 或高基数字段。
  验证：`npm test -- --run workflow-redaction`
  来源：`workflow-orchestration-policy` / `Workflow Orchestration Safety And Scope`

## 5. Boundary And Composition

- [ ] 5.1 在 `agent-workflow` 建立 compiler、canonicalizer、DAG optimizer 和 engine adapter 的 package public surface，保持只依赖允许的 public contracts。
  验证：`npm run build`；`npm run lint:architecture`
  来源：design / `主要接口边界`；`质量属性设计-可维护性`
- [ ] 5.2 在 `agent-app` startup composition 中注入 workflow source loader、routing policy config、complete policy provider 和 sandbox compiler dependency。
  验证：`npm test -- --run workflow-app-composition`
  来源：proposal / `影响范围`；design / `Workflow Source Pipeline`
- [ ] 5.3 在 Agent Core 与 workflow execution bridge 中保持 runtime-owned cancellation、timeline 和 terminal lifecycle，不新增 workflow-owned terminal commit。
  验证：`npm test -- --run workflow-runtime-bridge`
  来源：design / `非目标`；`质量属性设计-可靠性/恢复`

## 6. Open Questions And Final Verification

- [ ] 6.3 运行 OpenSpec 全量校验。
  验证：`openspec validate --all --strict`
  来源：proposal / `归档前更新基线`；design / `验证映射`
- [ ] 6.4 运行常规验证门禁。
  验证：`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`
  来源：AGENTS.md / `验证门禁`

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/workflow-orchestration-policy/spec.md`。
- 同步 `openspec/specs/agent-routing-core/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/workflow-orchestration-policy.md`。
- 按需更新 `openspec/designs/architecture/workflow-contracts.md`。
- 按需更新 `openspec/designs/modules/agent-core.md`。
- 按需更新 `openspec/designs/modules/agent-workflow.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需新增 `openspec/designs/adr/workflow-yaml-ts-unified-engine.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
