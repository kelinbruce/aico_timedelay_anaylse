## ADDED Requirements

### Requirement: Bash Forwards The Governed Python Module Token Sequence

Bash MUST deterministically tokenize `python -m <dotted-module> [args...]` and `python3 -m <dotted-module> [args...]` as Python sandbox requests. Bash MUST preserve the token sequence for the sandbox execution port and MUST NOT resolve module names, choose Skill roots, create `PYTHONPATH`, or add a second Python invocation policy.

#### Scenario: Bash forwards Python module invocation

- **WHEN** the model invokes Bash with `python -m scripts.nl2sql.sql_recall_main "查询问题"`
- **THEN** Bash MUST submit `python` and the argument vector `[-m, scripts.nl2sql.sql_recall_main, 查询问题]` to the Python sandbox execution port
- **AND** Bash MUST NOT rewrite `-m` or the module name into a file path
