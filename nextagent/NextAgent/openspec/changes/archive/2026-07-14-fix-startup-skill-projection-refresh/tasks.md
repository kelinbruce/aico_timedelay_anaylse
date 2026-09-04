## 1. 首次投影初始化

- [x] 1.1 在 `WorkspaceFilePort` 实现以进程实例为边界的 projection key 初始化状态：首次请求跳过遗留 manifest reuse，经既有 lock/staging/rename 发布成功后才允许后续 reuse；失败或 abort 不得标记完成。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`
  来源：spec `Skill resource projection SHALL refresh on its first activation in each service process`；design D1/D2

## 2. 回归测试

- [x] 2.1 增加模拟服务重启的测试：两个 `WorkspaceFilePort` 实例共享 execution workspace，同版本 Skill 的 `SKILL.md` 与脚本从 `query.py` 改为 `query1.py` 后，第二个实例在每个 execution scope 的首次 activation 都投影新文件集合。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`
  来源：spec Scenario `Restarted service refreshes an edited Skill script path`
- [x] 2.2 保留并更新同进程 reuse 断言，证明首次刷新成功后第二次 activation 不调用 source list/read。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`
  来源：spec Scenario `Later activation in the same process reuses the refreshed projection`
- [x] 2.3 增加失败后不缓存初始化状态的 negative test，首次 publication 失败后下一次 activation 必须重新尝试而非复用遗留 manifest。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`
  来源：design D1；质量属性“可靠性/恢复”

## 3. 验证和收尾

- [x] 3.1 运行变更的 focused test、TypeScript build 和 OpenSpec strict validation。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts --maxWorkers=1`; `npm run build`; `openspec validate fix-startup-skill-projection-refresh --strict`
  来源：proposal 验证入口；design 验证映射

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/skill-resource-access/spec.md`。
- 更新 `openspec/designs/architecture/skill-invocation-and-disclosure.md`、`openspec/designs/modules/agent-capability.md` 与 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义 projection freshness owner 或行为契约。
