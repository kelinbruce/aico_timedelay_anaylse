# skillhub-source Specification

## Purpose

Define SkillHub as a governed, gateway-backed remote Skill content source. The generic capability contract consumes provider-neutral candidate facts and normalized staged Skill folders; concrete SkillHub service protocols, credentials, wire DTOs, archive formats and package bytes stay inside remote gateway or deployment adapter boundaries.
## Requirements
### Requirement: SkillHub Source MUST Be A Gateway-Backed Remote Skill Content Source

NextAgent SHALL expose remote Skill sourcing as a provider-neutral Remote Skill Content Source capability. The capability MUST use trusted Owner Scope and Agent Scope, local Agent source authorization, provider-private installed/loading facts, standard `SKILL.md` manifest validation, `CapabilityCatalog` governance and `SkillSourceDiscovery` body loading.

The Remote Skill Content Source MUST NOT require a SkillHub-specific service protocol, endpoint URL, HTTP path, wire DTO, credential reference, ZIP archive, package bytes response or `packageBytesBase64` response as part of the generic source contract. Those facts belong to concrete remote gateway adapters.

A configured `SKILL_HUB` remote Skill provider MUST reference a remote gateway by stable gateway id. App composition MUST resolve that gateway, wrap the selected remote gateway adapter into the capability-owned access port shape, and inject only that access port and frozen provider facts into `agent-capability`. `agent-capability` MUST NOT import concrete remote gateway implementations, HTTP clients, SkillHub service SDKs or adapter-private DTOs.

#### Scenario: Provider references gateway without service URL

- **WHEN** repository default system configuration declares a remote Skill provider
- **THEN** the provider configuration MUST use the existing SkillHub provider identity (`skill-hub` / `SKILL_HUB`) and contain a provider id, gateway id reference and managed install/cache reference
- **AND** it MUST NOT contain real URL, endpoint, credential reference, token, tenant/subject private data, raw remote payload or provider-private loading key

#### Scenario: Gateway owns concrete SkillHub service access

- **WHEN** a concrete SkillHub service is configured for a deployment
- **THEN** its URL, credential resolution, HTTP path, wire DTO shape and service-specific safe error mapping MUST be owned by the selected remote gateway adapter or deployment overlay
- **AND** changing to another SkillHub service with a different protocol MUST require adding or replacing a remote gateway adapter, not changing the provider-neutral capability core

#### Scenario: Capability package depends only on injected access port

- **WHEN** remote Skill source refresh fetches candidates or content
- **THEN** `agent-capability` MUST call the injected capability-owned access port
- **AND** `agent-capability` MUST NOT import concrete gateway implementation, HTTP client implementation, endpoint-specific wire DTO or service SDK
- **AND** architecture validation MUST fail on such boundary escape

### Requirement: Remote Skill Content Access MUST Return Normalized Skill Folders

Remote Skill content access SHALL be modeled as candidate discovery plus normalized Skill folder fetch. Candidate discovery MUST return provider-neutral candidate facts such as `skillId`, content reference and optional content consistency facts. Content fetch MUST return a reference to a normalized staged Skill folder under a controlled staging root, plus a consistency token such as content hash, version or equivalent source-owned token.

The generic access contract MUST NOT expose a permanently closed `zip | skill-md | tar` union, archive kind, archive bytes, package bytes, single-file payload or service-specific tree/blob response to `agent-capability`. Concrete remote gateway adapters MUST own service access, service-specific response mapping, content download, decode, extraction and normalization into the staged Skill folder shape.

Concrete remote gateway adapter implementation organization is adapter-private. The required contract boundary is that service-specific protocol, endpoint path, wire DTO validation, credential resolution, package or archive decoding, content normalization and adapter-private safe error mapping MUST NOT be owned by `agent-capability`; they MUST remain inside the selected remote gateway adapter or deployment overlay. OpenSpec does not mandate a particular helper-file split inside a concrete adapter.

Concrete remote gateway adapters MUST write normalized folder output only under the capability/provider controlled staging root. They MUST NOT write decompressed or normalized content into the committed install directory, update provider-private installed facts, publish catalog-visible descriptors or otherwise make a Skill visible. Only `agent-capability` may promote a validated staged folder into the committed install directory through the recoverable publication sequence.

`agent-capability` SHALL own normalized folder intake validation, root `SKILL.md` validation, managed install publication, provider-private installed fact update and catalog governance. Concrete remote gateway adapters MUST NOT own final NextAgent Skill installation safety rules, `SKILL.md` semantic validation, managed install publication or catalog governance.

The capability folder intake validation MUST fail closed when the staged folder is outside the controlled staging root, contains path escape, symlink or hardlink escape, exceeds file count, total size or single-file budgets, lacks the canonical root `SKILL.md`, or attempts to expose additional descriptors. Safe subdirectory files MAY be retained as provider-private resources only after intake validation, and MUST NOT change Skill invocation semantics.

The generic source contract MUST NOT call this operation `downloadPackage` or require package bytes. Concrete gateway adapters MAY internally download packages, decode base64, fetch a single file, read object storage, clone a tree or use another service-specific mechanism, but they MUST map the result to a normalized staged Skill folder before crossing into `agent-capability`.

#### Scenario: Single SKILL.md remote content installs without ZIP

- **WHEN** a remote gateway adapter receives single `SKILL.md` content for an authorized remote Skill candidate
- **THEN** the gateway adapter MUST materialize it as a normalized staged Skill folder with that content as root `SKILL.md`
- **AND** `agent-capability` MUST validate the manifest through the standard Skill manifest parser after folder intake
- **AND** `agent-capability` MUST be able to publish provider-private loading facts and contribute a governed descriptor without ZIP extraction

#### Scenario: Archive formats are normalized before capability intake

- **WHEN** a remote gateway adapter receives ZIP, tar, tar.gz or another service-owned archive format
- **THEN** the gateway adapter MUST download, decode and extract that archive into a normalized staged Skill folder before returning it to `agent-capability`
- **AND** `agent-capability` MUST NOT branch on or parse the archive format
- **AND** root `SKILL.md` MUST remain the only manifest and canonical Skill body entry after folder intake
- **AND** safe subdirectory files MAY be retained as provider-private resources only when folder intake validation allows them
- **AND** those files MUST NOT produce additional descriptors or change Skill invocation semantics

#### Scenario: Invalid staged folder fails closed

- **WHEN** a remote gateway adapter returns a staged folder outside the controlled staging root, with unsafe links, unsafe paths, missing root `SKILL.md`, multiple descriptor entry points or budget violations
- **THEN** `agent-capability` MUST reject the folder safely
- **AND** no descriptor from that folder MUST enter catalog governance
- **AND** the provider-private index MUST NOT be updated for that failed content

#### Scenario: Gateway cannot publish directly to committed install

- **WHEN** a remote gateway adapter downloads, decodes, extracts or normalizes remote Skill content
- **THEN** it MUST write only to a staged Skill folder under the controlled staging root
- **AND** it MUST NOT write directly to the committed install directory
- **AND** it MUST NOT update provider-private installed facts or catalog-visible descriptors
- **AND** `agent-capability` MUST reject any returned folder reference that points at committed install content instead of staging content

#### Scenario: New SkillHub service format does not change capability core

- **WHEN** a new SkillHub service uses a different protocol, response shape, archive format, object-store layout, tree reference or single-file representation that can be normalized to a local Skill folder
- **THEN** the change MUST be isolated to adding or replacing a remote gateway adapter or deployment overlay
- **AND** `agent-capability` MUST continue to consume only the normalized staged Skill folder contract
- **AND** the capability core MUST NOT change only because the service uses a new compressing, packaging or transport format

#### Scenario: Non-folder remote source requires a new contract

- **WHEN** a future service cannot be normalized to a local Skill folder, such as remote dynamic execution, remote body streaming or an on-demand virtual file system
- **THEN** that service MUST NOT be forced through this Remote Skill Content Source contract
- **AND** a new OpenSpec-defined contract MUST exist before implementation

### Requirement: Provider-Private Installed Facts MUST Be Provider-Neutral

Remote Skill installed content index, managed install layout, staging details, normalized folder references, remote payloads and provider-private loading keys SHALL remain provider-private implementation facts. Public descriptors, diagnostics, stream payloads, safe errors, logs and model-visible capability disclosure MUST expose only safe Skill descriptor fields and safe availability diagnostics.

Installed/loading facts MUST be named and shaped around remote Skill content, not around SkillHub ZIP packages. Each accepted fact MUST bind trusted `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, `providerId`, `skillId` and a provider-neutral content consistency token. Service-format-specific consistency facts, such as ZIP/package version or hash values, MAY exist inside a concrete remote gateway adapter, but they MUST be normalized into provider-neutral content consistency before crossing into `agent-capability` installed/loading facts, source contracts or managed indexes.

Provider-private fact merge MUST keep at most one active installed/loading fact for each unique key `tenantId + subjectId + agentId + agentVersion + agentAssemblyRef + providerId + skillId`. Artifact version, content consistency token, manifest path, source identity and frontmatter hash are fact content and consistency inputs, not uniqueness keys.

Remote Skill content install publication MUST be idempotent for the same trusted scope, provider, skill and content consistency token. The committed install directory name MUST be derived from a stable safe install id containing or hashing trusted `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, `providerId`, `skillId` and a provider-neutral content consistency token such as a content hash, content version or equivalent source-owned token. The committed directory name MUST NOT include wall-clock time, random UUID or other non-deterministic suffixes.

Remote Skill content install MUST validate the normalized staged folder before publishing. After validation succeeds, the installer MUST replace the same install id through a recoverable publish sequence: it MUST first rename any existing committed directory for that exact install id into a provider-private backup or quarantine location, then rename the validated staging directory into the committed location, and it MUST update the provider-private index only after the new committed content is visible. A failed folder intake, manifest parse or publish step MUST NOT update the provider-private index, MUST NOT publish partial staging content, and MUST preserve or restore the previously indexed committed content when one existed.

After a successful install, the installer MUST best-effort clean committed directories for older content versions or hashes of the same `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, `providerId` and `skillId`. Cleanup targets MUST be collected from provider-private installed facts read before the index fact is replaced; the system MUST NOT infer owner scope, Agent scope, provider or skill identity from an opaque hashed directory name. Cleanup failure MUST NOT block the successful install, provider-private index publication or catalog visibility for the newly installed content.

#### Scenario: Installed facts do not leak into descriptor

- **WHEN** a remote Skill is discovered from installed/loading facts after governed refresh
- **THEN** the resulting descriptor MUST NOT contain managed install path, installed index row, download URL, remote payload, raw archive metadata, staged folder reference, concrete gateway config or provider-private loading key

#### Scenario: Reinstalling the same content is idempotent

- **WHEN** the same remote Skill normalized content is installed more than once for the same trusted owner scope, Agent scope, provider, skill id and content consistency token
- **THEN** the installer MUST publish to the same committed install id
- **AND** it MUST NOT create additional committed directories solely because the install happened at a different time
- **AND** the provider-private index MUST contain one fact for that skill key

#### Scenario: Failed replacement preserves the previously indexed content

- **WHEN** a replacement normalized staged folder fails intake validation, manifest parsing or committed publish after a previous version was already indexed
- **THEN** the provider-private index MUST NOT be overwritten by the failed replacement
- **AND** discovery and Skill body loading MUST continue to use the previously indexed committed content when it can be restored or was not replaced
- **AND** partial staging content MUST NOT contribute a descriptor candidate

#### Scenario: Skill upgrade replaces content fact

- **WHEN** a remote Skill with the same trusted owner scope, Agent scope, provider and skill id is installed with a newer content consistency token
- **THEN** the provider-private index MUST replace the previous fact for that skill key with the new fact
- **AND** catalog discovery MUST use the new content consistency facts
- **AND** older committed directories for the same scope/provider/skill MUST be cleaned best-effort after successful install
- **AND** cleanup failure MUST NOT roll back the new index fact or hide the newly installed Skill

#### Scenario: Legacy installed index is upgraded safely

- **WHEN** a managed install root contains an existing `skillhub-index.json`
- **THEN** the source MUST read only entries that satisfy the legacy loading fact schema
- **AND** it MUST map legacy ZIP package consistency facts into provider-neutral content consistency before writing the refreshed installed facts
- **AND** malformed or scope-incomplete entries MUST be ignored safely
- **AND** the next successful refresh MUST write provider-neutral installed facts keyed by trusted owner scope, Agent scope, provider id and skill id

### Requirement: Default Configuration MUST Remain Structural

Repository default system configuration MAY declare remote gateway and remote Skill provider structure in the same file, but they MUST remain separate configuration sections. The provider section MUST reference a gateway by id. The gateway section MAY declare gateway id, gateway kind and deployment mode. Repository default configuration MUST NOT contain real URL, endpoint, credential reference, token, tenant/subject private data, raw remote payload or provider-private loading facts.

Deployment-specific configuration, local overrides, environment-backed secret/config resolution or concrete gateway implementation configuration MAY provide concrete URL and credential facts outside repository default configuration.

The repository builtin `default-agent` MAY explicitly bind a Skill supplied by a remote Skill provider. Default assembly and composition paths MUST pass the configured provider identity through assembly resource references and startup provider registry construction so the explicit binding is valid, while preserving other assembly resource references such as plugin policies. Such default configuration MUST NOT bypass provider registration, trusted Agent scope, owner scope, local source authorization, catalog governance, normalized folder intake validation, root `SKILL.md` manifest validation or Skill Tool invocation contracts.

#### Scenario: Gateway and provider are separate sections

- **WHEN** repository default system configuration declares remote Skill support
- **THEN** gateway configuration MUST declare the gateway identity and kind separately from provider configuration
- **AND** provider configuration MUST reference that gateway by id
- **AND** provider configuration MUST NOT inline concrete gateway service access facts
- **AND** provider configuration MUST continue to use the existing SkillHub provider identity rather than introducing a second remote Skill provider kind

#### Scenario: Default config has no real URL or ref

- **WHEN** repository default system configuration is reviewed
- **THEN** it MUST NOT contain concrete SkillHub URL, endpoint, credential reference, token, tenant/subject private data, raw remote payload or provider-private loading key

#### Scenario: Default remote Skill provider remains governed

- **WHEN** the builtin `default-agent` binds a Skill from the default remote Skill provider
- **THEN** the binding MUST remain an explicit Agent capability binding
- **AND** the Skill MUST become visible only through normal provider registration, source authorization, remote gateway access, normalized folder intake validation, manifest validation and catalog governance

### Requirement: SkillHub Source MUST Support Runtime Acquisition Consumption

SkillHub source SHALL be usable by a controlled runtime Skill acquisition path, but its content MUST become executable only through the same governed source lifecycle used by catalog refresh: trusted scope, remote gateway access, normalized staged folder, root `SKILL.md` validation, managed install publication, provider-private index update and catalog descriptor governance.

SkillHub source MUST NOT mutate an active model invocation toolset. When runtime acquisition installs new SkillHub content, the content MAY become visible only after runtime/core requests a rebuilt capability snapshot for a later model step.

SkillHub source SHALL provide the Skill source loading surface for acquired SkillHub Skills. The same provider that publishes descriptors from the installed index MUST support governed body loading and resource projection for those Skills through `loadCanonicalBodyView`, `listSkillResources`, and `readSkillResource`.

#### Scenario: Runtime acquisition consumes SkillHub through governed install
- **WHEN** the runtime Skill acquisition path requests a SkillHub-backed Skill during an accepted request/run
- **THEN** SkillHub source MUST use trusted Owner Scope and Agent Scope for list/search and content fetch
- **AND** the content MUST be installed under the configured managed install root and written to the provider-private installed index before a descriptor can be returned
- **AND** the resulting descriptor MUST be governed by the current Agent source authorization and catalog conflict rules

#### Scenario: SkillHub acquisition does not bypass catalog governance
- **WHEN** SkillHub remote access returns a candidate or normalized staged folder during acquisition
- **THEN** the system MUST NOT expose that candidate as model-visible Skill capability until manifest validation, managed install, index publication and catalog governance succeed
- **AND** a failed or partially completed acquisition MUST NOT make the Skill visible from staging, remote payload or local managed cache alone

#### Scenario: Acquired SkillHub Skill projects resources through SkillHub source
- **WHEN** an acquired SkillHub package contains root `SKILL.md` and governed resource files under allowed Skill resource directories
- **AND** the package has been published to the SkillHub installed index
- **THEN** loading that Skill MUST use the SkillHub provider's Skill source loading surface
- **AND** `listSkillResources` and `readSkillResource` MUST enumerate and read only resources from the installed folder associated with the indexed fact
- **AND** runtime/core MUST NOT read SkillHub managed folders, staging folders, raw remote payloads or archive bytes directly to project those resources

### Requirement: SkillHub 远程下载包完整性校验

Concrete remote gateway adapter 在下载 SkillHub skill 包后、解压或 materialize 之前，MUST 对下载字节计算 SHA-256 hash 并与声明的 `packageHash` 比对。当远端声明了 `packageHash` 时，adapter MUST 校验 `createHash("sha256").update(packageBytes).digest("hex")` 与 `packageHash` 一致；不匹配时 MUST 返回 `{ status: "failed", reasonCode: "invalid-response", message: "SkillHub package integrity check failed." }`，MUST NOT 执行解压或 materialize。

当远端未声明 `packageHash`（`packageHash === undefined`）时，adapter MAY 跳过完整性校验以保持向后兼容。完整性校验 MUST 在 `materializeZipPackage` 之前执行，防止恶意包在解压时触发 zip bomb 或路径穿越。

校验使用 `node:crypto` 的 `createHash`，MUST NOT 引入额外依赖。校验失败 MUST 通过既有 safe error 通道返回，MUST NOT 暴露 raw package bytes、远端 URL、credential 或内部存储路径。

#### Scenario: 下载包 hash 匹配时接受

- **WHEN** 远端 SkillHub 服务返回 package bytes 和声明 hash
- **AND** 下载字节的 SHA-256 hash 与声明的 `packageHash` 一致
- **THEN** adapter MUST 继续执行 `materializeZipPackage`
- **AND** 返回 `{ status: "ok" }` 结果

#### Scenario: 下载包 hash 不匹配时安全失败

- **WHEN** 远端 SkillHub 服务返回 package bytes 和声明 hash
- **AND** 下载字节的 SHA-256 hash 与声明的 `packageHash` 不一致
- **THEN** adapter MUST 返回 `{ status: "failed", reasonCode: "invalid-response", message: "SkillHub package integrity check failed." }`
- **AND** adapter MUST NOT 执行 `materializeZipPackage`
- **AND** 失败结果 MUST NOT 暴露 raw package bytes、远端 URL 或内部存储路径

#### Scenario: 远端未声明 hash 时跳过校验

- **WHEN** 远端 SkillHub 服务返回 package bytes 但未声明 `packageHash`
- **THEN** adapter MAY 跳过完整性校验
- **AND** adapter MUST 继续执行 `materializeZipPackage`
- **AND** 返回结果 MUST 包含远端提供的其他一致性 token

#### Scenario: 校验在解压前执行

- **WHEN** adapter 下载 package bytes 并声明了 `packageHash`
- **THEN** SHA-256 校验 MUST 在 `materializeZipPackage` 调用之前完成
- **AND** 校验失败时 MUST NOT 执行解压
