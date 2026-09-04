# Tasks

- [x] 1. 在 `skill-resource-access` 下新增 Skill 投影失败诊断 Requirement。
  验证：`openspec validate fix-skill-projection-diagnostics --strict`

- [x] 2. 从 Skill Tool 投影失败边界发出低基数的 `skill.tool.resource_projection_failed` runtime 诊断。
  验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts --maxWorkers=1`

- [x] 3. 为本地权限类投影失败新增回归测试，验证公开失败保持通用且原始路径不被记录。
  验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts --maxWorkers=1`

- [x] 4. 在跨独立 workspace file port 观察到锁竞争后，复用有效的已提交 Skill 投影。
  验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`

- [x] 5. 为 Skill 投影锁超时返回可重试的 safe failure 语义，不把所有投影冲突都变为可重试。
  验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts --maxWorkers=1`

- [x] 6. 新增允许清单内的投影诊断细节，使日志能识别失败阶段和原因，而不复制原始路径或任意 safe detail 字段。
  验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts --maxWorkers=1`
