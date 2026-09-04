## 背景和现状（Context）

`DefaultAgent` 当前通过 `acceptedAssembly.runtimeSettings.maxToolIterations ?? this.deps.maxToolRounds ?? <hard-default>` 解析 tool loop round limit。产品默认 builtin `default-agent` 已在 `agent.yaml` 中把 `maxToolIterations` 固化为 `50`，但运行时代码此前仍保留 `3` 作为最终硬兜底。这样会让“显式配置路径”和“未显式配置路径”出现不同默认语义，也让 stable `ts-minimal-agent-kernel` 中记录的 `maxToolRounds=3` 与当前想维持的默认产品路径不一致。

当前实现与 stable spec 存在 implementation-vs-spec gap：代码已被调整为在缺失 assembly 配置时使用 `50`，但 stable spec 和相关设计基线仍停留在 `3`。本 change 需要把这条差异收敛为唯一目标状态，并给出最小验证路径。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 将 tool loop round fallback 的唯一默认值收敛到 `50`。
- 保持显式配置优先级不变：assembly 配置优先于构造注入 fallback，构造注入 fallback 优先于硬兜底。
- 让 active change OpenSpec 与实现保持一致，消除 push gate blocker。

**非目标：**

- 不修改每轮 `maxToolCallsPerRound=5` 的治理语义。
- 不修改任何显式配置了 `runtimeSettings.maxToolIterations` 的 agent 行为。
- 不引入新的 runtime config 字段、Web API、gateway contract、timeline event 或 observability signal。
- 不重构 tool loop 调度顺序、risk policy、sandbox boundary 或 terminal commit 逻辑。

## 设计决策（Decisions）

1. 选定实现路径：把 `DefaultAgent` 的最终硬兜底从 `3` 调整为 `50`，并同步 `minimalToolLoopLimits.maxToolRounds`。这是最小且单一职责的实现路径，不新增配置旋钮，也不引入跨模块修改。
2. 保持优先级链路不变：`acceptedAssembly.runtimeSettings.maxToolIterations` 仍是唯一正式业务配置入口；`deps.maxToolRounds` 继续只承担调用方注入级 fallback；最终硬兜底仅在前两者都缺失时生效。
3. 本次不新增专门 fallback characterization test，保持验证范围最小；通过现有 build/test/contract/architecture 验证链路与代码审查确认 fallback 语义只影响缺省路径，不改变显式配置优先级。

备选方案与放弃理由：

- 备选方案 A：只修改 `default-agent.yaml`，不调整硬兜底。放弃原因：无法覆盖未显式配置 assembly 的路径，默认语义仍分裂。
- 备选方案 B：删除硬兜底，只依赖 assembly 必配。放弃原因：会改变现有 `DefaultAgent` 代码契约，扩大范围到启动编译/测试装配路径，不符合本次外科手术式修改目标。
- 备选方案 C：新增 system-level config 统一注入 `deps.maxToolRounds`。放弃原因：增加不必要的配置面和 app composition 复杂度，不符合 KISS。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 仅调整 tool loop round fallback 数值，不改变 owner scope、agent scope、sandbox、safe error、日志脱敏或 capability authority。 | code review；`npm test` |
| 性能/容量 | 未显式配置路径下的最大 tool round 从 3 提高到 50，增加的是受治理 fallback 上限，而不是无界增长；显式配置路径不受影响。 | `npm test`；code review |
| 可靠性/恢复 | fallback 值与默认 builtin agent 一致，减少 assembly 缺省时的隐藏行为差异；达到上限时仍走既有 `TOOL_ROUND_LIMIT_EXCEEDED` 降级路径。 | `npm test`；code review |
| 可维护性 | 保持单一优先级链路，只改 `agent-core` 同域代码与一处回归测试，不新增新配置或分支。 | code review；`npm run lint:architecture` |
| 可测试性 | 保持现有测试面不扩张，依赖现有产品级验证链路和 focused code review 检查 fallback 仅改缺省路径。 | `npm test`；code review |
| 审计/可追溯性 | 不新增审计事件；仍复用既有 `DEGRADATION_NOTICE` 与 `TOOL_ROUND_LIMIT_EXCEEDED` 证据链。 | `npm test`；code review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 未显式配置 `maxToolIterations` 时 fallback 为 50 | 1.1 | code review 检查 `packages/agent-core/src/agent/default-agent.ts` 与 `packages/agent-core/src/tools/tool-loop.ts` |
| tool loop 最小 round limit stable 契约与实现一致 | 2.1 | `openspec validate --all --strict`；spec review |
| 产品代码提交满足 build/test/contract/architecture push gate | 3.1 | `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-minimal-agent-kernel/spec.md` 主承载 tool loop 最小 round limit 与 fallback 行为。
- 架构和跨模块设计：`openspec/designs/architecture/core-context-model-capability.md` 主承载 tool loop fallback 的稳定设计事实。
- 模块设计：`openspec/designs/modules/agent-core.md` 若已有 `DefaultAgent`/tool loop 默认行为段落，则承载 agent-core 本地实现职责；否则本次无新增模块设计事实。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 承载 stable spec 到相关设计与验证入口的导航更新。

## 风险与取舍（Risks / Trade-offs）

- [风险] 未显式配置的 agent assembly 将从 3 轮提升到 50 轮，失败请求可能运行更久。 -> 缓解方式：保持 `TOOL_ROUND_LIMIT_EXCEEDED` 降级终点不变，并通过显式 `maxToolIterations` 允许更严格 assembly 自行收敛。
- [取舍] 本次不引入新的集中式配置入口。 -> 缓解方式：继续以 assembly `runtimeSettings.maxToolIterations` 作为正式配置 owner，避免双重配置源。

## 迁移计划（Migration Plan）

无。该变更不涉及数据迁移或发布顺序要求。若上线后需要恢复旧行为，可回滚本次代码与 active change。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-minimal-agent-kernel/spec.md`：把 tool loop 最小 round limit 与 fallback 统一收敛到 `50`。
- `openspec/designs/architecture/core-context-model-capability.md`：同步 tool loop fallback 默认值与 assembly 优先级链路。
- `openspec/designs/modules/agent-core.md`：如存在对应段落，则同步 `DefaultAgent` tool loop fallback 默认值。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-minimal-agent-kernel` 到 `agent-core` 设计和验证入口的导航。

## 待确认问题（Open Questions）

无。
