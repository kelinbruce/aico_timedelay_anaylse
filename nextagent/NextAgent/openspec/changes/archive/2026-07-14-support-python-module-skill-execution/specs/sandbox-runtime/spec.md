## ADDED Requirements

### Requirement: Python Sandbox Invocation Distinguishes Script And Skill Module Modes

For a Python sandbox request, the execution integration MUST classify only these invocation modes: an existing script-path mode whose first argument is a governed logical script path, and a module mode whose first two arguments are exactly `-m` and a non-empty dotted module name. The implementation MUST translate a logical path only in script-path mode. It MUST preserve `-m` and its module name unchanged in module mode and MUST execute both modes through the existing sandbox gateway with `shell: false`.

The execution integration MUST reject `-c`, stdin (`-`), a missing module name, a non-dotted module name, interpreter options other than the defined `-m` form, and an unsupported Python invocation shape with an explicit safe failure. It MUST NOT reinterpret an unsupported option as a script path or fall back to unsandboxed host execution.

#### Scenario: Module mode preserves interpreter arguments

- **WHEN** Bash submits `python -m scripts.nl2api.api_recall_main "查询问题"` through the Python sandbox route
- **THEN** the sandbox request MUST execute Python with `-m`, `scripts.nl2api.api_recall_main`, and `查询问题` in that order
- **AND** it MUST NOT translate `-m` into an execution-workspace path
- **AND** it MUST use the existing adapter-owned cwd, sanitized environment, timeout, cancellation, and output limits

#### Scenario: Unsupported Python option fails closed

- **WHEN** Bash submits a Python command whose first argument is `-c`, `-`, or an option sequence other than the defined `-m <dotted-module>` form
- **THEN** the sandbox boundary MUST return an explicit safe failure
- **AND** it MUST NOT translate the option into a script path
- **AND** it MUST NOT execute outside the sandbox gateway

### Requirement: Python Module Mode Uses One Trusted Skill Import Root

Python module mode MUST receive one import root only from the current run's authorized and committed Skill resource projection. The execution integration MUST set that root as the process-local Python import root for the one sandbox invocation and MUST NOT expose the physical root in tool results, observability, or safe errors.

If the current run has no authorized projected Skill root or has more than one authorized projected Skill root, module mode MUST fail safely before process start. Model command text, client metadata, capability arguments, user environment variables, workspace paths, and host absolute paths MUST NOT select, append, or override the import root. Script-path mode MUST NOT receive a module import root.

#### Scenario: A sole authorized Skill projection supplies module imports

- **WHEN** the current run has exactly one authorized committed Skill projection containing `scripts/nl2api/api_recall_main.py`
- **AND** Bash submits `python -m scripts.nl2api.api_recall_main "查询问题"`
- **THEN** the module MUST be imported from that projected Skill root
- **AND** the execution MUST remain within the sandbox gateway boundary

#### Scenario: Ambiguous or absent Skill projection is rejected

- **WHEN** Bash submits a Python module-mode command
- **AND** the current run has zero or more than one authorized projected Skill root
- **THEN** the execution integration MUST return an explicit safe failure before process start
- **AND** it MUST NOT infer a root from the module name or model-supplied path
