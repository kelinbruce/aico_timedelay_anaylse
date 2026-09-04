# local-file-roll Specification

## Purpose
Define the Node-only technical-foundation package `@nextagent/agent-local-file-roll` that provides async rolling-line file destination, size+daily rotation, active identity, atomic gzip, startup reconciliation, elapsed retention, single maintenance lane and bounded close. It is a mechanism-only package with no domain semantics.

## Function

- **所属 Function**：`FN-7.4 写出运行日志`
- **spec 角色**：主规格

## Requirements

### Requirement: Local rolling files use one narrow Node-only technical foundation

The workspace SHALL provide `@nextagent/agent-local-file-roll` as a Node-only technical-foundation package. It SHALL expose only a narrow rolling-line factory and the policy, append-result, active-identity and bounded lifecycle types required to create an independently owned handle. It SHALL own the direct `pino-roll@4.0.0` and `sonic-boom@4.2.1` dependencies and its private use of Node filesystem and zlib APIs.

The package MUST NOT depend on `agent-common`, `agent-contracts` or a product implementation package. It MUST NOT define or import RuntimeLogger, Pino operational envelopes, MetricSample, NextAgentMetricSnapshot, AuditEventRecord, deployment configuration, readiness state or owner-specific failure vocabulary. Its public policy MUST NOT accept a `log | metrics | audit` mode, arbitrary file matcher, arbitrary deletion callback or business serializer. A generic `agent-utils` or semantic `agent-file-output` package MUST NOT be introduced as an alternative boundary.

Production dependency policy SHALL allow only `agent-log`, `agent-observability` and `agent-platform-gateway-local` to import `agent-local-file-roll`. Tests MAY use its public export under the repository test-only dependency policy; this change MUST NOT add a testing entrypoint unless a concrete test seam requires one. No other business, channel, runtime, model, capability, gateway-remote, app or contract package may use it directly.

#### Scenario: Package dependency graph preserves the foundation boundary

- **WHEN** workspace manifests, exports and source imports are inspected
- **THEN** pino-roll, SonicBoom and rolling-file zlib lifecycle code MUST be owned only by agent-local-file-roll
- **AND** only the three approved production consumers may depend on its public export
- **AND** the package MUST have no dependency on common, contracts or product implementation packages
- **AND** the existing ban on implementation-to-implementation dependencies MUST remain effective for every other package pair

#### Scenario: A consumer attempts to pass output semantics into the mechanism

- **WHEN** a caller supplies a business mode, serializer, arbitrary matcher or deletion callback
- **THEN** the public contract or runtime policy validation MUST reject it
- **AND** the mechanism MUST NOT branch on operational, metrics or audit vocabulary

### Requirement: Each output owner creates an independent rolling-file handle

`agent-log` SHALL create separate independently owned local-file-roll handles for operational and plugin diagnostic families. `LocalMetricHistoryExporter` and `FileAuditEventStoreGateway` SHALL each create another independently owned handle from its trusted frozen family policy. The four handles MAY share factory and mechanism code, but MUST NOT share destination, active-file identity, buffer, timer, maintenance lane, mutable state, close state or policy object. Failure, overload, maintenance or close of one handle MUST NOT stop, flush, mutate or age another handle.

Each output owner SHALL remain responsible for line serialization and schema, policy values, append/export/log result interpretation, readiness and degraded/recovered mapping. The foundation package SHALL report only bounded mechanism outcomes and MUST NOT write operational diagnostics, metrics or audit evidence itself.

#### Scenario: Three local output families run concurrently

- **WHEN** operational, metrics and audit output are enabled in one LOCAL process
- **THEN** exactly four independent handles MUST own four active destinations and four mutually exclusive derived selectors
- **AND** closing or degrading one handle MUST leave the other two available
- **AND** no handle may discover, compress, age or delete a file owned by another handle

### Requirement: Local file roll provides safe bounded lifecycle mechanics

The factory SHALL validate a trusted directory, safe base name, extension, `sequence | date-sequence` naming shape, positive size threshold, bounded async buffer, elapsed retention and an optional positive archive-count limit before creating a handle. It SHALL derive the exact owned-file selector from those validated values. It MUST NOT follow symlinks or operate on outside, unknown or non-regular files.

Every handle SHALL provide non-blocking bounded line enqueue, size-or-fixed-process-local-daily rotation, transport-owned active identity, `.gz.tmp -> atomic .gz -> delete closed source` compression, original closed/rotation timestamp preservation, startup reconciliation, periodic archive work, elapsed-time retention and bounded idempotent close. Gzip, rename or interrupted compression MUST preserve at least one recoverable source or committed archive. Retention failure MUST preserve evidence for retry. Maintenance MUST exclude the current active destination and MUST run in the handle's single serialized lane.

When a handle policy supplies `maxArchiveFiles`, startup and periodic archive maintenance SHALL count only committed regular `.gz` files matched by that handle's exact archive selector. After compression, maintenance SHALL delete the oldest archive by `mtime`, with file name as a deterministic tie-breaker, until the count is within the configured limit. Count cleanup and elapsed-time retention SHALL be independent deletion conditions. Temporary archives, closed sources, active files, symlinks, unknown files and other families MUST NOT count toward the limit or be deleted by it. A deletion failure MUST preserve the archive for retry and MAY temporarily leave the family above the limit without affecting business work.

#### Scenario: Owned committed archives exceed the configured limit

- **WHEN** a handle configured with `maxArchiveFiles=10` owns eleven committed gzip archives that are still within elapsed retention
- **THEN** maintenance MUST delete only the oldest owned archive
- **AND** exactly ten committed owned archives MUST remain after successful maintenance
- **AND** source and temporary files MUST remain governed only by their existing compression/reconciliation rules rather than the count calculation
- **AND** active, symlink, unknown and cross-family files MUST remain unchanged

#### Scenario: Closed file is archived and aged safely

- **WHEN** an exactly owned non-active source is closed by size or the process-local daily boundary
- **THEN** its handle MUST create a temporary gzip, atomically commit it and only then delete the source
- **AND** the archive MUST preserve the original closedAt used for elapsed retention
- **AND** startup reconciliation or periodic maintenance MUST delete it only after its owner policy expires

#### Scenario: Unsafe or ambiguous file is encountered

- **WHEN** maintenance encounters an active, young, symlink, outside, unknown, cross-family or ambiguously timestamped file
- **THEN** it MUST preserve the file
- **AND** it MUST NOT broaden its selector or block a business path

### Requirement: Operational active identity remains an owner-controlled projection

A local-file-roll handle MAY expose its current transport-owned active identity to its direct owner. Only `agent-log` MAY project that identity through trusted app composition to Agent Dev Workbench. The foundation package MUST NOT expose directory scanning, archive reading, gzip decompression or highest-sequence guessing APIs.

#### Scenario: Workbench requests operational evidence

- **WHEN** agent-log projects the current active identity from its own handle
- **THEN** app MAY inject that bounded provider into the workbench
- **AND** metrics and audit handles MUST remain undiscoverable to the workbench
- **AND** the workbench MUST NOT import agent-local-file-roll directly
