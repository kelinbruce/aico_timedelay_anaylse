## 背景和现状

当前稳定基线已经提供了 SkillHub source 可以复用的边界：

1. `CapabilityProviderKind` 已包含 `SKILL_HUB`。
2. `CapabilityProviderConfig` 已包含 `SkillHubOptions`：`endpoint`、`credentialRef?`、`managedInstallRef`。
3. `SkillDocumentService` 是 `SKILL.md` manifest 和 canonical body slicing 的单一 implementation owner。
4. `CapabilityDiscovery` / `CapabilityCatalog` 已承担 descriptor discovery、request-scope governed view、`modelInvocable` filtering、explicit binding 和 conflict/shadowing。
5. `SkillSourceDiscovery` 已定义调用期 body loading handoff，`Skill` Tool 通过 resolved descriptor provider id 找到已注册 source/discovery，再加载 canonical body。
6. `agent-platform-gateway-remote` 是 remote gateway adapter skeleton 和 remote service boundary owner。

本 change 要补齐的是具体 SkillHub source：如何从远端 SkillHub 获取 Agent-scoped candidates，如何下载并安装 package，如何把 installed package 作为受治理 Skill source 贡献到 catalog，以及如何保证 remote facts 与 catalog facts 分离。

## 目标和非目标

**目标：**

- 支持 `SKILL_HUB` provider configuration 通过 app composition 校验并注册。
- 支持在 request-scope catalog 加载可用 Skill 列表时同步触发 SkillHub remote list/search 和 package download。
- Refresh request 使用 trusted Agent Scope 和 Owner Scope，不接受客户端、模型或 capability 参数覆盖。
- 下载 package 安装到 provider-owned managed install root。
- installed package 通过 safe extraction、package structure、candidate name、`SKILL.md` manifest 和 content boundary 校验后才进入 catalog candidate set。
- SkillHub installed Skills 复用标准 manifest parser/mapper、`CapabilityDescriptor`、`SkillMetadata`、`CapabilityCatalog`、`SkillSourceDiscovery` 和 `Skill` Tool execution path。
- SkillHub source 只暴露 safe descriptor facts 和 safe diagnostics，不暴露 remote/provider/private loading facts。

**非目标：**

- 不实现 automatic refresh TTL、background sync、watcher、hot reload 或 marketplace UI。
- 不实现 package signature verification、trust chain、publisher policy 或 license enforcement。
- 不实现 remote Skill direct execution、remote body streaming 或 uninstalled candidate execution。
- 不定义新的 Skill execution semantics、audit schema、stream event、Web API 或 sandbox behavior。
- 不引入 generic plugin/source framework。

## 设计决策

### D1: Provider identity and configuration

SkillHub provider 使用 `providerKind=SKILL_HUB`。Provider id 来自 user-facing capability provider configuration，并在 app composition 阶段校验：

1. provider id 必须非空、唯一，且不得占用 framework/reserved provider id，例如 `builtin-tools`、`builtin-skills`、`local-skills-system`、`local-skills-agent-owned`。
2. `endpoint` 必须是安全、非空、可解析的 http(s) endpoint。
3. `credentialRef` 如存在，必须是 `env:` 或 `file:` `SecretReference`，并在 ready 前通过 app-owned secret validation。
4. `managedInstallRef` 必须解析为 provider-owned managed install root；该 root 只作为 frozen runtime source fact 注入 SkillHub source，不暴露给 model、stream、safe error 或 descriptor。
5. 默认 product app composition 必须提供内置 fetch-based `SKILL_HUB` adapter factory；测试或特殊宿主可以显式覆盖该 factory。只有选中的 adapter factory 真的不可用或无法构造 provider adapter 时，provider configuration 才产生 safe diagnostic，且不贡献 executable descriptor。
6. 首版 SkillHub 只支持具备 remote gateway adapter 的宿主。local-only 宿主或任何无法提供选中 SkillHub adapter 的宿主必须对该 provider fail closed；本地 managed install cache 不能单独构成“支持 SkillHub”的宿主能力。

`default-system.yaml` 不声明具体 SkillHub provider。用户通过 `adnclaw.system.capability-providers` 增加 `type=skill-hub` provider。App composition 把 user-facing config 解析为 capability-owned `CapabilityProviderConfig`，选择默认内置 fetch-based adapter factory 或测试/特殊宿主覆盖的 factory，并向 capability subsystem 注入 remote gateway dependency。

### D2: Remote gateway boundary

**SkillHub package v1 boundary.** SkillHub package v1 uses a fixed zip archive payload. The remote adapter may choose any wire representation internally, but the adapter-to-capability port MUST return opaque package bytes plus safe optional package version/hash facts, not a pre-expanded list of file contents. Zip parsing, safe extraction and managed install are owned by `agent-capability`; remote adapter packages only own HTTP, credential resolution, wire DTO validation and safe failure normalization.

SkillHub 网络访问由 remote gateway boundary 执行，但调用抽象由 `agent-capability` owning。`agent-capability` 定义一个 SkillHub 专用、implementation-local 的 remote access port（例如 `SkillHubRemoteAccessPort`）作为窄 SPI；该 port 不进入 `agent-contracts/gateway`，也不作为 public gateway contract 暴露。`agent-platform-gateway-remote` 只暴露自身的 remote adapter/factory，不导入 `agent-capability`，也不直接实现 capability package-private SPI。默认 product `agent-app` composition 同时依赖 `agent-capability` 和 `agent-platform-gateway-remote`，负责提供内置 fetch-based adapter factory，把选中的 remote adapter/factory 包装为 `SkillHubRemoteAccessPort` 形状并注入 capability subsystem；测试或特殊宿主可以显式覆盖该 factory。`agent-capability` 不直接使用 `fetch`、HTTP client、remote SDK 类型、remote wire DTO 或 endpoint credential。

该边界同时明确排除 local-only SkillHub 模式：如果宿主不能提供选中的 remote adapter，就必须在 app composition 阶段把该 provider 判为 unavailable/disabled，而不是继续读取 provider-private managed install root、预置缓存或 package 文件来贡献 SkillHub descriptors。

SkillHub remote access port 只表达 capability source 所需的 safe shape：

1. 输入只接收 frozen provider facts、trusted Agent/Owner scope、可选 requested capability narrowing 和 cancellation signal。
2. 输出只返回 schema-validated candidate metadata、package bytes/ref 或 safe failure outcome。
3. safe failure outcome 必须覆盖 unavailable、timeout、authorization failure、invalid response 和 download failure。
4. port shape 不包含 raw credential、raw endpoint token、download URL、remote stack、provider SDK type 或 adapter-private wire DTO。
5. Package download request MUST carry the same trusted `tenantId`, `subjectId`, `agentId`, `agentVersion` and `agentAssemblyRef` scope as list/search, plus `packageRef`; app-owned adapter wrappers MUST NOT drop or recompute those scope fields.

Remote adapter implementation 负责：

1. 将 frozen endpoint 和 credential reference 解析为一次远端请求可用的 adapter input。
2. 执行 list/search 和 package download。
3. 映射远端不可用、timeout、authorization failure、invalid response 和 download failure 为 safe result。
4. 保证 raw token、raw remote response、remote stack、download URL 和 provider SDK types 不越过 gateway/adapter boundary。
5. 保证 package download wire request 使用 app/capability 注入的 trusted Agent/Owner scope，而不是只使用 unscoped `packageRef`。
6. 不导入 `agent-capability`、不依赖 `SkillHubRemoteAccessPort` 类型、不暴露 adapter-private wire DTO 给 `agent-capability`。

### D3: Catalog-triggered synchronous refresh with local Agent source authorization

**First-release trigger.** Product app startup MUST only validate and register configured SkillHub providers, adapter dependencies and managed install references. Startup/readiness MUST NOT perform remote SkillHub refresh, package download, managed install, installed-index mutation or catalog visibility changes. Remote refresh is a side-effecting synchronization operation and in this change MUST only run inside the request-scope catalog load path that builds the current Agent's available Skill list. This change does not add a Web API, runtime command, TTL refresh loop, marketplace UI or multi-Agent operator UI.

首版 SkillHub 不提供独立 operator refresh 入口。Refresh 由 core 通过现有 catalog governed view 间接触发，具体位置是 request-scope catalog 在为当前 Agent 加载可用 Skill 列表时的 SkillHub SEARCH 阶段；startup/readiness、模型、context assembly 和 `Skill` Tool body loading 都不是独立 refresh owner。

首版也只支持 remote-gateway-backed 宿主。local-only 宿主即使本地存在旧的 managed install 目录或预置 SkillHub 包，也不得把这些内容当作独立 source 启用 SkillHub；没有 remote adapter 的宿主对 `SKILL_HUB` provider 必须 fail closed。

Catalog-triggered refresh 和后续 installed fact selection 都必须先通过本地 Agent source authorization。该授权来自 app composition、Agent package 或 compiled Agent assembly 中的本地事实，用于表达“当前 Agent 允许使用哪个 SkillHub provider/source”。远端响应中的 `agentId`、`agentVersion`、publisher、namespace 或类似字段只能作为一致性校验输入，不能作为授权来源。已安装 index/loading facts 只能用于隔离、cache lookup 和一致性校验，不能在授权移除后继续让 Skill 对 Agent 可见。

首版最小授权粒度是 provider-level allowlist：

```text
agentId
providerId
```

实现可以在 provider-level 授权内追加更窄的本地约束，例如 `skillIds`、namespace、publisher、package hash 或 signature/trust facts；没有本地授权覆盖的远端 candidate 或已安装 fact 不得进入当前 Agent 的 catalog candidate set。

Catalog-triggered refresh 输入必须包含 trusted scope：

```text
tenantId
subjectId
agentId
agentVersion
agentAssemblyRef
providerId
```

可选 narrowing 可以包含 requested Skill id，但不得包含 client-owned owner/agent override、model output、capability args、routing policy 或 runtime lifecycle decision。

同步 refresh 结果分为 remote candidate facts 和 installed source facts：

1. Remote candidate facts 来自 SkillHub list/search。它们不是 catalog facts。
2. Installed source facts 来自 package download + managed install + local validation。只有 installed source facts 可以参与 discovery/catalog。

该分离是本 change 的核心约束：SkillHub remote state is not catalog state.

### D4: Agent-scoped remote list/search

SkillHub list/search request 必须携带 current Agent scope：

1. `agentId`
2. `agentVersion`
3. `agentAssemblyRef` 或等价 safe assembly identity
4. owner scope `tenantId` 和 `subjectId`，用于 provider policy、credential scope 或 safe diagnostics

Remote gateway 可以把这些字段映射到 SkillHub wire request，但返回结果必须经过 runtime schema validation。远端返回不匹配当前 Agent scope、缺失 Skill id、unsafe Skill name、invalid version、invalid package ref 或 unsafe metadata 的候选必须被拒绝或降级为 safe diagnostic。

Remote metadata 只用于判断是否可以下载和安装。它不得驱动 catalog availability、model visibility、execution authorization 或 routing；这些仍由 installed manifest facts 和 catalog governance 决定。

### D5: Package download and managed install

**Package format and installer owner.** SkillHub package v1 format is a zip archive. The installer MUST reject encrypted archives, unsupported compression methods, directory entries that are not needed to materialize files, symlink/hardlink/special-file entries, duplicate file paths after canonicalization, entries whose canonical target escapes the staging root, and archives that exceed file count or uncompressed byte budgets. The first release supports only a single-file package rooted at `SKILL.md`; nested `scripts/`, `references/`, `assets/` or other multi-file Skill package layouts, package signature verification, trust-chain policy, publisher reputation, license policy and vulnerability scanning are deferred to separate changes.

**Atomic publish.** Atomic publish uses a versioned committed package directory and an atomic index replacement: validate in staging, rename staging to a new committed directory, write `skillhub-index.json.tmp`, then rename it over `skillhub-index.json`. Existing committed directories remain usable until the new index is published; old committed directories are cleaned up best-effort only after the new package is visible. This avoids deleting a previously usable package before the replacement is durably indexed. Concurrent installs targeting the same managed root must serialize index merge/write so one accepted Skill cannot overwrite another accepted Skill's fact.

Downloaded package 必须安装到 `managedInstallRef` 下的 provider-owned managed area。实现可以使用 provider id、Agent id/version 和 remote package stable id 构造内部目录，但该布局是 provider-private fact。

Managed install facts 是 `agent-capability` owned、provider-private 的 local source facts。首版不把它们写入 gateway durable store，不新增 gateway `*Record`、table 或 `agent-contracts` DTO。它们由 managed install root 下的 committed package directory 和 provider-private index/loading fact file 承载，只供 SkillHub discovery 和 invocation-time body loading 使用。

每个 accepted installed fact 必须绑定以下 scope key，并在 refresh、install、discovery 和 request-scope catalog candidate selection 时按当前 trusted scope 精确匹配。只有通过该匹配并经过 catalog governance 的 installed fact 才能产生 governed descriptor；invocation-time body loading 不重新消费这些 runtime scope 字段：

```text
tenantId
subjectId
agentId
agentVersion
agentAssemblyRef
providerId
skillId
packageVersion/packageHash or equivalent consistency token
```

Package install 必须满足：

1. 解包前后都检查 size budget、file count budget 和 canonical path。
2. 拒绝 absolute path、`..` traversal、drive-qualified path、symlink/hardlink escape、unsafe filename、hidden unsafe metadata file、control-character path。
3. 至少包含一个 top-level Skill candidate，首版推荐 package root 自身或一级目录中有 `SKILL.md`；最终 installed candidate 必须映射为一个 safe candidate name。
4. `SKILL.md` 必须通过 `SkillDocumentService.parseMetadataView(...)` 校验。
5. Manifest `name` 必须与 safe candidate name 或 remote package declared skill id 一致。
6. Body loading 所需 opaque source handle、source identity、frontmatter hash、package version/hash 或 equivalent consistency token 必须保存为 source-owned internal loading fact，并由 governed descriptor 只携带不可反解的 source-owned handle 或 consistency token。
7. Install 必须是 atomic 或具备 crash-safe cleanup：不完整 install 不得贡献 catalog descriptor。
8. Download 和 extraction 先进入 staging area；只有全部校验、manifest parse 和 loading fact 写入成功后，才能 atomic publish 到 committed area。
9. Startup、refresh 或 discovery 看到 staging、缺失 index/loading fact、scope key 不匹配、hash/token 不匹配或 current validation 失败的 package 时，必须清理、隔离或忽略，且不得贡献 descriptor。Scope key mismatch 必须在 descriptor 进入 request-scope governed view 前处理，不得延期到 invocation-time body loading 作为第二个范围 gate。

首版不要求 cryptographic signature verification。若远端提供 checksum，implementation 可以作为 package integrity input 使用，但 checksum/trust policy 不作为本 change 的 public contract。

### D6: Discovery over installed managed skills

SkillHub discovery 只从 installed managed source facts 产生 descriptor candidates。它实现现有 `CapabilityDiscovery`：

- `discoveryMode=SEARCH` 用于按当前 Agent scope 搜索 installed SkillHub Skills。
- 如实施选择在 refresh 后维护 provider-local installed index，也必须把 index 视为 provider-private implementation fact，不作为 public catalog state。

Catalog 只有在当前 Agent 通过本地 source authorization 授权该 provider 时，才可以调用 SkillHub `SEARCH` discovery。`providerKind=SKILL_HUB` 本身不是 default-enabled 事实；配置了 SkillHub provider 也不表示所有 Agent 都可搜索该 provider。Discovery criteria 只包含 trusted Agent/owner/search scope 和可选 requested capability narrowing。Discovery 不消费 explicit bindings、disabled bindings、availability verdict、routing policy 或 conflict result。

Installed SkillHub descriptor candidate 使用：

```text
provider.providerId = configured provider id
provider.providerKind = "SKILL_HUB"
kind = "SKILL"
capabilityId = manifest name
description = manifest description
metadata = typed SkillMetadata as allowed by skill manifest contract
```

Descriptor 不包含 endpoint、credential ref、remote package URL、download URL、local absolute path、install directory, package internal layout、raw manifest、full body 或 source loading key。

### D7: Catalog governance and priority

SkillHub source 输出 candidate/source facts，不决定 final availability。Capability Catalog 继续拥有：

1. explicit disabled provider/capability handling
2. availability filtering
3. `modelInvocable` filtering
4. conflict/shadowing
5. invocation eligibility
6. `resolve` 与 `listAvailable` 一致性

SkillHub provider 是 binding/source-policy enabled 的 SEARCH provider，不是按 provider kind 自动启用的 default-enabled provider。Catalog MUST NOT call SkillHub SEARCH solely because `providerKind=SKILL_HUB`. Catalog 可以在 provider-level source authorization 通过后纳入 SkillHub candidate，而不要求每个 Skill 都有单独 enabled binding；这仍然是本地 Agent 授权，不是远端授权。每次 `listAvailable` / `resolve` 都必须重新评估当前 Agent 的 source authorization、explicit disabled binding、availability、conflict/shadowing 和 model visibility。已安装 fact 在授权移除后不得继续可见。

Catalog MUST invoke the local Agent source authorization policy before SkillHub `SEARCH`, synchronous remote refresh and installed-fact contribution. A provider binding can be an input to that policy, but catalog MUST NOT directly treat a binding match as the whole source authorization boundary.

Priority 沿用 roadmap 和已有 source changes：

1. 用户显式指定或 Agent package 显式绑定的 capability
2. Agent-scoped source
3. builtin source
4. system-level local source
5. SkillHub / remote source

当 SkillHub Skill 与更高优先级 source 使用同一 `capabilityId` 时，SkillHub candidate 必须被 shadowed、rejected 或 marked unavailable，不得覆盖更高优先级 candidate。不同 Agent scope 的 SkillHub installed candidates 不得互相可见。

Explicit disabled binding 对 SkillHub candidate 生效。Provider disabled、Agent source authorization 缺失/移除，或选中的 provider adapter factory 真的 unavailable 时，该 provider 不贡献 available descriptors。

### D8: Invocation-time body loading

SkillHub source 必须实现现有 implementation-local `SkillSourceDiscovery.loadCanonicalBodyView(...)` 作为 source-specific body dereference adapter；本 change 不定义新的 body loading 主流程。`Skill` Tool 调用期流程保持不变：

1. Agent Core 调用 `Skill` wrapper Tool。
2. `Skill` Tool 通过 request-scope governed resolver 解析 target Skill descriptor。
3. `Skill` Tool 使用 descriptor provider id 从 catalog implementation-local source registry 找到 SkillHub source/discovery。
4. SkillHub source 使用 source-owned internal loading facts 读取 installed `SKILL.md` canonical body。
5. `SkillDocumentService.loadCanonicalBodyView(...)` 返回 canonical body view。
6. `Skill` Tool 执行 descriptor/body consistency、text/size/wrapper-boundary 和 leakage checks。

SkillHub source 不定义新的 Skill execution result、generated message shape、context patch behavior 或 model-visible disclosure rules。

`SkillSourceDiscovery.loadCanonicalBodyView(...)` input MUST NOT carry invocation-time `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, binding facts or source-policy facts. The Skill Tool MUST use the governed descriptor produced by the request-scope catalog resolver and the descriptor's source-owned opaque loading handle or consistency token to dereference the body. It MUST NOT add fields to `CapabilityInvocationRuntimeContext`, derive scope from model input, capability arguments, descriptor metadata or remote response, or expose body-loading handles through public contracts.

Body loading MUST NOT make capability authorization decisions, consume bindings/source policy, consume runtime scope, or treat remote/installed facts as authorization. Authorization and Agent/Owner scope matching are already owned by refresh/install/discovery and the request-scope catalog resolver that produced the governed descriptor. The body loader only verifies descriptor provider/source identity, skill identity, source-owned opaque handle, body hash/frontmatter hash and package/version consistency token against source-owned installed loading facts. A descriptor/body consistency mismatch safe-fails as unavailable or stale source without exposing paths, scope facts or loading keys.

The descriptor-carried source-owned loading handle is opaque public metadata. It MUST be generated so it cannot be reversed into `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, endpoint, package ref, managed install path or package layout facts. Provider-private installed index entries continue to own the full scope and package consistency facts.

### D9: Diagnostics and readiness evidence

SkillHub diagnostics 是 implementation-local safe evidence。Outcome code 至少覆盖：

- `SKILLHUB_PROVIDER_DISABLED`
- `SKILLHUB_PROVIDER_UNAVAILABLE`
- `SKILLHUB_REFRESH_UNAVAILABLE`
- `SKILLHUB_REMOTE_METADATA_INVALID`
- `SKILLHUB_REMOTE_SCOPE_MISMATCH`
- `SKILLHUB_DOWNLOAD_FAILED`
- `SKILLHUB_PACKAGE_REJECTED`
- `SKILLHUB_INSTALL_INCOMPLETE`
- `SKILLHUB_MANIFEST_MISSING`
- `SKILLHUB_MANIFEST_INVALID`
- `SKILLHUB_CANDIDATE_INSTALLED`
- `SKILLHUB_GOVERNANCE_UNAVAILABLE`
- `SKILLHUB_SKILL_SHADOWED`
- `SKILLHUB_SKILL_REGISTERED`

Evidence 只包含 safe provider id、provider kind、Agent scope when applicable、Skill identity when available、outcome code 和 sanitized message。Diagnostics 不新增 public catalog response payload。

### D10: Failure behavior

SkillHub failure must fail closed:

1. Remote unavailable、timeout 或 auth failure 不得使用 stale remote metadata 产生新 descriptor。
2. Download failure 不得创建 partial installed candidate。
3. Package validation failure 不得进入 catalog。
4. Manifest invalid 不得进入 catalog。
5. Managed install root unavailable 只影响该 SkillHub provider，不阻塞 builtin/local sources。
6. Refresh failure 不得在 request lifecycle 中挂死 runtime/core/context/model path。

如果 implementation 保留已安装的上一版本 SkillHub package，是否继续使用已有 installed package 是 provider-local policy；首版建议只允许已完成安装且仍通过 current validation 的 package 参与 catalog，并把 refresh failure 与 installed candidate visibility 分开诊断。

## 主流程

1. App composition 读取 user capability provider config。
2. Config resolver 解析 `type=skill-hub` 为 `CapabilityProviderConfig`，校验 endpoint、credential reference、managed install reference 和 provider id。
3. App composition 选择默认内置 fetch-based adapter factory 或测试/特殊宿主覆盖的 factory，验证 SkillHub adapter 可用，并向 capability subsystem 注入 provider config 和 remote gateway dependency。
4. Core/context 通过现有 catalog path 请求当前 Agent 的可用 Skill 列表或 resolve 目标 Skill。
5. Catalog 在 SkillHub SEARCH 阶段先校验当前 Agent 对该 SkillHub provider 的本地 source authorization。
6. Catalog 使用 trusted scope 同步调用 remote gateway list/search。
7. 对候选执行 metadata validation 和 safe scope check。
8. 对 accepted candidate 通过 remote gateway 下载 package。
9. Managed installer 执行 safe extraction、atomic install、package structure check 和 `SKILL.md` manifest validation。
10. Installed source facts 写入 provider-private installed index/loading facts。
11. Discovery 从当前已安装 facts 产出 descriptor candidates。
12. Catalog 应用 disabled binding、availability、conflict/shadowing 和 model visibility。
13. `Skill` Tool 调用期通过 `SkillSourceDiscovery` 加载 installed canonical body，并只做 source/body consistency dereference。

## 失败与降级

1. Provider disabled：不调用 remote gateway，不贡献 descriptors，输出 safe disabled outcome。
2. Adapter unavailable：仅当默认或覆盖后的 selected adapter factory 真的不可用或无法构造 provider adapter 时，provider unavailable，不贡献 descriptors，输出 safe provider unavailable outcome。
3. Credential invalid：ready 前 fail closed 或 provider unavailable，raw credential 不外泄。
4. Remote list/search failed：refresh 返回 safe unavailable outcome，不创建新 installed candidate。
5. Remote candidate metadata invalid/scope mismatch：候选被拒绝，不下载。
6. Download failed：候选不安装，不进入 catalog。
7. Package rejected：删除或隔离 partial package，不进入 catalog。
8. Manifest missing/invalid：不进入 catalog，复用 Skill manifest safe diagnostics。
9. Governance unavailable/shadowed：descriptor 不进入 model-visible executable view，输出 safe governance/shadow outcome。
10. Invocation-time body consistency mismatch：`Skill` Tool safe-fails 或按 catalog policy re-resolve，不暴露 install path或 raw body。

## 验证映射

| 约束 | Task | 验证入口 |
|---|---|---|
| SkillHub provider config 和 adapter registration | 2.1, 2.2, 8.1 | config/app composition tests |
| Remote gateway boundary, no direct fetch in capability | 2.3, 10.1 | architecture tests |
| Explicit refresh uses trusted Agent/Owner scope | 3.1, 3.2 | refresh service tests |
| Remote candidates do not enter catalog before install | 3.3, 7.1 | catalog negative tests |
| Package safe extraction and atomic managed install | 4.1-4.5 | installer/security tests |
| Manifest reuse through SkillDocumentService | 5.1, 5.2 | manifest reuse tests |
| SkillHub discovery over installed facts only | 6.1, 6.2 | discovery tests |
| Catalog governance/disabled/conflict/modelInvocable | 7.1-7.4 | catalog list/resolve tests |
| Invocation-time body loading via SkillSourceDiscovery | 6.3, 7.5 | Skill Tool integration tests, descriptor/source/body consistency negative test |
| Diagnostics redaction | 9.1, 9.2 | safety negative tests |
| OpenSpec and architecture gates | 10.1, 10.2 | `openspec validate`, `npm run lint:architecture` |

## 文档承载决策

- 行为契约：`openspec/specs/skillhub-source/spec.md`。
- 配置关系：`openspec/specs/capability-source-configuration/spec.md` 已承载 provider config baseline；本 change 只引用并补 SkillHub source 行为。
- 架构关系：归档时更新 capability SPI、agent-capability、agent-app、remote gateway 相关长期设计文档。
- 本 change 不修改 overview 或 roadmap，也不新增 SkillHub remote gateway public port。若实施发现必须修改已冻结的 `SkillHubOptions` 或其他 public contract，应停止并提出独立 contract refinement。

## 风险与取舍

- [风险] 远端候选被误注册为 catalog descriptor。 -> Spec 明确 remote candidate 与 installed source fact 分离，增加 uninstalled candidate negative test。
- [风险] `agent-capability` 直接 HTTP 访问 SkillHub。 -> 明确 remote gateway boundary，并用 architecture tests 阻止 direct fetch/SDK import。
- [风险] managed install 泄露本地路径或 package layout。 -> descriptor、diagnostic、safe error、log tests 覆盖 raw path/layout leakage。
- [风险] refresh 被不受控路径反复触发，造成主路径抖动或 second refresh。 -> 只允许 request-scope catalog Skill availability load 触发同步 refresh；startup/readiness、Skill Tool body loading 和其他非 catalog 路径不得再次触发 remote refresh。
- [风险] scope 混淆导致 A Agent 安装的 Skill 对 B Agent 可见。 -> Refresh/install/discovery facts 必须携带 trusted Agent scope，并补 cross-Agent visibility tests。
