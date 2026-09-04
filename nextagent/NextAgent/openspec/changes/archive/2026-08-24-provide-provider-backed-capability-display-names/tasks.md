## 0. Frozen contract 前置门禁

- [x] 0.1 固化 proposal“需群内确认”中的完整确认记录，覆盖 descriptor/authoring locales、Tool stable `displayName` 既有消费者语义、optional Provider `listCurrent`、`CapabilityCurrentViewPort`、runtime presentation query contracts、Session Web API、前端 prefetch/refresh/last-good/confirmed-missing、AICOConfig BREAKING 删除和 Gateway 不变边界
  - 来源：proposal `需群内确认`；design `FN-5.1 管理能力目录`、`FN-2.4 查看请求状态`
  - 验证：确认记录与六个 delta specs 的字段、authority、failure、fallback 和 deferred 边界逐项一致；确认完成前不得修改 frozen contract 生产代码

## 1. `FN-5.1 管理能力目录`

- [x] 1.1 先为 `CapabilityDescriptor.locales` 编写 RED contract tests，覆盖字段缺失、合法 `zh-CN/en-US/fr-FR`、`null`、数组、empty map、locale tag 2/35/36 字符、unknown content field、空白/control character、256/257 Unicode code point和closed object
  - 来源：Requirement `CapabilityDescriptor 提供统一本地化展示事实` 及全部 Scenarios
  - 验证：运行 `npm test -- tests/contract/schema-smoke.test.ts`；实现前合法 `locales` 因 closed schema 失败，实现后正向与拒绝用例全部通过

- [x] 1.2 在 `agent-contracts/capability` 实现 `LocalizedCapabilityContent`、`CapabilityLocales`、`CapabilityDescriptor.locales`、`CapabilityCurrentDiscoveryCriteria`、optional `CapabilityDiscovery.listCurrent` 和 `CapabilityCurrentViewPort` public contracts，保持 existing `CapabilityCatalog` interface 与 required stable `displayName` 不变
  - 来源：Requirements `CapabilityDescriptor 提供统一本地化展示事实`、`Capability current view 只读取当前受治理事实`；design `Descriptor 与 authoring contract`、`Provider current-read SPI`、`Catalog current view`
  - 验证：运行 `npm test -- tests/contract/schema-smoke.test.ts`、`npm run build`；预期 public exports、runtime schemas 和 strict TypeScript build 通过

- [x] 1.3 先为 Provider discovery guard 的 `listCurrent` 编写 RED tests，覆盖 AbortSignal 下传、timeout/cancel/throw/invalid descriptor reject、method missing 可检测，以及 source-level failure 不转换为空成功数组
  - 来源：Requirement `Capability current view 只读取当前受治理事实` Scenario `current source 不完整时整体失败`；design `Provider current-read SPI`
  - 验证：运行 `npm test -- packages/agent-capability/tests/extension-registration.test.ts`；实现前 guard 无该 operation，实现后 negative cases 均 reject并保留safe diagnostics

- [x] 1.4 在 Provider discovery guard 增加 `listCurrent` validation boundary，并为 EAGER source 暴露现有 startup descriptor facts；禁止 EAGER presentation read 重新调用 remote list/describe
  - 来源：Requirement `Capability current view 只读取当前受治理事实`；design `Provider current-read SPI`
  - 验证：运行 `npm test -- packages/agent-capability/tests/extension-registration.test.ts packages/agent-capability/tests/clip-tool-source.test.ts`；断言 presentation current read 的 remote CLIP calls 为0

- [x] 1.5 先为 local/agent-owned/runtime-generated Skill current-read 编写 RED tests，覆盖 trusted Owner+Session+Agent Scope、frontmatter-only、new identity、无 `locales` stable name、missing root、read error和不materialize/不创建删除临时目录
  - 来源：Requirement `Capability current view 只读取当前受治理事实` Scenarios `runtime-generated 新 identity可被当前读取发现`、`current reader不完整时整体失败`；design source matrix
  - 验证：运行 `npm test -- packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/runtime-generated-skill-activation.test.ts packages/agent-capability/tests/skill-manifest.test.ts`；negative spies断言body/script读取和filesystem write均为0

- [x] 1.6 实现 local/agent-owned/runtime-generated Skill 的 strict `listCurrent`，只定位当前 root 并解析有界 frontmatter；缺失 source或optional Skill root `ENOENT`返回完整空集，locator invalid/throw及root/readdir非`ENOENT`整体失败 reject
  - 来源：同任务1.5；design `Provider current-read SPI`
  - 验证：运行任务1.5 focused tests；预期novel generated Skill下一次读取可见、无本地化资源仍返回required stable `displayName`

- [x] 1.7 先为 SkillHub installed-only current-read 编写 RED tests，覆盖index不存在的完整空集、installed manifest winner、冷启动恢复、损坏index/I/O unavailable，以及remote list/fetch/install/index update调用次数为0
  - 来源：Requirement `Capability current view 只读取当前受治理事实` Scenario `presentation read不触发远端Skill获取`；design source matrix
  - 验证：运行 `npm test -- packages/agent-capability/tests/skillhub-source.test.ts`；实现前无strict reader，实现后正向、冷启与negative cases通过

- [x] 1.8 实现 SkillHub `listCurrent` 和 strict installed-index read，区分“index file不存在=完整空集”与“损坏/I/O=unavailable”，acquisition wrapper保真转发该operation
  - 来源：同任务1.7；design `Provider current-read SPI`
  - 验证：运行任务1.7 focused tests；断言 installer既有commit/index merge顺序和normal acquisition tests保持通过

- [x] 1.9 为local subagent与Workflow Recipe current-read补RED tests并实现当前registry/index过滤；不得重新编译无关Agent package、执行Workflow或访问远端
  - 来源：Requirement `Capability current view 只读取当前受治理事实`；design source matrix
  - 验证：运行 `npm test -- packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-capability/tests/workflow-tool.test.ts packages/agent-workflow/tests/workflow-recipe-blackbox.test.ts`；断言当前scope结果与禁止副作用

- [x] 1.10 先为 `CapabilityCurrentViewPort` 编写 RED tests，覆盖EAGER+SEARCH组合、binding/disabled/availability、priority/conflict winner、wrapper target不按modelInvocable过滤、deterministic order、loser exclusion、method missing/source-level read failure导致整批reject
  - 来源：Requirement `Capability current view 只读取当前受治理事实` 全部Scenarios；design `Catalog current view`
  - 验证：运行 `npm test -- packages/agent-capability/tests/capability-current-view.test.ts packages/agent-capability/tests/catalog.test.ts packages/agent-capability/tests/conflict-resolution.test.ts`；实现前port不存在，实现后新旧governance assertions通过

- [x] 1.11 由现有 `StaticCapabilityCatalog` 实现 `CapabilityCurrentViewPort`，复用既有candidate gates/conflict resolver，不修改 `CapabilityCatalog.listAvailable/resolve`，不创建第二Catalog、server snapshot、generation或name registry
  - 来源：同任务1.10；design `Catalog current view`
  - 验证：运行任务1.10 focused tests与`npm run lint:architecture`；确认实现只通过public contracts组合且source-level reader failure无partial result

- [x] 1.12 先为runtime presentation query、app composition和Session Web route编写RED tests，覆盖owner校验、session-bound agentId、client locale/agentId/unknown input拒绝、全部winner、确定排序、safe allowlist、cancel/timeout/invalid current view、空Catalog与failure区分
  - 来源：Requirement `Session Capability展示资源查询返回安全current projection` 全部Scenarios；design `Runtime query与Session Web route`
  - 验证：运行新增 `packages/agent-core/tests/capability-presentation-resource-query-port.test.ts`、`packages/agent-channel-web/tests/capability-presentation-resource-routes.test.ts` 和相关 `agent-app` composition tests；实现前contracts/route不存在而失败

- [x] 1.13 在 `agent-contracts/runtime`、`agent-core` 的 `createCapabilityPresentationResourceQueryPort(...)`、`agent-app`和`agent-channel-web`实现presentation resource query与 `GET /api/v1/sessions/:sessionId/capability-presentation-resources`；route必须先`requireSession`，并把request abort传到current view
  - 来源：同任务1.12；design `Runtime query与Session Web route`、`Gateway边界`
  - 验证：运行任务1.12 tests、`npm run build`、`npm run test:contract`、`npm run lint:architecture`；确认channel不直接import Catalog/private implementation，Gateway contracts/schema/migrations无diff

- [x] 1.14 为当前用户可见Builtin Tool metadata提供stable、`zh-CN`、`en-US`名称，并把Skill既有`metadata.zh-name/en-name`投影为descriptor locales；先写Tool/Skill descriptor RED tests再实现
  - 来源：Requirement `CapabilityDescriptor提供统一本地化展示事实` Provider mapping Scenarios；design `Descriptor与authoring contract`
  - 验证：运行 `npm test -- packages/agent-capability/tests/tool-framework.test.ts packages/agent-capability/tests/skill-manifest.test.ts packages/agent-capability/tests/builtin-skill-source.test.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-app/tests/skill-catalog-query-port.test.ts`；确认Tool canonical name与Skill Catalog行为不变

- [x] 1.15 为 agent-owned/runtime-generated Skill current-read 编写 RED tests，分别覆盖单个 manifest 缺失或读取失败、schema rejected 时跳过该 Skill并返回合法 siblings；锁定 locator `not-found`/`undefined`及optional Skill root `ENOENT`表示空source，并保留configured locator invalid/throw、root/readdir非`ENOENT`整体失败；覆盖 locator await 期间取消必须reject且不得提交诊断
  - 来源：Requirement `Capability current view 只读取当前受治理事实` Scenarios `单个非法 current 资源不影响其他合法资源`、`current source 不完整时整体失败`；design source matrix
  - 验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/runtime-generated-skill-activation.test.ts`；实现前单 manifest 异常使 current-read reject，RED 必须由该行为触发

- [x] 1.16 在 local Skill `scanCurrentRoot` 中复用既有安全诊断并跳过单个 manifest missing/read/parse/schema failure；在不可取消的 locator/readdir/manifest await 后及诊断提交前复查 cancellation；保持 parser/schema、loading facts、startup scan、search、root `ENOENT`空source与其他root failure语义不变
  - 来源：同任务 1.15；proposal 非目标 `不修改 Skill manifest 的 authoring 字段、解析规则或 schema 合法性`
  - 验证：运行任务 1.15 focused tests与 `packages/agent-capability/tests/skill-manifest.test.ts`；`git diff` 确认 `skill-manifest.ts` 字段规则和 rejection reasons 无变化

- [x] 1.17 为 SkillHub installed-only current-read 编写 RED tests，覆盖单个 manifest missing、schema invalid和frontmatter hash mismatch被跳过，合法 installed siblings 保留；installed index整体失败继续reject，index await 期间取消必须reject且不得提交诊断
  - 来源：Requirement `Capability current view 只读取当前受治理事实` Scenario `单个 SkillHub installed manifest 异常不影响其他已安装 Skill`；design source matrix
  - 验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts`；实现前每个单 manifest 异常均使 current-read reject，RED 必须分别命中三条路径

- [x] 1.18 在 SkillHub `listCurrent` 中复用既有安全 evidence并跳过单个 installed manifest missing/read/invalid/hash mismatch；在不可取消的 index/manifest await 后及诊断提交前复查 cancellation；保持 strict index、remote sync/fetch/install/index update与body loading语义不变
  - 来源：同任务 1.17；design `Provider current-read SPI`
  - 验证：运行任务 1.17 focused tests；断言 remote list/fetch/install与index write调用次数为0，损坏index仍reject

- [x] 1.19 为 local subagent current-read 编写 RED tests，覆盖单个 assembly 映射出的 descriptor 因非法 locale 未通过canonical schema时被跳过且合法 sibling 返回，未配置optional source返回完整空集，以及configured registry/source整体throw与cancel继续reject
  - 来源：Requirement `Capability current view 只读取当前受治理事实` 的单资源与source-level失败规则；design source matrix
  - 验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts`；实现前invalid assembly导致descriptor数量不等而整批reject

- [x] 1.20 删除 local subagent current-read 的数量一致性整体throw，在 `mapLocalAssembly` 内以canonical `capabilityDescriptorSchema`逐项校验并复用既有invalid evidence；保持source调用、scope、公开descriptor contract与cancel语义不变
  - 来源：同任务 1.19；design `Provider current-read SPI`
  - 验证：运行任务 1.19 focused tests与 Agent discovery相关测试；确认未重新编译无关Agent package

- [x] 1.21 补 Workflow Recipe 与 external SEARCH Provider characterization tests：Workflow 单个非法Recipe继续沿既有loader跳过；external Provider整体throw/timeout/cancel/非法descriptor数组和EAGER facts不完整继续使current view失败
  - 来源：Requirement `Capability current view 只读取当前受治理事实`；design source matrix
  - 验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests/workflow-recipe-blackbox.test.ts packages/agent-capability/tests/extension-registration.test.ts packages/agent-capability/tests/capability-current-view.test.ts`；确认Workflow loader和Provider/Catalog成功、descriptor、winner、governance语义不变，仅既有safe failure normalization保留cause供本地诊断

- [x] 1.22 补 Catalog与模型披露一致性 characterization：高优先级同名资源因非法未形成descriptor时，合法低优先级资源按既有resolver在presentation current view与`listAvailable({ modelInvocable: true })`中一致胜出
  - 来源：Requirement `Capability current view 只读取当前受治理事实` Scenario `非法高优先级资源不抑制合法低优先级资源`；design `Catalog current view`
  - 验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/capability-current-view.test.ts packages/agent-capability/tests/catalog.test.ts packages/agent-capability/tests/conflict-resolution.test.ts`；确认Catalog winner/governance生产逻辑无变化且非法资源不可解析、不可调用；Catalog仅在既有safe rethrow中保留cause

- [x] 1.23 为单资源安全诊断和source-level 503编写RED tests：各修改source记录安全、有界诊断；Capability presentation route在自己的catch boundary记录canonical local operational `rawExceptionData`；HTTP response保持既有safe 503且不含Provider error/path，其他复用`withUnavailableFallback`的route行为不变
  - 来源：Requirements `Capability current view 只读取当前受治理事实`、`Session Capability 展示资源查询返回安全 current projection`；design `Provider current-read SPI`、`Runtime query 与 Session Web route`
  - 验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/skillhub-source.test.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-capability/tests/extension-registration.test.ts packages/agent-capability/tests/capability-current-view.test.ts packages/agent-core/tests/capability-presentation-resource-query-port.test.ts`（SkillHub 全文件的既有 #764 基线按 1.25 单独记录）及 `npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/capability-presentation-resource-routes.test.ts`；实现前Web日志缺少原始异常事实，新增断言必须RED

- [x] 1.24 实现source安全诊断与Capability presentation route的source-level异常日志；不修改通用`withUnavailableFallback`，只使用既有runtime logger和canonical `runtimeRawExceptionData`，不得把内部错误投影到HTTP、Web DTO、timeline、stream、metric或trace
  - 来源：同任务 1.23；design `Provider current-read SPI`、`Runtime query 与 Session Web route`
  - 验证：运行任务 1.23 的两个精确 focused 命令与 `npx vitest run --config vitest.config.release.ts packages/agent-common/tests/agent-error.test.ts`；断言HTTP body仅含`CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE` safe error

- [x] 1.25 执行鲁棒性修复的集中回归和语义检视，确认两个触发 Skill 被跳过、其他合法资源成功返回、合法低优先级同名winner与模型披露一致，source-level故障仍503，Skill parser与公开契约无变化
  - 来源：Issue #763；proposal 目标与非目标；design `验证策略`
  - 验证：运行相关 focused tests、`npm run build`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate provide-provider-backed-capability-display-names --strict`、`openspec validate --all --strict`、`git diff --check`，并执行`nextagent-skill-review`与`nextagent-code-review`
  - 实施前基线记录（2026-08-13，`94143c5d1`）：release Vitest集合中`packages/agent-capability/tests/skillhub-source.test.ts > executes a governed SkillHub Skill through the normal Skill Tool invocation path`稳定失败，期望旧`generatedMessages`注入而当前生产契约已把Skill正文持久化到`structuredPayload.body`；首个破坏提交为`16499ea41d8ad31ed5a4ca5f0eee3ecb5d662bb4`（MR !1117，2026-08-11，高虎军），与本次故障隔离代码无因果关系，已由Issue #764独立跟踪，本change不修改该测试或Skill正文持久化语义
  - WebUI 实施证据（2026-08-14，实现提交`3f75f04bc`）：通过 branch-fullstack launcher 用 `all-scenarios@e2b85535ae9c59d7f98d23b407d1d34fa6832b4f632b045efbc29290076182e8` 启动 MiniMax Local 实例，Playwright 从真实页面创建 Session 并完成一次 Glob 调用；浏览器观测到 `GET /api/v1/sessions/{sessionId}/capability-presentation-resources` 返回 200 且包含合法 AGENT/SKILL/TOOL resources，过程面板以中文展示“查找文件 · 已完成”，无 503 或请求失败。两个非法 Skill 与合法 sibling 的共存隔离、不披露以及同名 winner 语义由 source/Catalog 黑盒自动化测试覆盖；Scenario Pack 只挂载只读业务数据，不用于伪造 Agent-owned Skill 配置。
  - WebUI 故障对照证据（2026-08-14）：在同一 MiniMax Agent、同一六文件复现场景及同一前端构建产物下分别启动修改前与修复后后端，并从未加载过 presentation resources 的全新页面状态开始验证。修改前 presentation resource API 稳定返回 safe 503，过程标题按缺失 resource 降级为 `Read · 未找到`；修复后同接口返回 200，`Read` resource 包含 `zh-CN.displayName=读取文件`，过程标题显示 `读取文件 · 未找到`。前端按既有契约在后续请求失败时保留同 Session 的 last-good resources，因此复用曾成功加载资源的标签页不作为故障对照证据；全新页面的直接 API 响应与真实 DOM 结果一致，证明行为变化来自 current resource failure isolation。

## 2. `FN-3.2 编译智能体装配`

- [x] 2.1 先为Agent package名称编写RED tests，覆盖合法中英文、字段缺失兼容、invalid locales fail closed、Assembly保真和Agent descriptor逐值投影
  - 来源：Requirement `Agent package保留可选本地化展示名称` 全部Scenarios
  - 验证：运行 `npm test -- packages/agent-app/tests/agent-plugin-definition-parser.test.ts tests/agent-kernel/config-assembly.test.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts`；实现前closed parser拒绝新字段，实现后全部通过

- [x] 2.2 在AgentDefinition parser、`AgentAssembly` contract、compiler和Agent discovery实现optional locales保真，复用统一schema与结构，不改变assemblyRef、routing、model、prompt、binding或Agent invocation
  - 来源：同任务2.1；design `FN-3.2编译智能体装配/修改方案`
  - 验证：运行任务2.1 tests、`npm run build`和assembly contract tests；确认缺失字段无warning且invalid input不发布半成品assembly

## 3. `FN-9.1 执行工作流`

- [x] 3.1 先为Recipe名称编写RED tests，覆盖合法中英文、字段缺失、invalid locales skip、Recipe stable `displayName`进入descriptor、`recipeName`仍为identity
  - 来源：Requirement `RecipeDefinition提供可选本地化展示名称` 全部Scenarios
  - 验证：运行 `npm test -- packages/agent-workflow/tests/workflow-recipe-blackbox.test.ts packages/agent-capability/tests/workflow-tool.test.ts`；实现前schema拒绝locales或descriptor错误使用recipeName，实现后全部通过

- [x] 3.2 在`RecipeDefinitionSchema`、RecipeIndex、loader和Workflow descriptor mapper实现locales保真并修正stable displayName投影；保持lang分类、routing、graph、cache、execution和lifecycle不变
  - 来源：同任务3.1；design `FN-9.1执行工作流/修改方案`
  - 验证：运行任务3.1 tests、`npm run build`和Workflow contract tests；断言名称变化不改变Recipe选择与执行结果

## 4. `FN-10.2 装配插件`

- [x] 4.1 先为Plugin Tool authoring名称编写RED tests，覆盖stable/中英文名称、字段缺失fallback name、invalid fail closed、ToolSearch读取stable name、direct descriptor Provider和Plugin API version兼容
  - 来源：Requirement `Plugin Tool authoring使用统一展示名称契约` 全部Scenarios
  - 验证：运行 `npm test -- packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-capability/tests/tool-framework.test.ts packages/agent-capability/tests/tool-search-tool.test.ts tests/e2e/plugin-composition-product-path.test.ts`；实现前typing/mapping assertions失败

- [x] 4.2 在`ToolMetadata`、`DefineToolInput`和Plugin SDK descriptor mapper实现optional `displayName/locales`，保持canonical name、description、schema、binding、risk、sandbox和invocation不变
  - 来源：同任务4.1；design `FN-10.2装配插件/修改方案`
  - 验证：运行任务4.1 tests与`npm run build`；确认existing Plugin不配置fields时descriptor与API version不变

## 5. `FN-2.4 查看请求状态`

- [x] 5.1 先为共享name resolver编写RED table tests，覆盖exact UI locale、`en-US`、stable displayName、id、resource无locales、普通Tool、直接Agent/Skill/Workflow、wrapper target、invalid identity、中英文状态和纯文本安全
  - 来源：Requirement `Capability过程标题必须使用最小公开身份生成` 全部Scenarios
  - 验证：在`frontend/agent-web`运行 `npm test -- src/features/chat/process/capabilityProcessTitle.test.ts`；实现前Provider resources不能驱动标题，实现后priority table与plain-text assertions通过

- [x] 5.2 先为Session presentation resource client/store/coordinator编写RED tests，覆盖create/activate prefetch、conversation并行、accepted acquisition去重、unknown identity、single-flight+dirty trailing、atomic replace、no-locales resolved、confirmed missing、failure last-good/cooldown、session epoch与late response
  - 来源：Requirement `Agent Web必须集中维护Capability业务名称映射` Scenarios `新Session与conversation并行预取`至`迟到response不污染其他Session`；design `Shared browser owner`、`预取与刷新调度`
  - 验证：在`frontend/agent-web`运行新增 `npm test -- src/state/capabilityPresentationStore.test.ts src/state/capabilityPresentationCoordinator.test.ts`；实现前client/state不存在，实现后调用次数和状态转移断言通过

- [x] 5.3 实现Session-scoped API client、共享resource state/coordinator，并接入createSession成功、Session activation、accepted live envelope和delayed process history ingestion；不得放入local/immersive/PIU宿主入口私有实现
  - 来源：同任务5.2；design `Shared browser owner`、`预取与刷新调度`
  - 验证：运行任务5.2 tests与architecture/import assertions；确认三宿主共同使用ChatPageCore/shared state owner

- [x] 5.4 先为process/timeline/history reactive title编写RED tests，覆盖resource response到达但无新event时重算、locale switch零请求、同event引用history更新、entry key/展开态稳定、completion-only和delayed process history
  - 来源：两个`ts-run-status-visibility` MODIFIED Requirements；design `Title projection与history`
  - 验证：在`frontend/agent-web`运行 `npm test -- tests/processDetailsProjection.test.ts tests/TurnBlock.capability-business-names.test.tsx`；实现前memo不订阅resource而失败

- [x] 5.5 修改`capabilityProcessTitle.ts`、process/timeline builders、`TurnBlock`和ProcessPanel接线，只消费pure resource lookup并加入reactive dependency；保留correlation/tool-call key、wrapper action/status/detail static i18n和结果三档
  - 来源：同任务5.4；design `Title projection与history`
  - 验证：运行任务5.1、5.4 tests及相关ProcessPanel tests；确认title原位更新且展开态、过程层级、结果披露不变

- [x] 5.6 保持Skill Catalog `/api/v1/skills` request、分页、keyword和visibility contract独立，并验证locale切换不向该request或presentation API添加locale
  - 来源：Requirement `Agent Web必须集中维护Capability业务名称映射` Scenario `Skill Catalog查询保持独立`
  - 验证：运行Skill selector/API client tests；network assertions确认两个API均无locale且presentation API不替代Skill list

- [x] 5.7 扩展三宿主browser/e2e与focused state/component验收，合并覆盖Builtin、Plugin Tool、Agent/Skill/Workflow wrapper、Session预取、中英文切换、history重开、installed Skill刷新、novel runtime-generated Skill无locales、503 last-good/id降级和plain-text安全
  - 来源：两个MODIFIED Requirements；design `验证策略`
  - 验证：在`frontend/agent-web`运行相关Playwright gate、`npm run build`、`npm run build:vite:modes`；断言语言切换零请求、重复Tool call零额外refresh、结果三档与过程结构不变

## 6. `FN-10.6 前端定制`

- [x] 6.1 先为AICOConfig目标契约编写RED/characterization tests，覆盖unknown `capabilityBusinessNames`静默忽略、不进入validated config/store/title，以及其他合法字段和三宿主注入继续生效
  - 来源：`aico-config-contract`三个MODIFIED Requirements及相关Scenarios
  - 验证：在`frontend/agent-web`运行AICOConfig validator/store/entry tests；实现前field仍被接受而RED失败，实现后unknown key无warning且其他定制通过

- [x] 6.2 删除AICOConfig public name field、supporting types/validator/default和consumer，并删除frontend platform/integration Capability name hard-coded authority；不删除wrapper/action/status/detail i18n
  - 来源：三个MODIFIED Requirements；design `FN-10.6前端定制/修改方案`与`FN-2.4/Title projection与history`
  - 验证：运行任务6.1与任务5.1/5.5 tests、Agent Web build；`rg`确认production AICOConfig和title resolver不再声明或消费Capability name registry

## 7. 跨 Function 共享任务与整体验证

- [x] 7.1 更新Capability extension、Agent package、Skill、Workflow和Plugin Tool开发者文档，说明authoring来源、统一descriptor、Session API/fallback、`zh-CN/en-US`验收和其他合法locale扩展边界；AICOConfig文档只保留UI定制
  - 来源：proposal `目标与非目标`、`What Changes`；design `跨Function协作与端到端流程`
  - 验证：文档示例通过对应parser/schema tests；检索确认不再把frontend build mapping或AICOConfig声明为Capability name权威

- [x] 7.2 完成跨Function non-regression，确认Catalog/Resolve/search、ToolSearch stable name、SkillCatalog、Skill acquisition、Runtime Bootstrap、event/history/SSE/WS、结果披露、Gateway/persistence与AICOConfig其他fields无未授权契约变化
  - 来源：proposal `非目标`、`影响范围`；design `验证策略`
  - 验证：运行相关contract/architecture tests并执行semantic diff review；negative tests实际断言presentation path无remote sync/install/body read/write、client Agent override和partial success

- [x] 7.3 执行完整交付门禁并记录基线噪声与change因果关系
  - 来源：全部Requirements；design `验证策略`
  - 验证：根目录运行`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate provide-provider-backed-capability-display-names --strict`、`openspec validate --all --strict`、`git diff --check`；`frontend/agent-web`运行`npm run build`、相关`npm test -- ...`、`npm run build:vite:modes`和相关e2e

- [x] 7.4 执行`nextagent-skill-review`和push前`nextagent-code-review`；任何BLOCKER/P0/P1必须修复后重新审查，P2只能在不影响本change验收时附明确follow-up
  - 来源：AGENTS.md review/push门禁；proposal `需群内确认`
  - 验证：审查结论为PASS或PASS WITH FOLLOW-UP，确认记录已归档，OpenSpec与实现无字段、owner、failure、fallback或scope漂移

- [x] 7.5 为仓库既有 `network-explorer` Agent 补齐真实 `zh-CN/en-US` 展示资源；先用读取正式资产并经过生产 loader 的黑盒测试验证 RED，再修改元数据并验证 GREEN；Skill 中英文、无 locales、stable name 和 id 降级继续由独立 fixture 覆盖
  - 来源：Requirement `Agent package 保留可选本地化展示名称` Scenario `随产品交付的 network-explorer 可直接验收中英文名称`
  - 验证：根目录运行 `npm test -- tests/capability-source-configuration/bundled-capability-locales.test.ts`、`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts tests/agent-kernel/invoked-agent-discovery-config.test.ts`；在 `frontend/agent-web` 运行 `npm test -- src/features/chat/process/capabilityProcessTitle.test.ts src/state/capabilityPresentationStore.test.ts`；完整 MiniMax Local WebUI 中同一 History 在中文显示产品中文名、英文显示产品英文名，语言切换不新增 presentation resource 请求

## 归档前更新基线检查（非实施任务）

实现与全部验证完成后，按design“长期基线刷新计划”同步六个stable specs、对应Functions、`F-2.4`、overview、architecture、modules和`spec-to-design-map`；不得在实施阶段提前改写这些长期基线。
