## 1. Sandbox 路径拒绝错误归一化

- [x] 1.1 `createWorkspaceBackedSandboxExecutionPort` public boundary：新增 `unauthorized-path`、`unsafe-path` 与真实 sandbox unavailable 的回归测试；修复前 `unauthorized-path` 必须复现为错误的 `SANDBOX_UNAVAILABLE`，其余两个 case 保持既有结果
  来源：Requirement `Sandbox Path Rejection Uses Authorization Safe Error`，Scenario `Unauthorized path is reported as authorization rejection`、`Existing unsafe path reason remains an authorization rejection`、`Genuine sandbox unavailability remains unavailable`
  验证：先运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/sandbox-execution-port.test.ts --maxWorkers=1`，预期修复前 `unauthorized-path` case 因实际 code 为 `SANDBOX_UNAVAILABLE` 而失败
  实际：2026-07-28 运行后 3 个 tests 中 1 个按预期失败；`unauthorized-path` 实际为 `SANDBOX_UNAVAILABLE`，`unsafe-path` 与真实 unavailable 两个基线 case 通过。

- [x] 1.2 `toSandboxCapabilitySafeError`：把 `unauthorized-path` 与 `unsafe-path` 收敛到既有 `CAPABILITY_PATH_REJECTED` 授权拒绝分支，不改变其他 unavailable 映射
  来源：Requirement `Sandbox Path Rejection Uses Authorization Safe Error`，Scenario `Unauthorized path is reported as authorization rejection`、`Existing unsafe path reason remains an authorization rejection`、`Genuine sandbox unavailability remains unavailable`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts --maxWorkers=1`，预期全部通过
  实际：2026-07-28 运行后 2 个 test files、41 个 tests 全部通过。

- [x] 1.3 变更范围：验证 TypeScript 构建、OpenSpec strict validation 和差异卫生，确认未新增 public contract、路径放宽或敏感数据投影
  来源：design `目标设计（Proposed Design）`、`质量属性设计（Quality Attributes）`
  验证：运行 `npm run build`、`openspec validate fix-sandbox-unauthorized-path-mapping --strict`、`git diff --check`，预期全部成功；人工审查 diff 仅包含 active change、单一映射分支和对应测试
  实际：2026-07-28 三条命令均以 exit code 0 完成；diff 审查确认生产代码仅扩展既有 path rejection 条件，未修改 public contract、filesystem roots、执行策略或 safe error 内容来源。

## 归档前更新基线检查（非实施任务）

归档流程将 Requirement `Sandbox Path Rejection Uses Authorization Safe Error` 归并到 `openspec/specs/sandbox-runtime/spec.md`；既有模块 owner 与职责不变，不新增重复 owner 或平行错误 vocabulary。
