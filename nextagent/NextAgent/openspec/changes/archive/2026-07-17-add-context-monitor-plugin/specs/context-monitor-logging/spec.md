# context-monitor-logging Specification

## ADDED Requirements

### Requirement: SDK provides context-monitor plugin definition

`agent-plugin-sdk` SHALL provide a `context-monitor` plugin definition that can be constructed without changing other packages. The plugin SHALL contribute an observe-only lifecycle hook named `context-monitor.context-evolution`.

The hook SHALL support `BEFORE_MODEL_INVOKE`, `AFTER_MODEL_RESULT`, `AFTER_CONTEXT_COMPACT`, `BEFORE_CONTEXT_COMPACT`, and `BEFORE_AGENT_TERMINAL`. The hook SHALL NOT return mutation and SHALL use `failureMode: CONTINUE`.

#### Scenario: Context monitor plugin exposes the expected hook
- **WHEN** SDK code creates the context-monitor plugin
- **THEN** the plugin id MUST be `context-monitor`
- **AND** the plugin MUST expose hook `context-monitor.context-evolution`
- **AND** the hook MUST be observe-only and support the five declared stages
- **AND** the hook MUST use `failureMode: CONTINUE`

### Requirement: Context monitor records per-session context evolution

The hook SHALL maintain in-memory state keyed by `sessionId` holding the latest `BEFORE_MODEL_INVOKE` messages and the latest `AFTER_MODEL_RESULT` answer. The hook SHALL NOT write to disk on every model invocation; it SHALL only overwrite the in-memory latest state.

When `AFTER_CONTEXT_COMPACT` fires, the hook SHALL capture the current in-memory latest messages as the pre-compression snapshot and the `AFTER_CONTEXT_COMPACT.boundary.content` as the summary text, and SHALL mark a compression as pending. When the next `BEFORE_MODEL_INVOKE` fires while a compression is pending, the hook SHALL write one `compact-{sessionId}-{序号}.json` file containing the pre-compression messages, the post-compression messages (the current `BEFORE_MODEL_INVOKE.boundary.messages`), and the summary text, then clear the pending state and update the in-memory latest.

When `BEFORE_AGENT_TERMINAL` fires, the hook SHALL overwrite one `last-{sessionId}.json` file containing the in-memory latest messages and the in-memory latest answer.

The total number of files written per session SHALL be `1 + 压缩次数` (one `last` file plus one `compact` file per compression).

#### Scenario: Compression writes a compact file with before and after messages
- **WHEN** a session triggers context compression
- **THEN** the hook MUST capture the pre-compression messages from the in-memory latest snapshot
- **AND** the hook MUST capture the summary text from `AFTER_CONTEXT_COMPACT.boundary.content`
- **AND** on the next `BEFORE_MODEL_INVOKE` the hook MUST write one `compact-{sessionId}-{序号}.json`
- **AND** that file MUST contain the pre-compression messages, the post-compression messages, and the summary text
- **AND** the in-memory latest MUST then be updated to the post-compression messages

#### Scenario: Terminal writes a single overwrite last file
- **WHEN** a run reaches `BEFORE_AGENT_TERMINAL`
- **THEN** the hook MUST overwrite `last-{sessionId}.json` with the latest messages and the latest answer
- **AND** a follow-up turn in the same session MUST overwrite the same `last-{sessionId}.json`

#### Scenario: Non-compression turns do not write compact files
- **WHEN** a model invocation occurs without a pending compression
- **THEN** the hook MUST NOT write any `compact-*.json` file
- **AND** the hook MUST only update the in-memory latest state

### Requirement: Context monitor is observe-only

The hook SHALL NOT change request truth. The hook SHALL NOT return a boundary mutation. If the configured sink throws, the hook SHALL catch the error and return `PASS`. The hook SHALL NOT propagate recording failures to the protected operation.

#### Scenario: Failing sink does not affect hook outcome
- **WHEN** the configured sink throws during recording
- **THEN** the hook MUST catch the error
- **AND** the hook MUST still return `PASS`
- **AND** the protected operation MUST continue unaffected

### Requirement: Context monitor logging is caller-owned

The SDK plugin SHALL accept a caller-provided log sink. The SDK SHALL NOT change app config or require a new host external. The SDK MAY provide a file sink helper that writes to a caller-provided `logDirectory`; that helper MUST keep every written file under the caller-provided directory and MUST reject a file name that escapes the directory.

#### Scenario: SDK file sink writes under caller-provided logs directory
- **WHEN** a caller creates the SDK file sink with a `logDirectory`
- **THEN** the sink MUST write `compact-*.json` and `last-*.json` files under that directory
- **AND** it MUST reject a file name that escapes the directory via absolute path or `..`

### Requirement: SDK can write a formal context-monitor plugin artifact

`agent-plugin-sdk` SHALL provide a helper from the `context-monitor` subpath that writes a formal local plugin artifact for the context-monitor plugin. The artifact SHALL consist of `plugin.json` and a single-file ESM `index.js` under a caller-provided target directory. The artifact manifest SHALL use plugin id `context-monitor`, API version `1.0`, `main: "./index.js"`, `artifactType: "esm-bundle"`, and no host externals.

The generated `index.js` SHALL contribute hook `context-monitor.context-evolution` and SHALL be usable through the existing plugin loader path without adding app/runtime/config schema changes. The artifact hook SHALL support activation config for `enabled`, `logDirectory`. The helper SHALL fail if artifact files already exist unless the caller explicitly requests overwrite.

#### Scenario: SDK writes loader-compatible context-monitor artifact
- **WHEN** SDK code creates a context-monitor plugin artifact under a target directory
- **THEN** the target directory MUST contain `plugin.json` and `index.js`
- **AND** `plugin.json` MUST declare `artifactType: "esm-bundle"` and `main: "./index.js"`
- **AND** the generated plugin MUST expose `context-monitor.context-evolution`
- **AND** running the helper again without overwrite MUST fail closed

#### Scenario: Product path loads generated artifact and records context evolution
- **WHEN** an app system config declares the generated `context-monitor` plugin artifact
- **AND** the target Agent activates hook `context-monitor.context-evolution`
- **WHEN** a session runs a turn that triggers compression
- **THEN** the app MUST load the generated artifact through the normal plugin loader
- **AND** the activated hook MUST write a `compact-{sessionId}-{序号}.json` under the configured log directory
- **AND** the request MUST still complete successfully

### Requirement: Local runtime packaging includes context-monitor artifact without default activation

Local runtime packaging SHALL include the generated `context-monitor` plugin artifact under `config/plugins/context-monitor/`. The package config sample SHALL NOT declare `nextAgent.system.plugins[]` for this plugin, and packaging SHALL NOT add Agent `hooks[]` activation.

#### Scenario: Packaged runtime contains artifact but config sample stays inactive
- **WHEN** local runtime packaging stages a backend-capable package
- **THEN** the candidate MUST contain `config/plugins/context-monitor/plugin.json`
- **AND** the candidate MUST contain `config/plugins/context-monitor/index.js`
- **AND** `config/default-system.yaml` MUST NOT declare `nextAgent.system.plugins[]` for `context-monitor`
- **AND** the default Agent MUST NOT be modified to activate `context-monitor.context-evolution`
