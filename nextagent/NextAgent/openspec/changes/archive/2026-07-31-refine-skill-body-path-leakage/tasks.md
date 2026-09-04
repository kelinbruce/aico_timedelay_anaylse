# Tasks: Refine Skill Body Path Leakage Detection

- [x] 1.1 Update Skill body host path leakage detection to avoid treating relative glob patterns such as `XX/*/tmp/*` as host paths.
  验证: `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts -t "tmp segments|high-confidence credential values|security domain terms" --maxWorkers=1`
  来源: `skill-body-validation` / relative glob compatibility.

- [x] 1.2 Keep true host paths and credential-like values blocked by Skill body safe leakage validation.
  验证: `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts -t "tmp segments|high-confidence credential values|security domain terms" --maxWorkers=1`
  来源: `skill-body-validation` / leakage safety.

- [x] 1.3 Allow placeholder credential and authorization examples while keeping concrete values blocked.
  验证: `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts -t "placeholders|high-confidence credential values" --maxWorkers=1`
  来源: `skill-body-validation` / placeholder compatibility.

- [x] 2.1 Run package validation.
  验证: `npx tsc -b packages/agent-capability/tsconfig.json`
  来源: validation gate.
