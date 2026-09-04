## 0. 前置门禁

- [x] 0.1 记录发起者对目标 owner 的确认：`agent-router-plugin` 独立完成候选、optional RAG Tool、Prompt 与模型终选；`agent-core` 只调用三参数 policy 并消费结果；plugin API factory host 可提供所需 public runtime ports。
  来源：proposal `目标与非目标`；design `FN-10.3 自定义路由策略 / 修改方案`
  验证：人工检查 change artifacts；预期 proposal、design、specs 与 tasks 只保留一条 plugin-owned 实施路径。

- [x] 0.2 确认 `add-routing-explicit-priority` 的显式路由先行代码基线存在，本 change 不重写 directive、trusted target、policy rule 或下游 Skill/Workflow 处理。
  来源：proposal `非目标`；design `FN-10.3 自定义路由策略 / 当前实现`
  验证：运行定向 routing baseline tests；预期显式路由与 plugin fallback 顺序保持通过。

## 1. `FN-10.2 装配插件`

- [x] 1.1 先补 public plugin host 与 SDK 黑盒测试：固定 API `1.2` closed runtime services、API `1.0|1.1` host compatibility、三参数 routing policy、严格 router config、稳定 ids、factory artifact 与未绑定 fail-closed。
  来源：`FN-10.2 装配插件` + Requirement `插件 factory host 提供受治理 runtime services` + 全部 Scenarios
  验证：运行 contract、plugin loader 与 SDK 定向测试；预期新增断言在实现前失败、实现后通过。

- [x] 1.2 在 `agent-plugin-sdk` 定义 API `1.2` `PluginFactoryHostV1_2` 与 closed `PluginRuntimeServices`，删除 core routing selection/operations public types并保持 `decide(run, context, signal)`。
  来源：`FN-10.2 装配插件` + Requirement `插件 factory host 提供受治理 runtime services`；design `FN-10.2 装配插件 / 修改方案`
  验证：运行 `npm run build`、contract tests 与 `git diff -- packages/agent-contracts/src/core packages/agent-plugin-sdk/src/index.ts`；预期 core contract 恢复三参数，runtime services 只在 SDK host surface。

- [x] 1.3 在 `agent-app` 建立 startup deferred plugin runtime services binding，loader按 effective API version 注入精确host，并在 assembly/capability/model/prompt装配完成后一次性绑定；未绑定与重复绑定fail closed。
  来源：`FN-10.2 装配插件` + Requirement `插件 factory host 提供受治理 runtime services` + Scenarios `宿主通过factory提供runtime services`、`runtime services不可用时安全失败`、`runtime services保持closed surface`
  验证：运行 plugin loader/composition tests 与 architecture tests；预期 API `1.2` factory 获得runtime，API `1.0|1.1` shape不变，app不含router选择算法。

- [x] 1.4 保留官方artifact默认打包但不激活：API `1.2` factory artifact进入backend-only与with-frontend的`config/plugins/agent-router-plugin/`，package sample与默认Agent不声明router。
  来源：`FN-10.2 装配插件` + Requirement `本地runtime包携带agent-router-plugin但不默认激活` + Scenario `backend-capable运行包包含未激活router artifact`
  验证：运行 packaging focused tests；预期artifact、manifest和未激活断言全部通过。

## 2. `FN-10.4 自定义工具和提示词`

- [x] 2.1 保留唯一 `PromptTemplateResolverPort`、closed `RESOLVED | NOT_FOUND` schemas与Context Engine实现，继续由同一Agent-scoped frozen registry支撑，并保持插件默认提示词不进入Context Engine builtin root。
  来源：`FN-10.4 自定义工具和提示词` + `prompt-template-assembly` delta全部Requirements
  验证：运行 resolver package/contract/architecture tests；预期 resolver边界、取消、无匹配与禁止公开实现类型全部通过。

## 3. `FN-10.3 自定义路由策略`

- [x] 3.1 将完整router算法迁入`agent-plugin-sdk/agent-router-plugin`：按accepted assembly bindings与catalog交集形成候选，应用三种selection mode，optional RAG通过runtime Capability invocation调用bound `Rag` Tool并求交。
  来源：`FN-10.3 自定义路由策略` + Requirements `agent-router-plugin按配置限制目标类型`、`agent-router-plugin仅选择当前Agent绑定的可用能力`、`agent-router-plugin可通过受治理RAG Tool预筛候选`
  验证：运行SDK router tests；预期binding顺序、unbound/disabled/wrong-kind、RAG跳过/触发/零命中/失败/source求交与topK边界通过。

- [x] 3.2 在插件内完成model selection、Prompt resolve/default task、一次无Tool模型终选与strict结果映射；候选为空跳过RAG后续、Prompt与模型，依赖或输出失败由core既有failure boundary安全拒绝。
  来源：`FN-10.3 自定义路由策略` + Requirements `agent-router-plugin使用当前Agent初始模型执行一次受控选择`、`agent-router-plugin依赖失败时安全拒绝`
  验证：运行SDK与core integration tests；预期Skill、Workflow、NONE、override/default prompt、取消、非法输出和安全失败通过。

- [x] 3.3 从`agent-core`删除router runtime、第四参构造及model/prompt/Capability router依赖；executor只解析并调用`executable.decide(run, context, signal)`、校验结果、附加accepted assembly与执行既有timeout/failure boundary。
  来源：design `FN-10.3 自定义路由策略 / 修改方案`
  验证：运行core routing tests和architecture source assertions；预期core无`agent-router-plugin-runtime`、`AgentRoutingPolicyOperations`、Prompt resolver或router专用Tool/model调用。

## 4. 整体验证

- [x] 4.1 执行 `openspec validate add-agent-router-plugin --strict` 与 `$nextagent-skill-review`，确认Function/spec映射、delta operation、owner、public contract确认和唯一实施路径无阻塞项。
  来源：全部Functions；design `验证策略`
  验证：命令通过，审查结论为PASS且`需群内确认`已由本次发起者确认闭合。

- [x] 4.2 执行受影响package测试、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`与`git diff --check`，并确认既有`docs/issues/`未进入change。
  来源：全部Functions；design `验证策略`
  验证：全部门禁通过；若存在基线失败，必须给出可重复证据且不得勾选受影响任务。
