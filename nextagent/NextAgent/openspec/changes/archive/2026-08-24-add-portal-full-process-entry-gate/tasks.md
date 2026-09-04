## 1. `FN-5.2 调用能力`

- [x] 1.1 扩展 portal ability 配置 characterization，覆盖 `full-process-enabled` 默认值、`false`、非法值和字段独立回退，并实现 provider 解析。
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/portal-ability-config.test.ts packages/agent-app/tests/portal-ability-composition.test.ts`。
  - 结果：2026-08-24 后端定向测试 2 files / 12 tests 通过。

## 2. `FN-8.5 上传和管理附件`

- [x] 2.1 扩展 runtime bootstrap contract，覆盖 `fullProcessEnabled` 投影、必填 schema、默认回退和 provider 热更新。
  - 验证：`npx vitest run --config vitest.config.release.ts packages/agent-channel-web/tests/runtime-bootstrap-portal-ability.test.ts`。
  - 结果：2026-08-24 bootstrap contract 测试 1 file / 4 tests 通过。

## 3. `FN-10.6 前端定制`

- [x] 3.1 扩展前端 runtime config 解析测试，覆盖 `fullProcessEnabled` 缺失和非法值回退。
  - 验证：在 `frontend/agent-web` 运行 `npm test -- tests/runtime-config.test.ts`。
  - 结果：2026-08-24 runtime config 测试 1 file / 18 tests 通过。
- [x] 3.2 扩展 TurnBlock 测试，覆盖 `fullProcessEnabled=false` 或 `showThinkingChain=false` 时执行详情可展开但“完整过程”按钮隐藏。
  - 验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.test.tsx -t "full-process graph entry"`。
  - 结果：2026-08-24 TurnBlock 定向测试 1 file / 5 tests 通过（93 skipped）。

## 4. Change 验证

- [x] 4.1 运行 OpenSpec strict validation。
  - 验证：`npx openspec validate add-portal-full-process-entry-gate --strict`。
  - 结果：2026-08-24 strict validation 通过。
