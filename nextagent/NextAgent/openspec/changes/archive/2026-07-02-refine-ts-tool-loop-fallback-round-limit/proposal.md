## 背景与问题（Why）

当前 `DefaultAgent` 的 tool loop 轮次上限有两层来源：优先读取 accepted assembly 的 `runtimeSettings.maxToolIterations`，缺失时再回退到构造注入 `deps.maxToolRounds`，最后落到硬编码默认值。产品默认 builtin `default-agent` 已将 `maxToolIterations` 固化为 `50`，但运行时代码的最终 fallback 仍保留 `3`。这会导致两个问题：第一，未显式配置 `maxToolIterations` 的 agent assembly 与默认 agent 的基线行为不一致；第二，stable OpenSpec 仍把最小上限写成 `3`，与当前希望保持的默认产品行为不一致，push gate 会将这类实现修改识别为未覆盖的行为变更。

本 change 的必要性是把“未配置时的 tool loop round fallback”收敛到与默认 agent 一致的 `50`，并为这一行为补齐规格与回归验证，避免不同 assembly 在未显式配置时出现难以解释的隐藏差异。

## 变更范围（What Changes）

- 将 `DefaultAgent` 在 accepted assembly 未提供 `runtimeSettings.maxToolIterations` 且未注入 `deps.maxToolRounds` 时的最终 fallback round limit 从 `3` 调整为 `50`。
- 将 `agent-core` 中表达最小 tool loop round limit 的同域常量同步为 `50`，避免代码内部同时存在 `3` 与 `50` 两套默认语义。
- 更新 active change OpenSpec delta，使 `ts-minimal-agent-kernel` 中关于 tool loop 最小上限的行为契约与实现目标保持一致。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-minimal-agent-kernel`：修改 tool loop 最小 round limit 的行为契约，将未显式配置时的最小 round 上限从 `3` 收敛到 `50`。

## 影响范围（Impact）

- 代码：`packages/agent-core` 中 `DefaultAgent` tool loop fallback 逻辑与同域常量。
- 测试：沿用现有 build/test/contract/architecture 验证链路，并通过代码审查确认 fallback 语义收敛。
- 规格：active change 下 `ts-minimal-agent-kernel` delta。
- 运维：未显式配置 `maxToolIterations` 的 agent assembly 将默认允许最多 `50` 轮 tool loop；已显式配置的 assembly 行为不变。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：更新 tool loop 最小 round limit requirement，使 stable spec 与实现后的默认 fallback 一致。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/core-context-model-capability.md`：同步 tool loop 默认 fallback round limit 的稳定事实。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-minimal-agent-kernel` 到相关架构设计与验证入口的导航。
- `openspec/designs/modules/agent-core.md`：如已有 tool loop 默认行为的稳定描述，则同步 fallback round limit；否则无。
- `openspec/designs/adr/<id>.md`：无。

验证入口：
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`
