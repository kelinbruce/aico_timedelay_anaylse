## 0. 实施前确认

- [x] 0.1 对齐最终黑盒目标：所有 Agent 类别进入统一 Catalog，包括 builtin Agent、`agents/{agentId}/agent.yaml` 顶层 local Agent、父 Agent package 下的 `subagents/{subagentId}/agent.yaml`；当前父 Agent 可调用 Agent 由 Catalog request-scope governance 计算，并进入 prompt disclosure。验证：code review 对照 proposal/design/spec，确认没有把目标收窄为仅支持 `subagents/` 目录。
- [x] 0.2 固定非目标边界：本 change 不实现 child run、Agent executor、task tool、上下文继承、结果返回、remote AgentRegistry、Web API、stream event、audit schema、runtime command 或 persistence。验证：diff review 与 architecture tests 确认无 execution path、runtime child run 写入、Web route、stream event、audit schema、gateway table。
- [x] 0.3 确认实现路径唯一：生产路径必须是 `agent-app compiled AgentAssembly set -> AgentDiscoverySource -> BuiltinAgentDiscovery / LocalAgentDiscovery -> CapabilityDescriptor(kind="AGENT") -> Catalog governance -> prompt disclosure`。验证：source review 不允许旧 locator-backed Agent discovery、candidate DTO、第二套 Agent descriptor/catalog/assembly 或 capability 之外的 invocation envelope。

## 1. Agent Assembly Contract 与统一装配

- [x] 1.1 在 `agent-contracts/agent-assembly` 为现有 `AgentAssembly` 增加 `userInvocable: boolean`、`agentInvocation: "NONE" | "BOUND" | "PARENT"`，并以 assembly 装配事实承载 `sourceKind`、parent-only subagent 的 `parentAgentScope` 和 `workspacePolicy.files`；Agent definition 可省略调用策略配置项，assembly compiler 默认 `userInvocable=true`、`agentInvocation="BOUND"`；`CapabilityDescriptor` 不增加这些字段。验证：contract tests 覆盖 assembly shape，agent-app tests 覆盖省略配置后的默认编译结果，descriptor schema 不包含 `userInvocable`、`agentInvocation`、`parentAgentScope` 或等价 runtime routing policy 字段。
- [x] 1.2 在 `agent-core` 用 `builtin-agents/{agentId}/agent.yaml` + 可选 `prompts/` 承载 builtin Agent 业务 package，并只暴露 trusted `builtin-agents` 根目录；`agent-app` 扫描该根目录直接子目录，复用同一 Agent package parser/compiler，统一编译 builtin Agent package、`agents/{agentId}/agent.yaml` 顶层 local Agent 和父 Agent package 下的 `subagents/{subagentId}/agent.yaml`。验证：agent-app assembly tests 覆盖三类来源均产出 `AgentAssembly`，新增 builtin Agent 不需要维护 TS 列表，builtin package 不携带旧 `workspaceDir` / `workspaceFiles`，缺失或空 `subagents/` 不阻塞父 Agent assembly，非法 `agent.yaml` fail closed 或安全降级；source review 确认 `agent-core` 不拥有 parser/compiler/discovery。
- [x] 1.3 为 app composition 内所有可发现 Agent 增加 `agentId + agentVersion` 全局唯一性校验。验证：negative tests 覆盖 builtin/local/subagent 重复 identity 被安全拒绝，Catalog 不发布 ambiguous Agent descriptor。
- [x] 1.4 保留并验证 `capabilityBindings.capabilityType="AGENT"` parser/compiler 语义，unknown capability type 继续 fail closed。验证：assembly parser/compiler tests 覆盖 `TOOL`、`SKILL` 兼容，`AGENT` accepted，unknown rejected，`enabled=false` fact 被保留。

## 2. App-Owned Registry 与 Discovery Source

- [x] 2.1 将当前单 assembly registry 形态收敛为接收全部 compiled `AgentAssembly` objects 的 app-owned concrete implementation，不保留 `CompiledAgentAssemblyRecord` 或 workspace file sidecar config；系统配置中的 `activeAgentId` 只作为当前单智能体默认路由输入，启动期可用与 `AgentAssemblyRegistry.active(agentId)` 相同的 top-level eligibility 规则做 fail-fast 校验，registry 不持有 active 状态，app composition 不用默认路由 Agent 初始化 Agent-owned 全局策略。验证：registry tests 覆盖 `active(agentId)` 只返回 `userInvocable=true` 的 non-parent assembly，`require(agentId, agentVersion)` 可找回 builtin、顶层 local Agent 和 parent subagent；workspace file policy tests 覆盖按运行时 Agent Scope 从 `workspacePolicy.files` 取 file authority。
- [x] 2.2 同一个 app-owned concrete object 同时实现 `AgentAssemblyRegistry` 和 `AgentDiscoverySource`，并让 `listBuiltinAgentAssemblies`、`listTopLevelLocalAgentAssemblies`、`listParentSubagentAssemblies(parentScope)` 读取同一批 compiled assemblies；parent-subagent list 按 `AgentAssembly.parentAgentScope` 匹配父 Agent。验证：registry/source tests 覆盖三类 list 方法来自同一 compiled set，`AgentDiscoverySource` 不 reparse `agent.yaml`。
- [x] 2.3 `agent-app` 只通过可信 app composition 或 app-owned Agent package source handling 枚举 `subagents/*/agent.yaml`；不得从 runtime-facing `AgentAssembly.workspaceDir/subagents` 反推 raw subagent root。验证：negative test 构造 `workspaceDir/subagents` 存在但 trusted source 未返回该 root，断言不会扫描且 `agent-capability` 不接收 raw root。
- [x] 2.4 parent-local ownership 由 parent-only subagent 自身的 `AgentAssembly.parentAgentScope` 表达，并只用于 `AgentDiscoverySource.listParentSubagentAssemblies(parentScope)` 过滤，不新增 parent 字段到 public descriptor。验证：descriptor safety tests 确认 metadata 不包含 parent-owned routing facts、raw path 或 loading key。

## 3. Provider 与 Discovery Adapter

- [x] 3.1 在 `agent-capability` 中定义 reserved `builtin-agents + BUNDLED` 和 `local-agents + LOCAL_DIRECTORY` 两个 Agent provider identity，并只允许 trusted app/capability composition 注册。验证：provider/config tests 覆盖外部 `CapabilityProviderConfig` 不能声明、覆盖或禁用这两个 provider。
- [x] 3.2 实现 `BuiltinAgentDiscovery`，只调用 `AgentDiscoverySource.listBuiltinAgentAssemblies(signal)` 并映射为 `CapabilityDescriptor(kind="AGENT")`；不使用 `BuiltinAgentCandidate` 或 candidate metadata DTO，不创建 execution route。验证：builtin discovery tests 覆盖 descriptor kind、provider identity、safe display metadata、availability、`BOUND/NONE` publication 行为和 no side effect。
- [x] 3.3 实现唯一 `LocalAgentDiscovery` class 的两个 factory-created 实例：`local-agents + EAGER + sourceScope="top-level-local"` 调用 `listTopLevelLocalAgentAssemblies`；`local-agents + SEARCH + sourceScope="parent-subagent"` 按 trusted parent scope 调用 `listParentSubagentAssemblies`。验证：discovery tests 覆盖顶层 local Agent 入全局 candidate set、父 Agent A 只返回 A 的 subagents、父 Agent B 不可见、EAGER 不发布 `PARENT`、SEARCH 只发布 `PARENT`。
- [x] 3.4 更新 capability subsystem composition：`CapabilitySubsystemOptions.agentDiscoverySource` 注入 builtin discovery、local EAGER discovery 和 local SEARCH discovery；`DefaultCapabilityDiscoveryFactory` 只创建 `builtin-agents/EAGER`、`local-agents/EAGER`、`local-agents/SEARCH` 三个 Agent discovery 实例。验证：composition tests 覆盖三实例注册，未注入 source 时返回 safe unavailable/empty evidence，注入后三类 Agent 进入正确 candidate path。
- [x] 3.5 保持 `agent-capability` 只定义最小 `AgentDiscoverySource` port，不 import `agent-app`、不 import assembly compiler、不 parse raw `agent.yaml`、不扫描 `agents/` 或 `subagents/`。验证：architecture tests / dependency-cruiser / source review 覆盖禁止依赖。

## 4. Descriptor Mapping 与 Registry Resolution

- [x] 4.1 将合法 Agent assembly 映射为 safe `CapabilityDescriptor(kind="AGENT")`：`capabilityId=AgentAssembly.agentId`、`version=AgentAssembly.agentVersion`、display/description 来自 safe facts、provider 使用 reserved identity。验证：discovery unit tests 覆盖 builtin、顶层 local Agent、parent subagent 三类 descriptor。
- [x] 4.2 descriptor 和 metadata 不暴露 raw package path、raw `agent.yaml`、prompt body、workspace path、secret、executor wiring、loading key、child assembly、`userInvocable`、`agentInvocation`。验证：descriptor safety tests 使用包含敏感字段的 source fixture 断言 public descriptor、safe error、diagnostics 均不泄露。
- [x] 4.3 定义后续执行 resolver 的唯一回查方式：Catalog 返回 descriptor 后，只能用 `AgentAssemblyRegistry.require(descriptor.capabilityId, descriptor.version)` 找回可信 assembly，并校验 identity/version。验证：focused resolver tests 覆盖 builtin、顶层 local Agent、parent subagent lookup，descriptor metadata 不包含 assembly 或 loading key。

## 5. Catalog Governance

- [x] 5.1 将 builtin Agent 与顶层 local Agent 作为全局 Catalog candidates 接入；它们只有被当前父 Agent 通过 explicit enabled `AGENT` binding 绑定，且目标 assembly `agentInvocation="BOUND"` 时，才进入 callable view。验证：Catalog tests 覆盖未绑定不可见、`BOUND` 绑定可见、`NONE` 绑定仍不可见。
- [x] 5.2 将当前父 Agent 的 parent-local subagent 通过 `local-agents` SEARCH discovery 自动纳入 request-scope candidate set；只接受 `agentInvocation="PARENT"`，且不写 synthetic `AgentAssembly.capabilityBindings`。验证：Catalog tests 覆盖本地 `PARENT` subagent 默认可见、显式 enabled binding 到 `PARENT` 不走 binding path、assembly snapshot 未增加 synthetic binding。
- [x] 5.3 explicit disabled `AGENT` binding 使用 `providerId + capabilityType=AGENT + capabilityId` 隐藏 parent-local subagent，并避免重复 descriptor。验证：Catalog `listAvailable` / `resolve` tests 覆盖 disabled hides、enabled does not duplicate。
- [x] 5.4 在 `AGENT` descriptor 进入 model-visible capability list 前完成 availability filter、conflict/shadowing 和 model visibility。验证：Catalog conflict tests 覆盖同父 Agent ambiguous descriptors 不可见，父 Agent A 的 shadowing 不污染父 Agent B。
- [x] 5.5 SEARCH criteria 只携带 trusted scope 和 optional narrowing，不携带 `AgentAssembly`、`capabilityBindings`、`boundCapabilityIds`、availability verdict、conflict result 或 routing decision。验证：contract/fake discovery tests 覆盖 criteria shape。

## 6. Prompt Disclosure

- [x] 6.1 在最新 prompt-template 基线上收敛 render-stage Agent disclosure：`DefaultModelInputRenderer` 从 `visibleCapabilities` 过滤 `AVAILABLE && modelInvocable=true && kind=AGENT`，在 `renderSystemPromptContent()` 输出之后、locale hint 之前追加 `### Available agents` / `### How to use agents`。验证：context prompt-shaping tests 覆盖有 Agent 时出现固定段落，无 Agent 时省略。
- [x] 6.2 `AGENT` descriptors 不进入 `RenderedModelInput.tools`，且不新增 `SystemPromptContext.enabledAgents`、`enabledAgents` template variable、invoked-agent list section 或任何 prompt-template Agent list 变量；现有 `enabledSkills` / `PromptTemplateRenderContext.enabledCapabilities` 不能成为 Agent list disclosure 通道。验证：prompt-template tests 覆盖模板不能绕过 renderer 提供当前 Agent list，`RenderedModelInput.tools` 不包含 `AGENT`，模板变量解析不支持 `enabledAgents` 或等价 Agent list 变量。
- [x] 6.3 更新 `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/agent-delegation.md`：基础 prompt 只能在 rendered `### Available agents` section 和具体 invocation mechanism 同时存在时指导委托，并要求只使用列表中的 Agent id；不得无条件要求使用 Agent tool 或暗示 execution 已可用。验证：prompt tests 覆盖无 Agent 时基础 prompt 不含无条件 `Use the Agent tool`；exact invocation syntax、child run semantics、result handling 仍后置。
- [x] 6.4 prompt disclosure 只使用 safe capability id 与 safe description/display facts，不泄露 provider id、raw path、source identity、loading key、prompt body、`userInvocable`、`agentInvocation` 或 child assembly。验证：prompt safety tests 覆盖敏感字段 fixture。

## 7. Canonical Builtin `network-explorer`

- [x] 7.1 在 `agent-core` builtin package 中定义 canonical builtin invoked-only Agent `network-explorer`，由 trusted app composition 经同一 Agent assembly compiler 生成 `AgentAssembly`，`userInvocable=false`、`agentInvocation="BOUND"`。默认 builtin Agent package 和 fallback assembly 必须通过 enabled `AGENT` binding 显式绑定 builtin `network-explorer`。验证：agent-app assembly tests 覆盖 compiled assembly、Catalog builtin descriptor、默认 builtin Agent 保留该 binding，以及 explicit binding 后 callable view。
- [x] 7.2 `network-explorer` 的 description 明确用于电信网络运行证据收集、检索、读取和上下文整理；builtin tools 默认可用，因此它的 `capabilityBindings` 只配置对副作用 builtin tools 的 `enabled=false` 禁用，不重复 enabled 默认 read/search tool。验证：assembly tests 覆盖 `write`、`bash`、`python`、`skill` 被禁用且无显式 enabled `read` / `glob` binding；negative tests 构造 write/config mutation/remediation/approval/shell/python/script/sandbox/deploy/ticket update 等副作用能力并断言 fail closed 或不发布 callable assembly。
- [x] 7.3 `network-explorer` 提供自己的 Agent-scoped `SYSTEM_PROMPT` template，并通过 context-engine prompt template registry 为 `network-explorer` 的 `agentId + agentVersion` 注册；builtin Agent prompt 注册必须从 `agent-core` trusted builtin Agent package/source records 和 package-local `prompts/` 目录派生，不在 app composition root 为每个 builtin Agent id 写一次硬编码注册；不得通过 `AgentAssembly.promptTemplateIds`、`AgentRuntimeSettings.defaultPromptTemplateId`、prompt root path、template ref list 或 runtime-facing prompt allowlist 字段表达。该模板只在 `network-explorer` 自己运行的后续 execution change 中渲染，不进入 parent Agent prompt disclosure 或 `CapabilityDescriptor` metadata。验证：prompt-template tests 覆盖 template 可注册/可编译，assembly safety tests 断言 runtime-facing `AgentAssembly` 不含 prompt allowlist/ref/path/body，descriptor/prompt safety tests 确认 prompt body 不泄露到父 Agent disclosure，source review 确认 `createComposedApp` 不按 Agent id 硬编码注册 builtin prompt。
- [x] 7.4 `network-explorer` prompt 主体覆盖 role、input contract、allowed actions、prohibited actions、output contract、safety and scope 六类要求。验证：prompt-template tests 断言编译后 prompt 包含六类 subject requirements，而不是只有泛化身份描述。

## 8. Diagnostics、Cancellation 与非执行边界

- [x] 8.1 实现 implementation-local safe diagnostics，覆盖 source unavailable、parent package unavailable、subagents root missing、candidate ignored、definition missing/invalid、duplicate rejected、shadowed、governance unavailable、registered 等 outcome。验证：focused diagnostics tests 覆盖每个 outcome code。
- [x] 8.2 diagnostics/log/safe error/readiness evidence 不暴露 raw path、prompt、secret、raw config、raw model output、package content、loading key 或 child assembly。验证：redaction tests 构造敏感 invalid fixture。
- [x] 8.3 cancellation 期间 `AgentDiscoverySource` work abort 后不得发布 candidate/descriptor，并记录 safe unavailable evidence。验证：focused RED/GREEN test 复现 abort during source work 后不发布 descriptor。
- [x] 8.4 local Agent readiness evidence 以 request/catalog-view scope 隔离，key 至少包含 `agentId + agentVersion + agentAssemblyRef + providerId + sourceScope + capabilityId + version`；同 scope 下一次 discovery 替换旧 view，不全局清理其他 scope。验证：focused tests 覆盖两个父 Agent 同名 subagent 不互相覆盖，以及同 scope 第二次 search 清理旧 evidence。
- [x] 8.5 discovery 不执行子 Agent、不创建 `RequestRun`、不写 session message/timeline/checkpoint/artifact/audit、不调用 model/tool/skill/sandbox。验证：no-side-effect tests 使用 spies/fakes 断言零调用；直接 invoke `AGENT` capability 在 executor 尚未实现时安全 unavailable/failed 且不创建 child run。
- [x] 8.6 `AGENT_REGISTRY` provider 在本 change 中保持 unsupported/unavailable，不获得远端 discovery 行为。验证：provider/discovery tests 覆盖 remote registry remains unsupported。

## 9. End-to-End 与代码整洁度

- [x] 9.1 补齐 production app composition 黑盒测试：父 Agent 绑定 `BOUND` builtin Agent、builtin 默认 Agent 通过配置绑定 builtin `network-explorer`、绑定 `BOUND` 顶层 local Agent，并自动包含本地 `PARENT` subagent 后，通过 Catalog 得到当前 Agent 可调用 Agent，prompt 只披露 governed `AVAILABLE && modelInvocable=true` descriptors。验证：app-level/context tests 断言 prompt 包含可调用 Agent，且不包含未绑定 builtin/local 顶层 Agent、`NONE` Agent、显式绑定的 `PARENT` Agent、disabled local subagent 或敏感内部字段。
- [x] 9.2 删除旧 Agent discovery 双轨和冗余代码：移除或折叠 `local-agents-parent-owned`、`localAgentsParentOwnedProvider`、`LocalAgentCapabilityDiscovery`、`BuiltinAgentCandidate`、`LocalAgentPackageCandidate`、`subagentPackageLocator`、`AgentPackageSourceLocator.listSubagentPackages`、`AgentPackageSourceLocator.locateSubagentPackage` 的 Agent discovery 生产路径。验证：`rg -n "local-agents-parent-owned|localAgentsParentOwnedProvider|LocalAgentCapabilityDiscovery|BuiltinAgentCandidate|LocalAgentPackageCandidate|subagentPackageLocator|listSubagentPackages|locateSubagentPackage" packages/agent-app/src packages/agent-capability/src packages/agent-contracts/src` 无生产命中；`AgentPackageSourceLocator.locate` 仅可继续服务 local Skill package locating。
- [x] 9.3 防止通过新名字重建第二套路径：不得新增 `SubagentDiscoverySource`、`SubagentDescriptor`、`InvokedAgentAssembly`、builtin-only assembly DTO、subagent-only assembly DTO、capability 之外的 Agent catalog 或 unused compatibility adapter。验证：architecture/source review 确认只有一个 `BuiltinAgentDiscovery`、一个 `LocalAgentDiscovery` class，Agent discovery 只消费 `AgentDiscoverySource`。
- [x] 9.4 清理本 change 产生的 unused export、重复 DTO、重复 helper、test-only fixture 泄漏、临时 fake、dead helper 和 compatibility adapter。验证：`npm run build`、相关 focused tests、`npm run lint:architecture` 无 unused/export/architecture failure，diff review 确认触达范围代码更整洁。

## 10. 验证门禁

- [x] 10.1 运行 OpenSpec 验证。验证：`openspec.cmd validate add-ts-invoked-agent-discovery --strict`。
- [x] 10.2 运行 focused tests，覆盖 assembly/source、provider config、builtin discovery、local EAGER/SEARCH discovery、descriptor safety、registry resolution、Catalog visibility、binding disable、conflict/shadowing、SEARCH criteria、prompt disclosure、`network-explorer` prompt、diagnostics、cancellation 和 no-side-effect。验证：记录具体 `npm test -- <files>` 或 `npx vitest run <files>` 命令与结果。
- [x] 10.3 运行标准质量门禁。验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- [x] 10.4 push 前按仓库要求运行 `$nextagent-code-review`，覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency 和 Clean Code。验证：检视结论为 PASS 或 PASS WITH FOLLOW-UP；P0/P1 必须修复后重新检视。

## 归档前基线更新检查（非实施任务）

实现完成并验证通过后，归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/invoked-agent-discovery/spec.md`。
- 按需更新 `openspec/specs/agent-package-assembly/spec.md` 和 `openspec/specs/capability-catalog/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/capability-spi.md`；`core-contracts.md` 已允许 `AGENT` binding，仅需在归档检查中确认实现对齐。
- 按需更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/modules/agent-capability.md`。
- 如实施中产生长期取舍，新增或更新 `openspec/designs/adr/<id>.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 Agent capability discovery、subagent layout、Catalog governance、binding semantics、`AgentDiscoverySource` 或 descriptor-to-registry resolution。
