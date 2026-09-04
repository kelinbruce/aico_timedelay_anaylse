## 背景和现状（Context）

当前 `python` builtin tool 的模型可见契约和 `bash` 不完全一致，但不一致点混杂了两层语义：

1. 工具自身黑盒语义：Python 代码执行完成后，非零 `exit_code` 仍然是结构化结果，而不是自动升级为 capability 失败。
2. sandbox execution boundary 失败语义：timeout、sandbox unavailable、sandbox deny、safe failure 这类“根本没有拿到正常执行结果”的场景，当前 `python` 实现却会把一部分 `AgentError` 吞成 `SUCCEEDED + exit_code=126`。

第二类不一致破坏了 runtime/core 的统一治理。`agent-core` tool loop 目前已经围绕 capability `FAILED` / `TIMED_OUT` / `DEGRADED` 建立了统一路径：`tool.call.completed`、`CAPABILITY_COMPLETED`、`DEGRADATION_NOTICE`、bounded `CAPABILITY_RESULT` failure payload、repeated failure guard、terminal fail-closed 分类等。`python` 把 sandbox failure 伪装成成功结果后，这些机制无法完整生效。

当前 implementation-vs-spec gap 不是“代码偏离 stable spec”，而是 stable spec 没有把 sandbox execution failure 与 process non-zero exit 分清楚。stable `python-tool` spec 只冻结了“非零 exit_code 仍是结构化结果”，但没有明确 timeout / sandbox unavailable / deny 必须进入统一 capability failure truth。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 统一 `python` 与 `bash` 在 sandbox execution failure 层面的 capability truth。
- 让 Python sandbox timeout / unavailable / deny 进入既有 `FAILED` / `TIMED_OUT` 路径，复用 `agent-core` 既有 failure payload、timeline、log 和 repeated-failure guard。
- 保证后续模型步骤仍可看到 bounded failure evidence，并据此继续执行。

**非目标：**

- 不把 Python 非零 `exit_code` 改成 `DEGRADED`。
- 不改 `python` 的输入 schema、输出 schema、timeout 上限、stdout/stderr 上限。
- 不重构 `agent-core` tool loop 或 `agent-app` sandbox runtime wiring。

## 设计决策（Decisions）

### 决策 1：仅统一 sandbox failure truth，不统一 process exit 语义

唯一实现路径是：

- `python` 在 sandbox 正常返回结构化结果时，仍然直接返回 `exit_code/stdout/stderr/timed_out`；
- `python` 在 sandbox timeout 时抛 `ToolTimedOutResultError`；
- `python` 在 sandbox safe failure（unavailable / deny / canceled 之外的 safe failure）时抛 `AgentError` 或 `ToolFailedResultError`，交由 executor 映射为 capability `FAILED`；
- `agent-core` 不新增 Python 特判，继续复用现有 `result.status` 分支。

这样把“有没有拿到正常执行结果”和“拿到结果后 exit_code 是否为 0”拆开：

- 前者由 capability truth owner（executor + tool loop）统一治理；
- 后者继续由 Python tool 的黑盒契约 owner 保持独立。

### 决策 2：不在 Python tool 内部伪造 `exit_code=126` 成功结果

当前 `exit_code=126` 分支的问题是它把 sandbox boundary truth 降格成了业务结果。该做法会导致：

- `tool.call.completed` 只看到 `SUCCEEDED`
- `DEGRADATION_NOTICE` 缺失
- repeated failure guard 无法基于 capability failure truth 生效
- 失败与正常非零退出混在同一 `SUCCEEDED` 语义下

因此该分支直接删除，改为抛出已有 safe error / timed_out error，让 executor 生成标准 capability 结果。

### 决策 3：继续复用 `buildFailedCapabilityPayload(...)`

后续模型步骤需要看到失败证据，不应新建 Python 专用 failure message shape。唯一实现路径是复用：

- `agent-capability` executor 产出的 `CapabilityInvocationResult`
- `agent-core` 里的 `buildFailedCapabilityPayload(...)`
- `appendCapabilityResultMessage(...)`

这样 `python` failure 会和 `bash` failure 一样写入 `CAPABILITY_RESULT`，后续上下文、summary、history 选择和 loop continuation 全部无需新增分支。

### 备选方案与放弃理由

- 方案 A：把 Python 非零 `exit_code` 也改成 `DEGRADED`
  - 放弃原因：扩大行为面，直接改变已冻结黑盒契约，不是当前问题的最小修复。
- 方案 B：保留 `exit_code=126`，仅在外层额外打 log
  - 放弃原因：只能补 observability，不能补 capability truth、timeline 和 repeated-failure guard。
- 方案 C：在 `agent-core` 特判 Python 的 `exit_code=126`
  - 放弃原因：把工具私有编码泄漏到 core；违背 capability owner 边界，也会制造第二套 failure 识别规则。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 继续只传播 safe error、bounded payload 和现有 output schema；不新增 raw code、raw stdout/stderr 或 host path 泄漏面 | Python capability tests；runtime observability tests |
| 性能/容量 | 复用既有 failure payload 与 tool loop 分支，不增加额外持久化轮次或新的大 payload | focused vitest；code review |
| 可靠性/恢复 | Python sandbox timeout / failure 将进入统一 `TIMED_OUT` / `FAILED` truth，repeated failure guard 与 fail-closed 分类保持一致 | Python capability tests；tool loop characterization |
| 可维护性 | 删除 Python 私有成功伪装分支，减少跨层语义分裂；core 无需新增 Python 特判 | architecture/code review |
| 可测试性 | 直接用现有 sandbox double、executor、tool loop 和 runtime log 测试桩验证；无需新增测试框架 | `python-capability.test.ts`；`runtime-trajectory-observability.test.ts` |
| 审计/可追溯性 | Python sandbox failure 将与 Bash 一样留下 capability completion truth、degradation notice 和 runtime log failure anchor | runtime observability tests；manual log review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Python non-zero exit 仍是结构化结果 | 1.1 | `npx vitest run packages/agent-capability/tests/python-capability.test.ts` |
| Python sandbox timeout 进入 capability `TIMED_OUT` | 1.2 | 同上 |
| Python sandbox unavailable/deny 进入 capability `FAILED` | 1.3 | 同上 |
| Python failure 沿用标准 capability failure payload / timeline / log 路径 | 2.1 | `npx vitest run packages/agent-app/tests/runtime-trajectory-observability.test.ts` |
| Python failure 不新增 core 特判、继续复用 tool loop 既有分支 | 2.2 | code review；focused tool loop tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/python-tool/spec.md`
- 架构和跨模块设计：无新增长期 architecture owner；沿用 runtime/capability/sandbox 现有稳定设计
- 模块设计：无新增长期 module owner；本次只是收敛 `agent-capability` 与 `agent-core` 既有交互
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md` 仅在归档时需要补充 Python failure truth 对齐说明时更新，否则无

## 风险与取舍（Risks / Trade-offs）

- [风险] 现有测试或调用方可能隐含依赖 `python` sandbox failure 返回 `exit_code=126` -> 缓解方式：先补 focused contract tests，明确只保留“非零 exit 结构化结果”，不保留 sandbox failure 伪成功。
- [风险] Python `FAILED` 进入 repeated failure guard 后，某些历史 loop 行为会更早停止 -> 缓解方式：这是目标行为；通过 characterization test 锁定。
- [风险] `safeError.message` 进入 `CAPABILITY_RESULT` failure payload 后，调用方感知语义变化 -> 缓解方式：仍沿用现有 bounded failure payload 结构，不引入新字段。

## 迁移计划（Migration Plan）

无。该变更为单仓内 capability truth 收敛，无额外部署步骤或数据迁移。回滚策略是恢复 `python-tool.ts` 的旧 failure mapping 与对应测试断言。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/python-tool/spec.md`：提炼 Python sandbox timeout / safe failure 的 capability truth 对齐规则
- `openspec/overview.md`：无
- `openspec/designs/architecture/<topic>.md`：无
- `openspec/designs/modules/<module>.md`：无
- `openspec/designs/adr/<id>.md`：无
- `openspec/designs/spec-to-design-map.md`：如长期导航需要补充 Python failure truth 对齐的设计入口则更新

## 待确认问题（Open Questions）

无
