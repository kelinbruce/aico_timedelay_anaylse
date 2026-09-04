## 1. Capability contribution SPI 与装配骨架

- [x] 1.1 在 `agent-contracts/capability` 定义并 public export `CapabilityProviderContribution`，并迁移/export `CapabilityDiscovery`、`CapabilityExecutor` 及其 public method signature 需要的 support types（如 `CapabilitySearchCriteria`、`SkillScanEvidenceItem`、`ToolExecutableDiscovery`、`ExecutableTool`）；在 `agent-capability` 实现 contribution validation 和由 `agent-capability` 拥有的 frozen snapshot assembly。
  验证：`npm run build` 确认 `@nextagent/agent-contracts/capability` 可被 owner package import；新增 `packages/agent-capability/tests/extension-registration.test.ts` 覆盖 provider 唯一性、contribution/discovery/descriptor provider 一致性、重复 provider id 和非法 contribution 的 blocking readiness outcome；运行 `npm test -- --run packages/agent-capability/tests/extension-registration.test.ts`
  来源：Requirement: Startup capability provider contributions are owner-owned startup facts；D1
- [x] 1.2 将 `CapabilityDiscovery` public SPI 迁移到 `agent-contracts/capability` 并保持 provider-bound：保留 public `provider` 字段和 public `discoveryMode` 字段，catalog 继续消费 provider-bound discovery；contribution assembly 负责校验 `contribution.provider == discovery.provider`，本 task 不删除 discovery provider。
  验证：`npm run build`；`packages/agent-capability/tests/catalog.test.ts` 与 `packages/agent-capability/tests/conflict-resolution.test.ts`
  来源：Requirement: Capability provider discovery and executor support are registered with provider contributions；D2、D3
- [x] 1.3 将 `CapabilityExecutor` public SPI 迁移到 `agent-contracts/capability` 并调整为 provider-neutral：删除 executor public `provider` 字段，并将 invocation executor factory 改为消费 `agent-capability` 内部 provider-aware executor lookup table。
  验证：`npm run build`；`packages/agent-capability/tests/tool-framework.test.ts` 覆盖 provider-aware executor lookup；新增 provider consistency test 断言 executor lookup 使用 catalog-selected provider/capability pair
  来源：Requirement: Capability provider discovery and executor support are registered with provider contributions；D2、D4
- [x] 1.4 增加 request-time immutability 测试，证明 internal/config-driven/external contribution assembly 只在 startup/subsystem composition 阶段运行。
  验证：新增 `packages/agent-capability/tests/extension-registration.test.ts` 用计数 factory 断言 `catalog.listAvailable` / `invocationPort.invoke` 不重建 contribution
  来源：Requirement: Extension registration is deterministic, startup-only, and frozen；D7
- [x] 1.5 移除 discovery factory 的跨模块 public contract：从 `CapabilitySubsystemOptions` 移除 `discoveryFactory`，从 package public exports 移除 `CapabilityDiscoveryFactory` / `createDefaultCapabilityDiscoveryFactory`，并移除 `agent-app` 的 `capabilityDiscoveryFactory` option 和注入。
  验证：`npm run build`；architecture/source test 断言 `agent-app` 不 import `CapabilityDiscoveryFactory` 且不传入 `discoveryFactory`
  来源：D5；Requirement: Startup capability provider contributions are owner-owned startup facts

## 2. Builtin capability contributions

- [x] 2.1 将 builtin tools provider 组装为 `agent-capability` internal `CapabilityProviderContribution`，通过 `agent-capability` owner-local stable list（当前 `builtinToolDefinitions`）构造 ToolCatalog discovery 和默认 Tool executor 进入 catalog/invocation；stable list 保持在 owning package 内部管理。
  验证：`npm test -- --run packages/agent-capability/tests/tool-framework.test.ts packages/agent-capability/tests/extension-registration.test.ts`
  来源：Requirement: Builtin capability contributions are owner-owned startup facts；D6
- [x] 2.2 新增测试 Tool contribution，不编辑 `agent-app` 即可通过 `agent-capability` internal assembly 被 catalog list 并 invoke。
  验证：运行 `npm test -- --run packages/agent-capability/tests/extension-registration.test.ts`
  来源：Requirement: Builtin capability contributions are owner-owned startup facts；D1、D4
- [x] 2.3 将 builtin Skill、builtin Agent、local Skill 和 local Agent discovery 迁移为 `agent-capability` internal provider contributions。
  验证：`packages/agent-capability/tests/builtin-skill-source.test.ts`、`packages/agent-capability/tests/local-skill-source.test.ts`、`packages/agent-capability/tests/invoked-agent-discovery.test.ts`
  来源：Requirement: Startup capability provider contributions are owner-owned startup facts；D5
- [x] 2.4 按本 change 的 `invoked-agent-discovery` active spec delta，将 `local-agents` 拆分为 `local-agents`（EAGER discovery：顶层 local agents）和 `local-subagents`（SEARCH discovery：parent-scoped subagents）两个 reserved provider contribution，每个 discovery 只支持一种 mode，并确保 Agent binding 和 routing constraints 分别适配两个 provider identity。
  验证：`packages/agent-capability/tests/invoked-agent-discovery.test.ts` 覆盖 top-level local Agent 和 parent subagent discovery；`openspec validate refine-ts-extension-registration --strict`
  来源：D3；Requirement: Extension registration does not redefine execution semantics；Requirement: Subagents Are Discovered As Governed Agent Capabilities

## 3. Config-driven provider 和 executor 默认规则

- [x] 3.1 将 Clip、SkillHub 和用户配置型 provider 装配路径迁移为 `agent-capability` config-driven contribution assembly 输出，`agent-app` 不直接组装 discovery/executor 实例；`clipCommandRunner`、`clipDiagnostics`、`clipcDisclosureMode`、`skillHubRemoteAccessFactory`、`skillHubSourceAuthorization` 等运行时依赖仍由 `agent-app` 注入给 `createCapabilitySubsystem()`。
  验证：`packages/agent-capability/tests/clip-tool-source.test.ts`、`packages/agent-capability/tests/skillhub-source.test.ts`、`tests/capability-source-configuration/source-config.test.ts`
  来源：Requirement: Startup capability provider contributions are owner-owned startup facts；D5
- [x] 3.2 实现安全默认 executor 推导规则：只有 provider-bound `ToolExecutableDiscovery` 可默认得到 Tool executor；默认 executor 绑定时校验 contribution provider、discovery provider 和 descriptor provider 一致。
  验证：新增 executable-interface test：`kind=TOOL` descriptor 只有在 discovery 暴露 executable interface 时得到默认 executor；运行 `packages/agent-capability/tests/extension-registration.test.ts`
  来源：Requirement: Capability provider discovery and executor support are registered with provider contributions；D4
- [x] 3.3 更新 reserved provider validation，framework/reserved providers 由 trusted startup contributions 声明，用户 raw capability provider config 继续只声明 user-configured providers。
  验证：`tests/capability-source-configuration/source-config.test.ts` 覆盖 builtin/local/memory/agent reserved provider validation blocking outcome
  来源：Requirement: Startup capability provider contributions are owner-owned startup facts；Requirement: Extension registration failures are safe and explicit
- [x] 3.4 确保 discovery/executor absence、duplicate provider、duplicate capability、provider consistency failure 产生唯一 outcome：assembly 记录 safe diagnostic；缺 executor 的 executable descriptor 在 catalog 中 unavailable；调用该 descriptor 时返回 safe failure。
  验证：`packages/agent-capability/tests/extension-registration.test.ts` validation cases 实际触发该 outcome sequence，并断言 safe reason code 只包含 bounded safe fields
  来源：Requirement: Extension registration failures are safe and explicit；D4

## 4. App composition 收敛

- [x] 4.1 更新 `createCapabilitySubsystem()` 入参和实现：将旧的 `createCapabilitySubsystem(providerConfigs, options)` 双参数形态收敛为单一 options object；移除 `appToolCatalogs`，新增 `providerConfigs` 和 `externalContributions`，内部创建 internal/config-driven contributions、合并 externalContributions，并返回 `catalog`、`invocationPort`、`capabilityProviders`、`validateStartupRegistration()`、`collectSkillScanReport()` 以及需要由 app 注册到 runtime/scheduler 的 owner-provided cleanup/maintenance hooks 或 jobs；不得返回 `workspaceFiles`、独立 diagnostics 字段、provider configs、contribution snapshot、discovery 或 executor。
  验证：`packages/agent-capability/tests/runtime-capability-resolver-contract.test.ts`、`packages/agent-capability/tests/executable-facts.test.ts`；新增/更新 extension registration test 断言新增 framework/reserved contribution 的 `CapabilityProvider` fact 由 `capabilitySubsystem.capabilityProviders` 暴露，且 workspaceFiles/diagnostics/snapshot 不在 public return surface；run terminal cleanup 通过 capability-owned hook/job 触发而不是暴露 port
  来源：D3、D4、D7
- [x] 4.2 更新 `agent-memory` public export，提供 owner-owned `createMemoryToolsProviderContribution(...)` factory 返回 `CapabilityProviderContribution`；`agent-app` 调用该 owner factory 并把结果作为 externalContributions 传入，memory ToolCatalog construction 保持在 `agent-memory` owner boundary。
  验证：`packages/agent-memory/tests/memory-tools-provider.test.ts` 覆盖 owner factory provider identity/discovery；`tests/architecture/capability-source-configuration.test.ts` 断言 `agent-app` composition 调用 `createMemoryToolsProviderContribution` 并通过 `externalContributions` 传入 capability subsystem；`tests/agent-kernel/memory-runtime-integration.test.ts` 覆盖生产 app composition 下 `memory-tools` 可按配置进入模型可见 Tool 和 capability invocation 路径
  来源：D5、D7；Requirement: Startup capability provider contributions are owner-owned startup facts
- [x] 4.3 更新 `agent-app` startup composition：只传入配置、adapter/options 和 externalContributions；`agent-app` 不 import、创建、持有或调用 WorkspaceFilePort，不实现 workspace cleanup、snapshot invalidation、sandbox filesystem mount 或 Python temp script preparation 语义；AgentAssembly 装配阶段只做格式/结构安全校验，不消费 provider identity facts、model profile readiness、hook definitions、routing target 或 capability catalog descriptor；不调用 `agent-capability` internal provider contribution helpers。
  验证：`tests/agent-kernel/config-assembly.test.ts` 覆盖缺失 provider/model/hook/routing target 不阻断 AgentAssembly 结构物化；architecture/source test 断言 `agent-app` 不使用 capability internal contribution helpers，不包含 `WorkspaceFilePort`/`createWorkspaceFilePort`/`.clearRun(` / `.sandboxFilesystem(` / `.resolveView(`，并且 cleanup/runtime 只注册 capability owner 暴露的 cleanup hook/job
  来源：Requirement: Extension registration is deterministic, startup-only, and frozen；D7
- [x] 4.4 移除 app-owned framework/reserved provider 清单作为权威来源。
  验证：architecture/source test 断言 `agent-app` 不硬编码或手写列举 `builtinToolsProvider`、`builtinSkillsProvider`、`builtinAgentsProvider`、`localAgentsProvider`、`localSubagentsProvider`、`localSkillsSystemProvider`、`localSkillsAgentOwnedProvider`、`memoryToolsProvider` 作为 startup provider registry 权威输入；startup provider registry 输入来自 `capabilitySubsystem.capabilityProviders`；`npm run lint:architecture`
  来源：Requirement: Startup capability provider contributions are owner-owned startup facts；proposal 黑盒成功标准
- [x] 4.5 新增 app ready gate startup graph validation：在 capability/resource/hook/workflow 等 startup resources 装配完成后，统一校验所有 AgentAssembly 的 active agent、user-invocable、model profile、capability provider、lifecycle hook、routing target、Agent binding visibility、parent scope 和 invocation policy；失败时 app start fail-closed，未进入 ready。
  验证：`tests/agent-kernel/config-assembly.test.ts` 或新增 startup graph validation test 覆盖缺失 provider、缺失/disabled model profile、未知 hook、非法 hook order、非法 routing target、非法 subagent parent scope 均在 ready gate 阶段失败；server/runtime 不启动请求路径；app 不重复实现 capability-owned contribution validation
  来源：Requirement: Extension registration is deterministic, startup-only, and frozen；D7
- [x] 4.6 将 sandbox Tool port assembly 和 workspace-backed sandbox request preparation 收敛到 `agent-capability` owner boundary：`agent-app` 只传 sandbox gateway execute adapter、risk policy evaluator、logger/runtime facts 等组合输入；`agent-capability` 负责通过 capability-owned WorkspaceFilePort 生成 sandbox filesystem、Python temp script submission 和 safe error mapping。
  验证：unit/architecture tests 覆盖 bash/python sandbox tool 仍可执行，Python inline command 仍写入 temp root，`agent-app` 不调用 WorkspaceFilePort 方法且不包含 Python temp script preparation 细节；sandbox gateway/local package 仍不依赖 capability implementation private path
  来源：Requirement: Extension registration does not redefine execution semantics；D7

## 5. 架构和端到端验证

- [x] 5.1 增加 registry immutability 测试：请求体、client metadata、Skill 内容和运行中文件变化后的 registry snapshot 仍等于启动期 frozen contribution snapshot。
  验证：新增 integration/contract immutability tests 实际提交 contribution-like payload 并断言 registry snapshot 保持不变
  来源：Requirement: Extension registration is deterministic, startup-only, and frozen
- [x] 5.2 增加 builtin Tool 黑盒测试：新增测试 contribution 不编辑 `agent-app` 即可通过 `agent-capability` internal assembly 发现并调用。
  验证：`packages/agent-capability/tests/extension-registration.test.ts`
  来源：Requirement: Builtin capability contributions are owner-owned startup facts
- [x] 5.3 增加 reserved provider validation 黑盒测试。
  验证：`tests/capability-source-configuration/source-config.test.ts`
  来源：Requirement: Startup capability provider contributions are owner-owned startup facts
- [x] 5.4 增加 architecture tests：`agent-app` 不 private-import capability provider internals；runtime/core/context 不依赖 contribution implementation package；`agent-app` 不维护 framework/reserved provider 清单；AgentAssembly 结构物化不得依赖 capability provider facts；CapabilitySubsystem public return surface 不暴露 workspaceFiles、diagnostics 字段、contribution snapshot、discovery 或 executor；`agent-app` 不 import/create/call `WorkspaceFilePort`，不直接实现 workspace cleanup、sandbox filesystem preparation 或 Python temp script preparation。
  验证：`npm run lint:architecture`；必要时新增 `tests/architecture/*extension-registration*.test.ts`
  来源：D7；Requirement: Extension registration does not redefine execution semantics
- [x] 5.5 增加 startup graph validation 黑盒测试：证明 AgentAssembly 可先结构物化，依赖 AgentAssembly 的 Agent discovery/capability subsystem 可随后装配，最终 ready gate 基于 `capabilitySubsystem.capabilityProviders` 和其他 startup resource facts 阻断非法 graph。
  验证：新增/更新 `tests/agent-kernel/config-assembly.test.ts`、`tests/agent-kernel/invoked-agent-discovery-config.test.ts`、`tests/architecture/capability-source-configuration.test.ts`
  来源：Requirement: Extension registration is deterministic, startup-only, and frozen；Requirement: Subagents Are Discovered As Governed Agent Capabilities
- [x] 5.6 运行全量相关验证并记录结果。
  验证：`openspec validate refine-ts-extension-registration --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：本 change 全部规格和设计约束

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/extension-registration/spec.md`。
- 按需更新 `openspec/specs/builtin-tool-framework/spec.md`、`openspec/specs/capability-catalog/spec.md`、`openspec/specs/capability-source-configuration/spec.md`、`openspec/specs/app-config-schema/spec.md`、`openspec/specs/invoked-agent-discovery/spec.md`。
- 按需更新 `openspec/designs/architecture/capability-spi.md`、`openspec/designs/architecture/configuration-boundary.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`、`openspec/designs/modules/agent-app.md`。
- 如保留长期取舍理由，新增或更新 ADR。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 SPI、provider lifecycle 或 execution routing 语义。
