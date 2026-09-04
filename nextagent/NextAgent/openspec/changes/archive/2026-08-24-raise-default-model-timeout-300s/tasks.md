## 1. `FN-4.1 调用模型`

- [x] 1.1 将默认系统配置解析和产品主路径测试的预期 `timeoutMs` 修改为 `300000 ms`，并确认 `origin/main` 的生产配置基线仍为 `120000 ms`
  来源：`FN-4.1 调用模型` + Requirement `Agent App system config 使用 canonical model/provider 配置` + Scenario `内置默认模型使用明确调用画像`
  验证：`git show origin/main:packages/agent-app/config/default-system.yaml` 显示基线 `timeoutMs: 120000`；运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts -t "stores the bundled system configuration|preserves the bundled model profile"`，2 个目标用例通过

- [x] 1.2 将内置 `default-system.yaml` 默认模型 profile 的显式 `timeoutMs` 修改为 `300000`，并同步用户配置示例和 UX 限制说明
  来源：`FN-4.1 调用模型` + Requirement `Agent App system config 使用 canonical model/provider 配置` + Scenario `内置默认模型使用明确调用画像`；design `FN-4.1 调用模型 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts -t "stores the bundled system configuration|preserves the bundled model profile"` 和受控 YAML 解析断言；目标用例通过且解析值为 `300000`

## 2. Change 整体验证

- [x] 2.1 验证 OpenSpec delta、后端构建及受影响模型配置契约一致
  来源：proposal `影响范围` + design `验证策略`
  验证：运行 `npm exec -- openspec validate raise-default-model-timeout-300s --strict` 和 `npm run build`，均通过；release 配置下完整聚焦测试还暴露一个既有 Windows symlink 临时目录失败和一个缺少启动凭据导致的 `APP_CONFIG_BLOCKED`，目标超时断言未失败

## 归档前更新基线检查（非实施任务）

归档流程按照 design 的“长期基线刷新计划”同步 stable spec 与 `FN-4.1 调用模型` 的规格值，并确认 300 秒内置 profile 默认值与 30 秒字段缺失 fallback 没有混写。
