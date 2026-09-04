## 背景与问题

NextAgent 已经具备统一 Capability Catalog、Skill manifest contract、builtin Skill source、local Skill source、capability source configuration 和 `Skill` Tool 执行边界。系统仍缺少 SkillHub 作为远端 Skill source 的目标态规格：远端 Skill 候选如何按当前 Agent scope 查询、如何下载到受管理安装区、如何通过统一 `SKILL.md` 校验后进入 catalog，以及如何避免远端响应、下载地址、凭据或本地安装细节泄漏到模型上下文、stream、日志或 public descriptor。

这个缺口会带来两个风险：

1. 远端 SkillHub 候选可能被误当成已安装、可执行的 Skill capability，绕过统一 manifest validation、catalog governance 和 `SkillSourceDiscovery` body loading 边界。
2. SkillHub 网络访问、credential、download package 和 managed install 可能散落到 `agent-capability`、runtime、core 或 context path 中，形成第二套 source/invocation 语义。

本 change 的目标是把 SkillHub 定义为一种受治理的远端 Skill source：远端状态不是 catalog 状态。只有已经下载、安装、校验并通过统一 catalog governance 的 SkillHub package，才能贡献 `SKILL` descriptor，并通过现有 `Skill` Tool 路径加载执行。

## 黑盒需求

从使用者和系统集成视角，本 change 需要达成以下行为：

1. 部署者可以通过 capability provider configuration 启用 `SKILL_HUB` provider，配置 endpoint、credential reference 和 managed install root。
2. 系统在 core 通过 request-scope catalog path 加载当前 Agent 的可用 Skill 列表时，必须在可信 Agent Scope 下同步 refresh SkillHub；远端 list/search 和 package download 必须携带可信 `agentId`、`agentVersion` 和 assembly scope，不得使用客户端 payload、模型输出或 capability 参数覆盖。
3. SkillHub 返回的远端候选不会直接进入 Capability Catalog；候选只有在 package 下载、managed install、结构校验、`SKILL.md` manifest 校验和 catalog governance 都通过后，才成为当前 Agent 可见的 Skill candidate。
4. 已安装并通过治理的 SkillHub Skill 使用 `providerKind=SKILL_HUB` 的 `CapabilityDescriptor`，复用统一 Skill manifest、catalog、model visibility 和 `Skill` Tool body loading path。
5. SkillHub refresh、candidate metadata、download、install、manifest 和 governance 失败必须安全可诊断；失败不得阻塞 builtin、system-local 或 Agent-owned local Skill source。
6. raw credential、remote response、download URL、managed install absolute path、package internal layout、source-owned loading key、full Skill body 和 raw manifest content 不得进入 descriptor、metadata、model context、stream、Web response、safe error、audit、metric 或日志。

## 目标方案

本 change 固定以下目标方案：

1. SkillHub provider 使用现有 `CapabilityProviderKind=SKILL_HUB`；provider id 来自用户 capability provider configuration，并通过 app composition 校验、冻结和注册。
2. SkillHub provider options 复用现有 `SkillHubOptions`：`endpoint`、`credentialRef?`、`managedInstallRef`。`credentialRef` 必须是已冻结的 `SecretReference`，raw token 不进入产品配置或下游模块。
3. SkillHub 网络访问通过 remote gateway boundary 完成。`agent-capability` 拥有一个 SkillHub 专用、implementation-local 的 remote access port，不新增 `agent-contracts/gateway` public port；`agent-capability` 不直接调用 `fetch`、HTTP SDK 或远端服务 SDK。remote adapter 实现在 `agent-platform-gateway-remote`，但 `agent-platform-gateway-remote` 不导入 `agent-capability`；默认 product `agent-app` composition 提供内置 fetch-based SkillHub remote adapter factory，并把选中的 remote adapter/factory 包装为 `agent-capability` 的 remote access port 后注入。
4. SkillHub 首版只支持在 request-scope catalog 加载当前 Agent 可用 Skill 列表时同步 refresh，不支持 TTL 自动刷新、后台轮询、watcher、marketplace UI、远端直接执行或 package signature verification。
5. Refresh 使用 trusted Agent search scope：`tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef` 和可选 requested Skill narrowing。远端返回结果必须先作为候选元数据处理，不得直接成为 catalog descriptor。
6. Package download 结果必须安装到 provider-owned managed install root。首版只接受包根目录 `SKILL.md` 单文件 Skill；`scripts/`、`references/`、`assets/` 等嵌套资源树留待后续 change。解包和安装必须拒绝 path traversal、absolute path、unsafe candidate name、缺失 `SKILL.md`、非法 manifest、超出大小/文件数量预算和不安全文本内容。
7. 已安装 package 形成 `agent-capability` owned、provider-private 的 managed install index/loading facts。该 index 是本地安装缓存，不进入 gateway durable store 或 `agent-contracts`；descriptor 只携带统一 capability descriptor 和 `SkillMetadata` 允许的安全事实。
8. SkillHub source discovery 使用现有 `CapabilityDiscovery` 和 implementation-local `SkillSourceDiscovery` 能力面；调用期 body loading 继续由 `Skill` Tool 在 catalog resolve 和授权之后，通过已注册 source/discovery 的 `loadCanonicalBodyView(...)` 完成。
9. Catalog governance 继续拥有 final availability、explicit disabled binding、model visibility、conflict/shadowing 和 invocation eligibility。SkillHub 不创建第二套 catalog、discovery 或 invocation contract。
10. SkillHub diagnostics/readiness evidence 是 implementation-local safe evidence，不新增 Web API、stream event、audit schema、metric schema 或 public readiness DTO。

### Authorization boundary refinement

SkillHub is a remote Skill source, not an authorization source. A configured `SKILL_HUB` provider does not automatically authorize any Agent to search or use that provider. The current Agent must have local source authorization for the provider/source, owned by trusted app composition, Agent package or compiled Agent assembly facts. The first release requires at least provider-level authorization by `agentId + providerId`; narrower local constraints such as `skillIds`, namespace, publisher, package hash or signature/trust facts may be added without trusting remote response as authorization.

Remote candidate facts, remote-returned Agent fields and provider-private installed index/loading facts are consistency and cache inputs only. They MUST NOT grant or expand Agent authorization. Catalog owns final visibility and execution authorization; SkillHub source owns candidate/loading fact dereference. Invocation-time body loading only verifies governed descriptor/source/body consistency and MUST NOT become a second authorization boundary.

Startup/readiness MUST only validate and register SkillHub provider configuration and dependencies. Startup/readiness MUST NOT refresh remote SkillHub state, download packages, mutate installed indexes or change catalog visibility.

## 规格变化

本 change 新增 `skillhub-source` capability 规格，定义以下契约：

1. SkillHub provider configuration、registration 和 adapter injection 边界。
2. SkillHub 在 request-scope catalog list/resolve 阶段同步 refresh 的 trusted Agent Scope 输入和远端 gateway 访问边界。
3. Remote metadata/list/search 与 installed catalog state 的分离。
4. Package download、managed install、safe extraction 和 manifest validation 行为。
5. SkillHub source 如何复用 `SkillDocumentService`、`CapabilityDiscovery`、`SkillSourceDiscovery`、`CapabilityCatalog` 和 `Skill` Tool execution path。
6. SkillHub candidate 的 catalog governance、disabled binding、model visibility 和 conflict/shadowing 行为。
7. SkillHub safe diagnostics、redaction 和 failure behavior。

## 影响范围

1. `agent-capability`：新增 SkillHub discovery/source implementation、catalog-triggered synchronous refresh boundary、managed install scan、safe diagnostics、source-owned loading facts 和 tests。
2. `agent-platform-gateway-remote`：新增或实现 SkillHub remote gateway adapter/factory boundary，隔离 HTTP、remote service wire DTO、credential resolution 和 failure normalization；不得导入 `agent-capability` 或实现 package-private capability SPI。
3. `agent-app`：消费 capability provider configuration，使用默认内置 fetch-based SkillHub remote adapter factory 或测试/特殊宿主显式覆盖的 factory，校验 `SKILL_HUB` provider adapter 可用性、credential reference、managed install reference，注册 provider，并把选中的 remote adapter/factory 包装为 `agent-capability` owned remote access port 后注入 capability subsystem。
4. `agent-contracts`：复用现有 `CapabilityProviderConfig`、`SkillHubOptions`、`CapabilityCatalog`、`CapabilityDescriptor` 和 `CapabilityInvocation*` surface，不修改 public capability contracts。Agent/Owner scope matching 必须在 refresh、install、discovery 和 request-scope catalog governance 阶段完成；授权后的 body loading 不新增 runtime scope carrier，不把 trusted `agentAssemblyRef` 或 tenant/subject/agent scope 加入 public DTO、descriptor metadata、gateway contract、Web response 或 invocation-time body loading input。本 change 不新增 SkillHub remote gateway public port、managed install Record 或 public readiness DTO。
5. `agent-runtime`、`agent-core`、`agent-context-engine`：只消费 catalog governed view 和现有 Skill Tool result，不直接访问 SkillHub endpoint、remote gateway、managed install root 或 package files。

## 非目标与边界约束

本 change 不定义以下内容：

1. Skill inline/fork execution 语义、nested invocation、prompt injection、sandbox execution、audit schema、idempotency 或 stream event。
2. SkillHub package signature verification、trust chain、publisher reputation、license policy 或 vulnerability scanning；首版只做结构、安全和 manifest 校验。
3. TTL 自动 refresh、后台轮询、filesystem watcher、hot reload、marketplace browsing UI、Web API 或用户交互安装流程。
4. 远端 Skill 直接执行、远端 body streaming 或未安装 Skill 的临时执行。
5. 新的 public capability descriptor、catalog、invocation 或 readiness DTO/schema。
6. 通过客户端请求、模型输出、Skill manifest metadata、descriptor metadata 或 capability arguments 控制 endpoint、credential、managed install root、Agent scope 或 provider registration。

## 并行边界

1. 本 change 复用 `add-ts-skill-tool` 的 Skill execution 和 body loading contract，不修改 `Skill` Tool schema 或 result semantics。
2. 本 change 复用 `add-ts-local-skill-source` 的 source-owned loading facts 和 safe diagnostics 原则，但不把 `SKILL_HUB` 实现为普通 `LOCAL_DIRECTORY` provider。
3. 本 change 复用 `add-ts-capability-source-configuration` 的 provider config 和 secret boundary，不重新定义 app config schema 或 credential grammar。
4. 其他 provider/source changes 不得为 SkillHub 创建第二套 catalog、manifest parser、invocation result 或 model-visible disclosure path。
