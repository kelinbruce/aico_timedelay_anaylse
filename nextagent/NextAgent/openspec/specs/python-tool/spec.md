# python-tool Specification

## Purpose
Defines `python` as an independent builtin tool for executing Python code snippets through the sandbox gateway. It is a first-class tool identity, not a `bash` sub-command, with bounded input, structured execution result, and mandatory sandbox routing.
## Requirements
### Requirement: Python is an independent builtin tool

The system SHALL provide `python` as an independent builtin tool capability for executing Python code snippets. `python` SHALL be a first-class tool identity and SHALL NOT be implemented as a `bash` sub-command, `bash` wrapper, or `bash`-owned alias.
This independence requirement applies to the model-visible `python` tool identity and execution path in this change. It SHALL NOT by itself remove or redefine an existing `bash`-owned restricted Python-script path with different semantics.

#### Scenario: python is discovered as its own tool

- **WHEN** builtin tool descriptors are listed
- **THEN** `python` appears as its own tool id
- **AND** `bash` and `python` remain separate builtin tools

#### Scenario: python invocation does not route through bash semantics

- **WHEN** the model invokes `python`
- **THEN** the system routes the request to the Python tool handler
- **AND** it MUST NOT first parse or authorize the input using Bash command rules

#### Scenario: existing bash-owned restricted Python path is out of scope

- **WHEN** the product also contains a `bash`-owned restricted Python-script path with trusted allowlist semantics
- **THEN** this change SHALL NOT require that path to be deleted or silently redefined
- **AND** the independent `python` tool in this change MUST still remain model-visible and execution-distinct from that path

### Requirement: Python tool accepts code snippet input

The Python tool MUST accept the following input schema:

- `code` (string, required): Python code snippet to execute
- `preamble` (string, optional): Variable declaration lines prepended to `code` at execution time. MUST NOT be sent to the nl2py guardrail check. When present, the effective sandbox command SHALL be `preamble + "\n" + code`.
- `args` (string array, optional): script arguments
- `timeout_ms` (integer > 0, optional): execution timeout in milliseconds

If `timeout_ms` is omitted, the effective timeout SHALL be `10000` ms. If `timeout_ms` exceeds `120000`, the effective timeout SHALL be capped at `120000` ms. `args` SHALL NOT exceed `100` entries or `8192` UTF-8 bytes total.

#### Scenario: python accepts valid code snippet

- **WHEN** a model provides valid Python input with `code`
- **THEN** the Python handler MUST accept the input
- **AND** execute the code through the Python execution path

#### Scenario: python rejects oversized args

- **WHEN** `python` is invoked with more than `100` args or args exceeding `8192` UTF-8 bytes total
- **THEN** the invocation MUST fail safely
- **AND** the system MUST NOT submit the request to sandbox execution

#### Scenario: preamble is prepended to code at execution time

- **WHEN** `python` is invoked with both `code` and `preamble`
- **THEN** the sandbox MUST receive `preamble + "\n" + code` as the command
- **AND** the nl2py guardrail MUST only receive `code` as the content to check

#### Scenario: empty preamble is treated as absent

- **WHEN** `python` is invoked with `preamble` set to an empty or whitespace-only string
- **THEN** the handler MUST treat `preamble` as absent
- **AND** the sandbox MUST receive only `code` as the command

### Requirement: Python tool executes only through sandbox gateway

Python tool execution already routes through the sandbox gateway and does not use a tool-owned command allowlist. This behavior SHALL remain unchanged while Bash executable policy is delegated to sandbox gateway policy.

When a Python invocation references `shared-data/...` by explicit root-qualified path in LOCAL deployment mode and the sandbox request includes a local read-only shared data root, filesystem access MUST be governed by the same sandbox filesystem mapping used by Bash and builtin file tools. Python tool implementation MUST NOT add `shared-data/` to Python module search path, `PYTHONPATH`, current interpreter state, package discovery or implicit import resolution. REMOTE/PaaS Python execution MUST fail before sandbox invocation if local `shared-data/...` access is requested through this capability.

#### Scenario: Python remains independent from Bash command policy

- **WHEN** Bash command policy ownership changes
- **THEN** Python tool invocations MUST continue to route through the Python tool handler
- **AND** Python input MUST NOT be parsed or authorized using Bash command rules

#### Scenario: Python snippet reads shared data by explicit path

- **WHEN** Python code opens `shared-data/cases/alarm.json`
- **AND** local sandbox filesystem includes `shared-data/` as a read-only root
- **THEN** the read MUST be governed by sandbox filesystem root mapping
- **AND** attempts to write under `shared-data/` MUST fail or be made read-only

#### Scenario: Shared data does not become import search path

- **WHEN** `shared-data/scripts/helper.py` exists
- **AND** Python code executes `import helper` without explicitly adding an authorized path by code
- **THEN** the Python tool MUST NOT make the import succeed solely because the file exists under `shared-data/`
- **AND** `shared-data/` MUST NOT be injected into `PYTHONPATH`

### Requirement: Python invocations are isolated in the first version

The first version of the Python tool SHALL treat each invocation as an isolated execution. It SHALL NOT require notebook-style persistent interpreter state across calls.

#### Scenario: one python invocation does not depend on previous interpreter state

- **WHEN** a later `python` call is made after an earlier one completed
- **THEN** the later call is evaluated as a fresh isolated invocation
- **AND** the system is not required to preserve variables, in-memory state, or open handles from the previous call

### Requirement: Nl2py guardrail scope does not include workflow python nodes

nl2py guardrail SHALL apply only to the `python` capability invoked through the capability invocation path. Workflow Python nodes that execute through `WorkflowSandboxExecutionPort` are NOT `python` capability invocations and MUST NOT trigger nl2py guardrail.

This requirement clarifies the existing `guardrail-gateway` spec statement "nl2py 检查 MUST 只对 `python` capability 生效，MUST NOT 影响其他 capability": Workflow Python nodes are a distinct execution context (recipe-authored predefined scripts) from `python` capability (LLM-generated dynamic code), and the guardrail scope distinction applies to both.

#### Scenario: Workflow python node does not trigger nl2py

- **WHEN** a Workflow Python node executes through `WorkflowSandboxExecutionPort`
- **THEN** nl2py guardrail MUST NOT be invoked
- **AND** execution MUST proceed directly to sandbox gateway

#### Scenario: Python capability still triggers nl2py

- **WHEN** the `python` capability is invoked through the capability invocation path
- **THEN** nl2py guardrail SHALL apply as defined in `guardrail-gateway` spec
- **AND** fail-closed behavior when guardrail service is unavailable MUST remain unchanged
