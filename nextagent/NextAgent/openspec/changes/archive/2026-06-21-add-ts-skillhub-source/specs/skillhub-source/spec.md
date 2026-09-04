## ADDED Requirements

### Requirement: SkillHub Provider 使用 SKILL_HUB Provider Kind

系统 SHALL support SkillHub as a configured capability provider with `providerKind=SKILL_HUB`. SkillHub provider configuration MUST be validated and frozen by app composition before the provider contributes any discovery source. The configuration MUST use the capability-owned `CapabilityProviderConfig` / `SkillHubOptions` shape and MUST NOT introduce a parallel app-owned provider DTO.

SkillHub provider options MUST include a non-empty endpoint and managed install reference. A credential reference MAY be configured, but when present it MUST use the frozen `SecretReference` grammar and MUST be validated before ready state. Default product app composition MUST provide a built-in fetch-based SkillHub remote adapter factory; tests or specialized hosts MAY explicitly override that factory. Raw credentials MUST NOT be passed to runtime, core, context, model, stream, safe error, descriptor metadata or logs.

SkillHub support in this change is remote-gateway-only. A host that runs in local-only mode, or otherwise cannot provide a selected SkillHub remote adapter for the configured provider, MUST fail closed for that provider. Local-only mode MUST NOT treat provider-private managed install contents as sufficient to enable or continue exposing SkillHub capabilities.

#### Scenario: Valid SkillHub provider is registered by app composition

- **WHEN** user capability provider configuration declares a valid `skill-hub` provider
- **THEN** app composition MUST resolve it to `CapabilityProviderConfig` with `providerKind=SKILL_HUB`
- **AND** app composition MUST register the provider only after endpoint, credential reference, managed install reference and the default or overridden adapter availability are validated
- **AND** downstream packages MUST consume the frozen provider config and injected adapter dependency rather than raw configuration source

#### Scenario: Invalid SkillHub provider fails closed

- **WHEN** SkillHub provider configuration is missing endpoint, has an invalid credential reference, has missing managed install reference, uses a duplicate provider id, uses a reserved provider id or the selected default/overridden adapter factory is unavailable
- **THEN** app composition MUST reject or disable that provider with safe diagnostics
- **AND** that provider MUST NOT contribute available capability descriptors

#### Scenario: Local-only host does not support SkillHub

- **WHEN** the host runs without a SkillHub remote gateway adapter, including local-only mode
- **AND** user capability provider configuration declares a `skill-hub` provider
- **THEN** app composition MUST reject or disable that provider with safe diagnostics
- **AND** the system MUST NOT register SkillHub discovery, perform refresh, read provider-private installed facts for visibility or expose SkillHub descriptors

#### Scenario: Provider config does not expose raw credential

- **WHEN** SkillHub provider uses credential-bearing configuration
- **THEN** raw credential values MUST NOT appear in provider config, descriptors, diagnostics, logs, stream events, safe errors or model context
- **AND** only the safe credential reference fact MAY cross the app composition boundary

### Requirement: SkillHub Remote Access 使用 Remote Gateway Boundary

SkillHub list/search and package download MUST be performed through a remote gateway boundary. `agent-capability` MUST own a SkillHub-specific implementation-local remote access port for the source behavior and MUST NOT introduce a SkillHub remote access public port in `agent-contracts/gateway`. `agent-capability` MUST NOT directly use HTTP clients, fetch, remote SDK types or provider-private wire DTOs to access SkillHub. Remote adapter implementation details MUST remain in `agent-platform-gateway-remote` or an equivalent remote adapter implementation package. The remote adapter package MUST NOT import `agent-capability` or implement capability package-private SPI directly; default product `agent-app` composition MUST provide a built-in fetch-based adapter factory, allow tests or specialized hosts to override it, and wrap the selected remote adapter/factory into the `agent-capability` owned remote access port shape before injection.

The remote gateway boundary MUST normalize unavailable, timeout, unauthorized, invalid response and download failure outcomes into safe results. Package download requests MUST carry the same trusted `tenantId`, `subjectId`, `agentId`, `agentVersion` and `agentAssemblyRef` scope as list/search, plus `packageRef`; adapter wrappers MUST NOT drop, recompute or accept untrusted overrides for those scope fields. It MUST NOT expose raw remote response, raw provider error, credential, stack trace or download URL outside the gateway/adapter boundary.

This change does not define a local-only SkillHub mode. Provider-private installed caches, managed install roots or preseeded package contents are not an alternative source contract for bypassing the remote gateway requirement.

#### Scenario: Capability package does not directly call SkillHub endpoint

- **WHEN** SkillHub refresh needs remote list/search or package download
- **THEN** `agent-capability` MUST call an injected remote gateway boundary
- **AND** `agent-capability` MUST NOT import provider SDK, HTTP client implementation, endpoint-specific wire DTO or remote adapter private implementation
- **AND** the injected port MUST be capability-owned implementation SPI rather than a new `agent-contracts/gateway` public contract
- **AND** the remote adapter package MUST NOT import `agent-capability`; adapter-to-port wrapping MUST be owned by `agent-app` composition
- **AND** package download through that boundary MUST preserve the trusted Owner Scope and Agent Scope used for the refresh

#### Scenario: Remote failure is safe

- **WHEN** SkillHub remote access fails due to unavailable service, timeout, unauthorized access, invalid response or download failure
- **THEN** the remote gateway boundary MUST return a safe failure outcome
- **AND** the safe outcome MUST NOT expose raw response, raw provider error, credential, stack trace, endpoint token or download URL

### Requirement: SkillHub Catalog Refresh 使用可信 Agent Scope

SkillHub refresh SHALL happen synchronously when the request-scope governed catalog loads Skill availability for the current Agent. Startup/readiness, stream resume, history read and Skill Tool body loading MUST NOT independently trigger remote SkillHub refresh outside that catalog-owned path.

Refresh MUST use trusted Agent Scope and Owner Scope supplied by app/runtime-owned context: `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef` and provider id. Client request body, client metadata, model output, Skill manifest metadata, descriptor metadata, capability arguments or remote response MUST NOT override these scope fields.

Product app startup/readiness MUST NOT trigger remote SkillHub refresh, package download, managed install, installed-index mutation or catalog visibility changes. Startup/readiness MAY validate provider configuration, credential references, endpoint shape, managed install reference and adapter availability, and MAY register the provider, discovery and adapter dependencies. Remote refresh is a side-effecting synchronization operation and in this change MUST run only inside the catalog-owned request-scope Skill availability load path after local Agent source authorization has accepted the provider for that Agent. This change does not add a Web API, runtime command, TTL loop, marketplace UI or multi-Agent operator UI.

#### Scenario: Catalog load refresh carries trusted scope

- **WHEN** request-scope catalog loading refreshes SkillHub for an Agent while building available Skill candidates
- **THEN** the refresh request MUST carry trusted `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef` and provider id
- **AND** remote list/search and package download MUST be scoped by those trusted facts

#### Scenario: Untrusted scope override is ignored or rejected

- **WHEN** client input, model output, capability arguments, manifest metadata, descriptor metadata or remote response includes tenant, subject, agent id, agent version or assembly override fields
- **THEN** the system MUST NOT use those fields to override trusted scope
- **AND** conflicting scope data MUST be rejected or recorded as safe diagnostic

#### Scenario: Skill Tool body loading does not refresh SkillHub

- **WHEN** the model calls the `Skill` Tool for a SkillHub Skill after catalog resolution
- **THEN** the Tool MUST use already governed descriptor and installed source loading facts
- **AND** it MUST NOT trigger a second remote SkillHub refresh or package download as part of body loading or invocation

#### Scenario: Startup readiness only registers SkillHub

- **WHEN** the product app starts with a configured SkillHub provider for the active compiled Agent assembly
- **THEN** app composition MUST validate and register the provider, adapter dependency and managed install reference
- **AND** startup/readiness MUST NOT call remote SkillHub list/search/download
- **AND** startup/readiness MUST NOT install packages, mutate the provider-private installed index or change catalog visibility

### Requirement: SkillHub Source Authorization 本地归属 Agent

SkillHub provider configuration does not by itself authorize any Agent to search or use that provider. A `SKILL_HUB` provider MUST remain binding/source-policy enabled unless a later change defines a reserved default-enabled SkillHub source. Catalog MUST NOT call SkillHub `SEARCH` solely because `providerKind=SKILL_HUB`.

Local Agent source authorization MUST come from trusted app composition, Agent package or compiled Agent assembly facts. The first release MUST support at least provider-level authorization by `agentId + providerId`. Implementations MAY support narrower local constraints such as `skillIds`, namespace, publisher, package hash or signature/trust facts. Remote response fields, installed index facts, Skill manifest metadata, descriptor metadata, client input, model output and capability arguments MUST NOT grant or expand this authorization.

Remote-returned `agentId`, `agentVersion`, publisher, namespace or package facts MAY be used only as consistency inputs. A matching remote response means the candidate is consistent enough to consider; it does not mean the provider or Skill is authorized. Installed facts are cache and loading facts only; if local Agent source authorization is removed, previously installed SkillHub Skills for that provider MUST become invisible on the next `listAvailable` / `resolve`.

#### Scenario: Configured SkillHub provider is not default-enabled

- **WHEN** a `SKILL_HUB` provider is configured and installed facts exist
- **AND** the current Agent has no local source authorization for that provider
- **THEN** Catalog MUST NOT call that provider's SkillHub `SEARCH`
- **AND** `CapabilityCatalog.listAvailable` and `resolve` MUST NOT expose Skills from that provider

#### Scenario: Remote scope match is not authorization

- **WHEN** SkillHub remote search returns a candidate whose remote scope fields match the current Agent
- **AND** the current Agent has no local source authorization for that provider or candidate
- **THEN** the candidate MUST NOT become visible or executable
- **AND** diagnostics MAY record a safe unauthorized-source outcome without exposing raw remote response

#### Scenario: Removed source authorization hides installed Skills

- **WHEN** a SkillHub Skill was previously installed for an Agent/provider
- **AND** the Agent's local source authorization for that provider is later removed
- **THEN** the installed fact MAY remain as provider-private cache
- **AND** `CapabilityCatalog.listAvailable` and `resolve` MUST NOT expose that Skill for the Agent

### Requirement: Remote SkillHub Candidate 不等于 Catalog State

SkillHub remote list/search results SHALL be treated as remote candidate facts only. A remote candidate MUST NOT appear in `CapabilityCatalog.listAvailable`, `CapabilityCatalog.resolve`, model-visible Skill disclosure or Skill Tool target resolution until its package has been downloaded, installed in the managed install area, validated, parsed through the Skill manifest contract and accepted by catalog governance.

#### Scenario: Uninstalled remote candidate is invisible

- **WHEN** SkillHub remote list/search returns a Skill candidate
- **AND** that candidate has not completed managed install and validation
- **THEN** `CapabilityCatalog.listAvailable` MUST NOT return that Skill
- **AND** `CapabilityCatalog.resolve` MUST NOT resolve that Skill
- **AND** model-visible Skill disclosure MUST NOT include that Skill

#### Scenario: Installed, source-authorized and governed SkillHub Skill becomes visible

- **WHEN** a SkillHub candidate is downloaded, installed, manifest-valid and accepted by catalog governance
- **AND** the current Agent has local source authorization for that SkillHub provider/source
- **THEN** the system MAY expose it as a `SKILL` capability descriptor with `providerKind=SKILL_HUB`
- **AND** visibility and execution eligibility MUST still obey availability, binding, policy, conflict and model visibility governance

### Requirement: SkillHub Package 使用 Managed Install 并安全校验

Downloaded SkillHub packages MUST be installed into a provider-owned managed install area derived from frozen provider configuration. The managed install layout, package path, temporary staging path, provider-private index and source loading key are provider-private implementation facts owned by `agent-capability`.

Installed/loading facts MUST be local source facts under the managed install root. They MUST NOT be written as gateway durable records, exposed through `agent-contracts`, or treated as request/session/timeline/application persistence facts. Each accepted installed fact MUST be bound to trusted `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, `providerId`, `skillId` and a package version/hash or equivalent consistency token. Refresh, install, discovery and request-scope catalog candidate selection MUST match those facts against the current trusted scope before contributing governed descriptors; this match is only a cache/discovery consistency check and MUST NOT replace local Agent source authorization. Invocation-time body loading MUST NOT receive `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, binding facts or source-policy facts. The body-loading handoff MUST use only the governed descriptor and its source-owned opaque loading handle or consistency token, not public capability contracts, model output, capability arguments, descriptor metadata scope fields or remote response.

The source-owned loading handle carried by descriptor metadata MUST be opaque. It MUST NOT encode or reveal `tenantId`, `subjectId`, `agentId`, `agentVersion`, `agentAssemblyRef`, endpoint, package ref, managed install path, local file path, remote response facts or package layout facts. Full scope facts MAY remain in the provider-private installed index only.

SkillHub package v1 MUST be a zip archive. Remote gateway adapters MUST return opaque package bytes or an equivalent opaque package reference resolved to bytes at the adapter boundary; they MUST NOT expose a pre-expanded file-content list as the capability package contract. The first release supports only a single-file package rooted at `SKILL.md`; nested `scripts/`, `references/`, `assets/` or other multi-file resource trees are out of scope and MUST be rejected. Package extraction and install MUST reject unsafe archives and incomplete installs. A package MUST NOT contribute descriptor candidates unless install is complete and validation passes.

Validation MUST at least reject encrypted zip entries, unsupported compression methods, directory entries that would materialize outside the staging root, symlink or hardlink entries, special-file entries, duplicate canonical file paths, absolute paths, parent traversal, drive-qualified paths, unsafe filenames, hidden unsafe metadata files, control-character paths, oversized packages, file count budget overflow, missing root `SKILL.md`, unsafe candidate name and manifest/candidate identity mismatch.

#### Scenario: Unsafe package is rejected

- **WHEN** a downloaded SkillHub package contains path traversal, absolute path, drive-qualified path, symlink escape, unsafe filename, hidden unsafe metadata, oversized content or too many files
- **THEN** the package MUST be rejected
- **AND** no descriptor candidate from that package may enter catalog governance
- **AND** diagnostics MUST avoid raw path and package layout leakage

#### Scenario: First release rejects nested Skill resources

- **WHEN** a downloaded SkillHub package contains `scripts/`, `references/`, `assets/` or any other nested resource path
- **THEN** the package MUST be rejected in the first release
- **AND** the system MUST treat that package as unsupported rather than partially installed

#### Scenario: Partial install does not contribute descriptors

- **WHEN** process interruption, extraction failure or validation failure leaves a partial SkillHub install
- **THEN** the partial install MUST NOT contribute descriptor candidates
- **AND** the system MUST clean up, quarantine or ignore partial install state through provider-private logic

#### Scenario: Replacement install keeps previous committed package usable until atomic index publish

- **WHEN** a new SkillHub package version is installed for a Skill that already has a committed package
- **THEN** the installer MUST validate the new package in staging and publish it to a versioned committed directory before replacing the provider-private index
- **AND** the provider-private index MUST be replaced atomically through a temporary index file and rename
- **AND** failure before index replacement MUST NOT delete or invalidate the previously indexed committed package

#### Scenario: Concurrent installs merge facts without dropping a committed Skill

- **WHEN** two SkillHub synchronizations install different accepted Skills into the same managed install root concurrently
- **THEN** provider-private index publication MUST serialize merge/write so both installed facts remain visible after both synchronizations finish
- **AND** one accepted install MUST NOT overwrite another accepted install's fact

#### Scenario: Installed facts are local and scope-bound before descriptor governance

- **WHEN** a SkillHub package has been installed into the managed area
- **THEN** the installed/loading facts MUST remain provider-private local source facts owned by `agent-capability`
- **AND** catalog discovery MUST only contribute descriptor candidates when the stored trusted scope matches the current trusted scope
- **AND** scope mismatch MUST be rejected before the candidate enters the request-scope governed catalog view
- **AND** invocation-time body loading MUST NOT receive or re-check tenant, subject, Agent id, Agent version or Agent assembly scope
- **AND** invocation-time body loading MUST only verify the governed descriptor's provider/source identity, skill identity, opaque loading handle and consistency token against source-owned loading facts
- **AND** gateway records, public descriptors, model context and diagnostics MUST NOT expose the provider-private index, install path or source loading key

#### Scenario: Managed install path remains private

- **WHEN** a SkillHub package is installed successfully
- **THEN** descriptors, metadata, diagnostics, stream events, safe errors, model context and logs MUST NOT expose managed install absolute path, temporary path, package internal layout or source loading key

### Requirement: Installed SkillHub Skill 复用统一 SKILL.md Manifest Contract

Installed SkillHub Skills MUST use the same `SKILL.md` manifest contract as builtin and local Skills. SkillHub source discovery MUST use `SkillDocumentService.parseMetadataView(...)` or the same implementation family to parse descriptor registration facts. Full Skill body MUST NOT be loaded during remote candidate handling or discovery except through the authorized body loading path.

#### Scenario: SkillHub manifest uses standard parser

- **WHEN** SkillHub source discovery processes an installed Skill package
- **THEN** discovery MUST parse `SKILL.md` through the standard Skill manifest parser/mapper
- **AND** it MUST produce a normal `CapabilityDescriptor` and typed `SkillMetadata`
- **AND** it MUST NOT define SkillHub-only manifest fields that drive visibility, authorization, routing or execution

#### Scenario: Invalid manifest is rejected safely

- **WHEN** installed SkillHub `SKILL.md` is missing, has invalid name, invalid description, unsupported context, unsafe model declaration or candidate name mismatch
- **THEN** that Skill MUST NOT enter catalog as an available Skill
- **AND** diagnostics MAY reuse `SkillManifestDiagnostic` safe reason codes
- **AND** raw manifest content MUST NOT be exposed

### Requirement: SkillHub Source 复用 Capability Discovery、Catalog 和 SkillSourceDiscovery

SkillHub source MUST reuse the existing capability discovery and catalog governance path. It MUST produce `SKILL` descriptor candidates through `CapabilityDiscovery` and invocation-time body loading through implementation-local `SkillSourceDiscovery`. The system MUST NOT create SkillHub-only Skill DTOs, SkillHub-only catalog, SkillHub-only invocation contract or SkillHub-only model-visible disclosure format.

#### Scenario: SkillHub discovery returns normal Skill descriptors

- **WHEN** SkillHub source discovery finds an installed and manifest-valid Skill
- **THEN** it MUST return a normal `CapabilityDescriptor` with `kind=SKILL` and `provider.providerKind=SKILL_HUB`
- **AND** the descriptor MUST use manifest name as capability id and manifest description as safe description

#### Scenario: SkillHub body loading uses SkillSourceDiscovery

- **WHEN** `Skill` Tool invokes a governed SkillHub Skill
- **THEN** the Tool MUST load canonical body through the registered SkillHub source/discovery `loadCanonicalBodyView(...)`
- **AND** that loader MUST use source-owned internal loading facts and standard body slicing
- **AND** descriptor/body consistency mismatch MUST safe-fail or force governed re-resolve
- **AND** the loader MUST NOT make capability authorization decisions or consume binding/source-policy facts, runtime owner scope, runtime Agent scope or `agentAssemblyRef`; authorization and scope matching are owned by refresh/install/discovery and the request-scope catalog resolver before body loading

#### Scenario: No parallel invocation contract

- **WHEN** a SkillHub Skill is invoked
- **THEN** the result semantics MUST be the same `Skill` Tool / `CapabilityInvocationResult` semantics as other Skills
- **AND** SkillHub MUST NOT add a second remote invocation result path

### Requirement: SkillHub Catalog Governance 使用统一可见性和冲突规则

SkillHub candidates MUST be governed by `CapabilityCatalog`. Catalog MUST apply provider disabled state, explicit disabled bindings, availability filtering, conflict/shadowing, `modelInvocable` disclosure filtering and invocation eligibility consistently with other Skill sources.

SkillHub candidates MUST enter the request-scope candidate set only after local Agent source authorization accepts the provider/source for the current Agent. Provider-level source authorization MAY allow SkillHub candidates without per-Skill enabled bindings, but it remains local Agent authorization and MUST be reevaluated on every `listAvailable` and `resolve`.

Catalog SkillHub `SEARCH` MUST call the local Agent source authorization policy before synchronously refreshing remote state, before reading installed facts and before contributing candidates. Enabled capability bindings MAY be source authorization inputs, but they MUST NOT replace that policy boundary.

SkillHub/remote source priority MUST be lower than explicit Agent binding, Agent-owned source, builtin source and system-level local source. A SkillHub candidate with the same `capabilityId` as a higher-priority candidate MUST NOT override it.

#### Scenario: Source authorization enables SkillHub search

- **WHEN** the current Agent has local source authorization for a configured SkillHub provider
- **THEN** Catalog MAY call that provider's SkillHub `SEARCH` with trusted owner and Agent scope
- **AND** returned installed candidates MUST still pass explicit disabled binding, availability, conflict/shadowing, model visibility and invocation eligibility gates

#### Scenario: SkillHub provider kind alone does not enable search

- **WHEN** a configured provider has `providerKind=SKILL_HUB`
- **AND** the current Agent lacks local source authorization for that provider
- **THEN** Catalog MUST NOT treat the provider as default-enabled
- **AND** candidates from that provider MUST NOT enter the current Agent's visible or executable catalog view

#### Scenario: Disabled binding excludes SkillHub Skill

- **WHEN** a SkillHub Skill is installed and manifest-valid
- **AND** current Agent assembly contains an explicit disabled binding for the same provider/capability key
- **THEN** catalog MUST exclude that Skill from `listAvailable` and `resolve`

#### Scenario: SkillHub does not override higher-priority source

- **WHEN** a SkillHub Skill and a higher-priority Skill source expose the same `capabilityId` for the same Agent
- **THEN** catalog MUST keep the higher-priority candidate as winner
- **AND** the SkillHub candidate MUST be shadowed, rejected or unavailable for that Agent
- **AND** a safe shadow/governance diagnostic MUST be available

#### Scenario: modelInvocable remains disclosure-only

- **WHEN** a SkillHub Skill descriptor has `modelInvocable=false`
- **THEN** Context Engine MUST NOT disclose it in model-visible Skill list
- **AND** governed Skill Tool target resolution MAY still execute it when authorized by non-disclosure governance paths

#### Scenario: SkillHub candidates are agent-scoped

- **WHEN** SkillHub refresh/install facts were produced for one Agent scope
- **THEN** another Agent's `listAvailable` or `resolve` MUST NOT see those SkillHub Skills unless separately installed and governed for that Agent scope

### Requirement: SkillHub Failure 不阻塞既有 Skill Sources

SkillHub provider failure MUST be isolated to that provider. Remote unavailable, provider disabled, credential failure, remote candidate metadata invalid, download failure, package rejection, install incomplete or manifest invalid MUST NOT block builtin Skill source, system-level local Skill source, Agent-owned local Skill source or normal request lifecycle.

#### Scenario: SkillHub unavailable does not block builtin/local Skills

- **WHEN** SkillHub refresh fails or provider is unavailable
- **THEN** builtin and local Skill sources MUST continue to contribute their governed descriptors
- **AND** request lifecycle MUST NOT wait indefinitely for SkillHub
- **AND** SkillHub failure MUST be visible only through safe diagnostics or unavailable provider state

#### Scenario: Failed SkillHub candidate is not silently registered

- **WHEN** SkillHub candidate fails metadata, download, install, manifest or governance checks
- **THEN** that candidate MUST NOT appear in model-visible Skill list or Skill Tool target resolution
- **AND** the failure MUST be safely diagnosable

### Requirement: SkillHub Diagnostics 安全且 Implementation-Local

SkillHub diagnostics/readiness evidence SHALL remain implementation-local to startup/readiness/capability diagnostics boundaries. This change MUST NOT add Web API responses, stream events, audit schema, metric schema or public readiness DTOs for SkillHub diagnostics.

Diagnostics MUST use stable safe outcome codes and sanitized messages. Outcome codes MUST cover provider disabled/unavailable, refresh unavailable, remote metadata invalid, remote scope mismatch, download failed, package rejected, install incomplete, missing manifest, invalid manifest, candidate installed, governance unavailable, Skill shadowed and Skill registered.

#### Scenario: Diagnostics do not leak sensitive facts

- **WHEN** SkillHub source emits diagnostics, safe errors, logs, metrics, descriptor metadata, stream projection, model-visible capability context or audit-related facts
- **THEN** those outputs MUST NOT contain raw credential, raw remote response, download URL, endpoint token, managed install absolute path, temporary path, package internal layout, raw manifest content, full Skill body or source loading key

#### Scenario: Successful registration is governed

- **WHEN** SkillHub package is downloaded and manifest-valid
- **AND** catalog governance cannot resolve it as available or model-visible for the current Agent due to disabled binding, conflict or availability failure
- **THEN** diagnostics MUST NOT report the Skill as fully registered for that Agent
- **AND** diagnostics MUST report a safe governance unavailable, disabled or shadowed outcome

### Requirement: Runtime/Core/Context 不直接访问 SkillHub Source

Runtime, Agent Core, Context Engine, Model and Channel packages MUST consume SkillHub capability facts only through compiled assembly facts, `CapabilityCatalog` governed view, existing Skill Tool invocation result and safe diagnostics. They MUST NOT directly access SkillHub endpoint, remote gateway adapter, managed install root, package files, source-owned loading facts or `SKILL.md` files.

#### Scenario: Runtime/Core/Context consume catalog only

- **WHEN** runtime, core, context engine, model or channel need SkillHub Skill visibility or execution facts
- **THEN** they MUST use `CapabilityCatalog`, `CapabilityInvocationPort`, existing Skill Tool result or safe public contracts
- **AND** they MUST NOT scan managed install directories, parse SkillHub `SKILL.md`, call remote gateway or inspect source-owned loading facts

#### Scenario: Architecture gate blocks source boundary escape

- **WHEN** dependency architecture validation runs
- **THEN** it MUST fail if runtime, core, context engine, model or channel import SkillHub source implementation, remote gateway adapter private implementation or managed install reader
- **AND** it MUST fail if `agent-capability` imports remote provider SDK/private adapter implementation instead of the injected boundary
- **AND** it MUST fail if `agent-platform-gateway-remote` imports `agent-capability` to implement SkillHub remote access
