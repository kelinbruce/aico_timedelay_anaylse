## 1. Tool loop fallback 实现与回归

- [x] 1.1 将 `DefaultAgent` 最终 tool loop round fallback 从 `3` 调整为 `50`，并同步同域常量，保持 assembly 配置优先级链路不变。
  验证：code review 检查 `packages/agent-core/src/agent/default-agent.ts` 与 `packages/agent-core/src/tools/tool-loop.ts`
  来源：spec `最小 Capability Tool 集合`；design 决策 1、2

## 2. OpenSpec delta 与行为契约对齐

- [x] 2.1 为 `ts-minimal-agent-kernel` 补充 active change delta，明确 tool loop 最小 round limit 与 fallback 行为统一为 `50`。
  验证：`openspec validate refine-ts-tool-loop-fallback-round-limit --strict`
  来源：proposal `修改的 Capability`；spec `最小 Capability Tool 集合`

## 3. 验证和收尾

- [x] 3.1 运行产品代码 push gate 所需的 build、test、contract、architecture 与 OpenSpec strict validation。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`
  来源：AGENTS.md 验证门禁；design 验证映射
- [x] 3.2 检查本次改动未触碰 frozen core contract、owner/agent scope、terminal lifecycle 或额外配置面，并保持提交范围只包含本次收敛内容。
  验证：`git diff --check`；`git diff --stat`；模型 code review 检查点
  来源：proposal 变更范围；design 非目标

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前：

- 同步 `openspec/specs/ts-minimal-agent-kernel/spec.md` 中的 tool loop 最小 round limit 与 fallback 行为。
- 按需更新 `openspec/designs/architecture/core-context-model-capability.md` 与 `openspec/designs/modules/agent-core.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 的设计/验证导航。
