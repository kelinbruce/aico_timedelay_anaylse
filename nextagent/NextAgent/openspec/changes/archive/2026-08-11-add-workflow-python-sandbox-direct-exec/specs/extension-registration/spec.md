## Function

- **所属 Function**: extension-registration
- **Function 变更类型**: MODIFIED

## ADDED Requirements

### Requirement: WorkflowSandboxExecutionPort is a capability-owned narrow sandbox port

`agent-capability` SHALL expose `WorkflowSandboxExecutionPort` as a public export. The port SHALL expose only `runPython` for executing Python source through the sandbox gateway boundary. The port SHALL NOT expose `runShell`, `runShellStreaming`, `runShellBackgroundable`, `startBackgroundShell`, `WorkspaceFilePort`, sandbox gateway internals, or any capability executor or catalog internals.

`agent-capability` SHALL own the assembly of `WorkflowSandboxExecutionPort` from the same trusted startup options used to assemble the Tool-facing `SandboxExecutionPort`. App composition MAY pass the same trusted startup options/adapters required to assemble the dependency, but MUST NOT directly create, retain, return, or call `WorkspaceFilePort` or `SandboxExecutionPort`.

The port MUST route execution through the same sandbox gateway boundary, risk policy, and safe error mapping as the Tool-facing `SandboxExecutionPort.runPython`. The port MUST NOT route through the capability executor, capability catalog, or nl2py guardrail.

#### Scenario: Port exposes only runPython

- **WHEN** `WorkflowSandboxExecutionPort` is created by `agent-capability`
- **THEN** the port MUST expose only a `runPython` operation
- **AND** MUST NOT expose shell execution, background execution, streaming, workspace files, or sandbox internals

#### Scenario: Port routes through sandbox gateway

- **WHEN** `WorkflowSandboxExecutionPort.runPython` is called
- **THEN** execution MUST route through the sandbox gateway boundary
- **AND** risk policy and safe error mapping MUST apply
- **AND** MUST NOT route through capability executor or nl2py guardrail

#### Scenario: App composition does not touch sandbox internals

- **WHEN** app composition creates the workflow node catalog
- **THEN** app composition MUST receive `WorkflowSandboxExecutionPort` from `agent-capability`
- **AND** MUST NOT directly create or call `SandboxExecutionPort` or `WorkspaceFilePort`
