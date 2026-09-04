# context-monitor-logging Specification

## Purpose
定义 Context Monitor 插件的配置、观测事件和日志投影契约，使上下文组装过程可以被诊断而不泄漏 prompt 或模型内容。
## Requirements
### Requirement: SDK provides context-monitor plugin definition

`agent-plugin-sdk` SHALL provide a `context-monitor` plugin definition that can be constructed without changing other packages. The plugin SHALL contribute an observe-only lifecycle hook named `context-monitor.context-evolution`.

The hook SHALL support `BEFORE_MODEL_INVOKE`, `AFTER_MODEL_RESULT`, `AFTER_CONTEXT_COMPACT`, `BEFORE_CONTEXT_COMPACT`, and `BEFORE_AGENT_TERMINAL`. The hook SHALL NOT return mutation and SHALL use `failureMode: CONTINUE`.

#### Scenario: Context monitor plugin exposes the expected hook
- **WHEN** SDK code creates the context-monitor plugin
- **THEN** the plugin id MUST be `context-monitor`
- **AND** the plugin MUST expose hook `context-monitor.context-evolution`
- **AND** the hook MUST be observe-only and support the five declared stages
- **AND** the hook MUST use `failureMode: CONTINUE`

### Requirement: Context monitor is observe-only

The hook SHALL NOT change request truth. The hook SHALL NOT return a boundary mutation. If the configured sink throws, the hook SHALL catch the error and return `PASS`. The hook SHALL NOT propagate recording failures to the protected operation.

#### Scenario: Failing sink does not affect hook outcome
- **WHEN** the configured sink throws during recording
- **THEN** the hook MUST catch the error
- **AND** the hook MUST still return `PASS`
- **AND** the protected operation MUST continue unaffected

### Requirement: Local runtime packaging includes context-monitor artifact without default activation

Local runtime packaging SHALL include the generated `context-monitor` plugin artifact under `config/plugins/context-monitor/`. The package config sample SHALL NOT declare `nextAgent.system.plugins[]` for this plugin, and packaging SHALL NOT add Agent `hooks[]` activation.

#### Scenario: Packaged runtime contains artifact but config sample stays inactive
- **WHEN** local runtime packaging stages a backend-capable package
- **THEN** the candidate MUST contain `config/plugins/context-monitor/plugin.json`
- **AND** the candidate MUST contain `config/plugins/context-monitor/index.js`
- **AND** `config/default-system.yaml` MUST NOT declare `nextAgent.system.plugins[]` for `context-monitor`
- **AND** the default Agent MUST NOT be modified to activate `context-monitor.context-evolution`
