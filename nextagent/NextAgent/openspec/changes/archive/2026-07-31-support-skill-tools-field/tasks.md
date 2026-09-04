# Tasks: Support Skill Tool Constraint Compatibility

- [x] 1.1 Update `agent-capability/src/skills/skill-manifest.ts` to parse top-level YAML string lists and inline string lists for tool constraints.
  验证: `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts -t "YAML arrays|both allowed-tools and tools" --maxWorkers=1`
  来源: `skill-manifest-contract` / tool constraint compatibility.

- [x] 1.2 Add `tools` as a compatibility alias for `allowed-tools`, and reject non-empty manifests that declare both fields.
  验证: `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts -t "YAML arrays|both allowed-tools and tools" --maxWorkers=1`
  来源: `skill-manifest-contract` / conflict handling.

- [x] 1.3 Extend `metadata.denied-tools` parsing to accept the same string-list forms as `allowed-tools`.
  验证: `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts -t "YAML arrays|both allowed-tools and tools" --maxWorkers=1`
  来源: `skill-manifest-contract` / tool constraint consistency.

- [x] 2.1 Run package validation.
  验证: `npx tsc -b packages/agent-capability/tsconfig.json`
  来源: validation gate.
