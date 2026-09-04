## 1. Specification

- [x] 1.1 Define per-request sandbox environment variables for Skill Python output and temp paths.
  验证：`openspec validate normalize-skill-python-output-paths --strict`.

## 2. Implementation

- [x] 2.1 Inject `NEXTAGENT_WORKSPACE_DIR`, `NEXTAGENT_TEMP_DIR`, and trusted `NEXTAGENT_SKILL_ROOT` in restricted local sandbox child environments.
  验证：restricted local sandbox focused Vitest passes.
- [x] 2.2 Project LOCAL sandbox stdout/stderr physical paths to logical execution paths, and materialize exact referenced `defaultCwd` ordinary files under run `temp/`.
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`.

## 3. Validation

- [x] 3.1 Add focused tests for workspace result output, run temp isolation, and Skill root derivation.
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts --testNamePattern "Skill Python execution path environment"`.

- [x] 3.2 Add a real Python Skill script verification case for workspace result and run temp output paths.
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts --testNamePattern "real Skill Python script"`.

- [x] 3.3 Document Skill Python sandbox path environment variables for developer-facing Skill authoring.
  验证：人工检查 `docs/developer/04-skill-tool-development.md` 覆盖变量含义、Python 获取方式、中间/结果文件分流、并发隔离和反模式。
- [x] 3.4 Add regression coverage for LOCAL physical path projection and `defaultCwd` file materialization.
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`.
