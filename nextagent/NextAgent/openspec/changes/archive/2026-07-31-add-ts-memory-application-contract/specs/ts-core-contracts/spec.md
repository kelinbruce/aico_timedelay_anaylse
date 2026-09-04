## MODIFIED Requirements

### Requirement: Core Contract Namespace

TS 后端 MUST 提供 `agent-common` foundation package 和 `agent-contracts` boundary namespace，承载最小内核和后续并行 change 共享的基础类型、public DTO、enum、port 和 schema skeleton。核心 value object、DTO、enum 和 port MUST 具备稳定名称、必需字段和调用签名。实现模块 MUST 通过 `agent-common` 使用共享 id、value object、语言/区域、身份、secret reference、安全错误形态和被多个边界共同消费的基础 enum，并通过 `agent-contracts` 交换 runtime、channel、session、attachment、context、model、capability、core、gateway、observability 和 app 契约，不得通过实现包 private 类型建立跨模块契约。

#### Scenario: 实现包消费核心契约

- **WHEN** runtime、channel、session、core、context、model、capability、memory、gateway、observability 或 app package 需要跨模块交换请求、状态、事件、结果或诊断
- **THEN** 该交换 MUST 使用核心 contract namespace 中的 public contract
- **AND** implementation package 不得把自身 private DTO 作为其他 package 的 public dependency

#### Scenario: 基础类型归属 agent-common

- **WHEN** 团队定义或消费 shared id、基础 value object、JSON value、时间/幂等键、当前身份值对象、secret reference、安全错误形态或跨多个边界共同消费的基础 enum
- **THEN** 该 contract MUST 由 `agent-common` owning
- **AND** `agent-common` MUST NOT import `agent-contracts`
- **AND** `agent-contracts` subpath export MUST import and reuse these foundation contracts instead of redefining them
- **AND** TS 后端 MUST NOT introduce `agent-contracts/common` as an owning module for foundation contracts

#### Scenario: 契约按拥有模块导出

- **WHEN** 团队实现或消费核心 DTO、enum、schema skeleton 或 port
- **THEN** 每个 public contract MUST 具有唯一 owning export module
- **AND** `agent-contracts` MUST 提供 runtime、channel、session、attachment、context、model、capability、core、gateway、observability 和 app 的稳定 subpath export
- **AND** shared id、value object、identity context、locale/language value、secret reference、safe error shape、RunStatus、TerminalCommitState、TimelineEventType、CheckpointTriggerReason、CapabilityKind、CapabilityProviderKind、CapabilityReplayPolicy and CapabilityInvocationStatus MUST NOT be owned by any `agent-contracts/*` subpath
- **AND** subpath export MUST represent module public surface and dependency boundary, not a cosmetic namespace
- **AND** identity、timeline、checkpoint、pending-input、hook、sandbox、content、errors、configuration and conversation annotation MUST NOT be introduced as separate owning subpaths unless a later architecture change creates a distinct owning module for that boundary
- **AND** `agent-contracts/channel` MUST own `LongTermMemoryManagementPort` and its management DTOs for the Channel-facing long-term-memory boundary, without importing or duplicating Gateway persistence contracts
- **AND** checkpoint payload、pending input、hook lifecycle and timeline contracts MUST be owned by `agent-contracts/runtime`
- **AND** content references and artifact metadata domain contracts MUST be owned by `agent-contracts/session`
- **AND** sandbox execution request/result/port MUST be owned by `agent-contracts/gateway`
- **AND** ErrorNormalizer MUST be owned by `agent-contracts/observability`
- **AND** app configuration contracts MUST be owned by `agent-contracts/app`
- **AND** root `agent-contracts` re-exports, if provided, MUST only re-export stable public contracts and MUST NOT become an owning module
- **AND** implementation package MUST import from the owning subpath export when it depends on a specific module boundary

#### Scenario: Enum 归属按共享语义确定

- **WHEN** 团队定义或移动 enum
- **THEN** `agent-common` MUST own only cross-boundary, durable, system-level vocabulary consumed by multiple module boundaries
- **AND** business vocabulary private to a single domain boundary MUST remain in its owning `agent-contracts/*` subpath
- **AND** gateway-only persistence value vocabulary MUST use gateway-owned record value types instead of forcing domain enum ownership into `agent-common`
- **AND** implementation package MUST NOT 通过 adapter-private DTO、数据库 schema、provider SDK 类型、本地路径布局或其他 implementation package 暴露跨模块契约

#### Scenario: 契约面具备可实现字段和签名

- **WHEN** 团队实现 runtime、channel、context、model、capability、memory、gateway、sandbox、hook、checkpoint、observability 或 app composition 的跨模块边界
- **THEN** 核心 contract namespace MUST 提供对应 public DTO、enum、schema 和 port signature
- **AND** contract tests MUST 能校验这些 public contract 的必需字段、enum vocabulary 和方法签名没有发生未声明漂移

#### Scenario: 后续 change 扩展核心契约

- **WHEN** 后续 change 需要改变 runtime command、event vocabulary、owner scope、safe error、capability descriptor、long-term-memory management port、gateway port 或其他共享契约
- **THEN** 该 change MUST 修改或扩展核心 contract namespace
- **AND** 不得在单个实现包中创建竞争性的共享契约

### Requirement: Contract Subpaths Remain Architecture-Owned

TS core contracts SHALL remain consumable through architecture-owned public subpaths. A contract subpath SHALL represent a stable boundary owned by its module responsibility, not a catch-all shared type bucket.

#### Scenario: Product modules consume only authorized contract subpaths

- **WHEN** product packages import `agent-contracts`
- **THEN** they MUST import from explicit subpaths such as `agent-contracts/runtime`、`agent-contracts/channel` or `agent-contracts/model`
- **AND** product packages MUST NOT import from the `agent-contracts` root aggregate export
- **AND** each product package MUST consume only the subpaths authorized by `openspec/designs/architecture/ts-backend-architecture.md` and the corresponding `openspec/designs/modules/<module>.md`
- **AND** new subpath consumption MUST be introduced through an OpenSpec update that explains the architecture owner and cycle risk

#### Scenario: Agent assembly facts use a narrow contract subpath

- **WHEN** runtime、core、context or capability code needs accepted Agent assembly facts
- **THEN** it MUST consume `AgentAssembly`, `AgentCapabilityBinding`, `AgentRuntimeSettings` and `AgentAssemblyRegistry` from `agent-contracts/agent-assembly`
- **AND** `agent-contracts/agent-assembly` MUST NOT export the `Agent` execution interface, raw `AgentDefinition`, AgentDefinition parser/loader types, `AgentAssemblyCompiler`, `ResourceInventory`, `SystemConfig`, provider credentials, gateway config or channel config
- **AND** the `Agent` execution interface MUST remain in `agent-contracts/runtime`
- **AND** context and capability packages MUST NOT import `agent-contracts/runtime` only to obtain assembly facts

#### Scenario: Contracts do not encode convenience dependencies

- **WHEN** a module needs a type owned by another architecture boundary only because of current implementation convenience
- **THEN** the type MUST either move to the owning contract subpath, be exposed through a narrower owning port, or be passed by `agent-app` composition
- **AND** implementation convenience MUST NOT justify adding broad subpath imports such as core-to-gateway or context-to-runtime lifecycle dependencies

#### Scenario: Channel management contract does not duplicate Gateway contract

- **WHEN** Channel or another upper adapter needs user-facing long-term memory operations
- **THEN** it MUST consume `LongTermMemoryManagementPort` from `agent-contracts/channel`
- **AND** `agent-contracts/channel` MUST own long-term-memory management commands、queries、views and results
- **AND** `agent-contracts/gateway` MUST continue to own persistence Records、Gateway requests/queries、write options and Store/Retriever/Sharing ports
- **AND** neither subpath MUST re-export the other subpath's DTOs as aliases
- **AND** the dependency direction MUST remain `agent-channel-web -> agent-contracts/channel.LongTermMemoryManagementPort -> agent-memory implementation -> agent-contracts/gateway`, with `agent-app` limited to composition and wiring

#### Scenario: Equivalent cases use one policy

- **WHEN** two contract, persistence or runtime shapes share the same semantic category, lifecycle phase, boundary and safety/consistency invariants
- **THEN** they MUST use the same owner, naming rule, contract shape and validation strategy
- **AND** equivalent cases MUST NOT introduce parallel DTOs, Records, Requests, enums, ports, stores or helper APIs with the same semantics
- **AND** changing the policy for one equivalent case MUST update the OpenSpec design and apply the same policy to all equivalent cases in scope
- **AND** exceptions MUST be documented in OpenSpec design with the reason, owner, scope and verification path before implementation

#### Scenario: Shared durable vocabulary stays in common

- **WHEN** a scalar vocabulary is used by multiple contract subpaths such as a domain view and its gateway Record
- **THEN** the vocabulary MUST be defined once in `agent-common`
- **AND** `agent-common` MUST NOT define DO、DTO、Record、port or service contracts
- **AND** `agent-contracts/gateway` MUST NOT import sibling business subpaths such as `agent-contracts/session`、`agent-contracts/runtime`、`agent-contracts/attachment` or `agent-contracts/channel` only to reuse enum-like vocabulary
- **AND** gateway MUST NOT define duplicate `*RecordRole`、`*RecordType`、`*RecordKind` or `*RecordStatus` aliases for vocabulary that already exists in `agent-common`

#### Scenario: Runtime owns run message append boundary

- **WHEN** Agent core needs to append assistant tool-use, capability result or other execution-time session messages
- **THEN** it MUST call `AgentRunStatePort.appendMessage(run, context, draft)` from `agent-contracts/runtime`
- **AND** the appended content MUST be represented as a `SessionMessageDraft` from `agent-contracts/session`
- **AND** `SessionMessageDraft` MUST contain message content fields such as role、content、contentType、visible、metadata and a required idempotency key, not complete owner/agent/session/run/timestamp coordinates
- **AND** runtime implementation MUST combine trusted `RequestRun` and `RequestContext` with the draft before writing gateway records or appending active context
- **AND** Agent core MUST NOT import `agent-contracts/gateway` to persist intermediate messages
