## Function

- **所属 Function**: python-tool
- **Function 变更类型**: MODIFIED

## ADDED Requirements

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
