## 审查结果

Change id：`recover-ts-model-output-token-limit`

审查日期：2026-08-01
状态：PASS

本次复审覆盖新增的 direct model 硬字符上限有界交付语义，以及模型路由执行器重构后的设计一致性。

## Findings

| ID | 严重级别 | 领域 | 位置 | 问题 | 处理结果 |
|---|---|---|---|---|---|
| SR-1 | LOW | legacy governance | `specs/ts-minimal-agent-kernel/spec.md` | 该既有 active change 创建于当前 Function 主规格模板之前，delta 仍位于 legacy `ts-minimal-agent-kernel`，而 `FN-4.1 调用模型` 的 canonical spec 已由并行 change 确立为 `model-invocation-contract`。当前实现目标没有歧义，但归档时不能形成两份 stable 定义。 | proposal 已明确 `FN-4.1` 与 canonical spec；design 已把 canonical 收敛和 legacy 定义移除列为强制归档动作。该 note 不阻塞当前实现，归档审查必须再次验证。 |

无 BLOCKER、HIGH 或 MEDIUM finding。

## 需群内确认

None。change 不新增、删除、重命名或重新定义 `agent-contracts` 内容，也不改变 public export、DTO、port 或 enum ownership。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | 输出恢复和容量投影仍由 `agent-core` 拥有；`agent-model` 只交付 provider-neutral delta/final；runtime terminal ownership 不变。 |
| core contracts | PASS | 复用 `ModelInvocationRequest`、`ModelFinalResult`、`ModelMessage` 和 `AgentRunStatePort`，未修改冻结 contract。 |
| roadmap owner boundaries | PASS | 主 owner 为 `agent-core`；provider、runtime、channel、context、gateway owner 均未迁移。 |
| roadmap change rules | PASS | change 可独立交付并有用户可观察的完整输出、显式截断和 terminal outcome。 |
| current code | PASS | 私有 model route executor 与现有 `DefaultAgent`、`RunBoundModelInvocation`、fallback 和 terminal path 对齐，无第二套 public invocation protocol。 |
| engineering principles | PASS | 单路由状态与 Agent turn/fallback 分责，硬上限只有一个投影规则；符合第一性原理、KISS、SOLID 和唯一实现路径。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS-WITH-NOTE | 修改 `FN-4.1 调用模型`；canonical 为 `model-invocation-contract`，当前 legacy delta 的归档收敛见 SR-1。 |
| Function 变更汇总 | N/A | 既有 active change 未主动重写为当前主规格 delta 模板；未新增平行汇总。 |
| 量化指标 | PASS | `32000 tokens`、3 次 continuation、`150000` 个 UTF-16 code unit 及计数边界明确。 |
| Requirement 元数据 | PASS-WITH-NOTE | 沿用既有 active legacy delta；见 SR-1。 |
| 质量属性分层 | PASS | 性能/容量、可靠性/恢复、安全目标均由可观察结果验证，内部 route executor 机制只在 design 描述。 |
| 触发机制 | PASS | `finishReason="length"` 与首次超过硬字符上限是互斥、明确的触发条件。 |
| 输入和前置条件 | PASS | 已选模型请求、上下文窗口、usage/input estimate、Tool call、timeout 和 cancellation 均闭合。 |
| 输出和副作用 | PASS | 明确单一 terminal assistant message、一次 notice、request-local 恢复消息和不可执行 Tool call。 |
| 核心决策逻辑 | PASS | 8 倍预算、32000 token 上限、一次提升、最多 3 次续写、硬上限有界前缀均唯一确定。 |
| 存量代码基线 | PASS | design 已对齐当前扁平请求字段、resolved model configuration 和单一 route executor。 |
| 增量实施路径 | PASS | 只修改 agent-core 私有执行/helper、相关 tests 和 active change artifacts。 |
| 唯一实施路径 | PASS | 超限立即停止当前输出，既不 retry/fallback 也不伪造 `ModelFinalResult`，仅进入普通 terminal commit。 |
| 状态或 artifact 契约 | PASS | `OUTPUT_TRUNCATED` 仅为 agent-core 私有状态，不新增 durable/public contract。 |
| flow 集成 | PASS | route executor 返回 Agent turn；DefaultAgent 继续拥有 fallback、Tool loop 和 terminal 分流。 |
| 失败和降级 | PASS | 覆盖恢复耗尽、unsafe Tool call、取消、hard limit 有界交付和超限后缀不泄漏。 |
| 验收示例 | PASS | 覆盖 exact boundary、final-only/stream overflow、Markdown closure、surrogate pair、Tool/fallback 禁止与 `REQUEST_COMPLETED`。 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | proposal 使用 `Function 影响（OpenSpec Capabilities）`，未与 runtime Capability 混用。 |
| canonical terminology | PASS | `FN-4.1 调用模型`、`model-invocation-contract`、`MODEL_TEXT_LIMIT_EXCEEDED` 和 `OUTPUT_TRUNCATED` 跨 artifact 一致。 |
| BCP 14 规范关键词 | PASS | 规范义务使用全大写 MUST/MUST NOT/SHALL。 |
| 语义闭合 | PASS | 触发、停止消费、前缀生成、notice、terminal outcome 和禁止副作用均唯一。 |
| 量词与可测量边界 | PASS | notice 恰好一次；硬上限以 UTF-16 code unit 计量；continuation 最多 3 次。 |
| 形式化表示适配性 | PASS | 有序规则足以表达，无需新增 public 状态机。 |
| scenario-to-test 来源 | PASS | 测试断言 stream/history/terminal/Tool invocation 等黑盒事实，并为 architecture boundary 保留必要结构检查。 |
| 黑盒/白盒边界 | PASS | spec 不描述私有 class/文件；route executor 和 callback 限额信号只在 design。 |
| 端到端追踪 | PASS | `FN-4.1 → 输出超限 Requirement → hard-limit scenarios → tasks 2.5/2.6 → focused/e2e tests` 可定位。 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | N/A | issue 驱动的既有 bugfix refinement，无专属 roadmap 条目。 |
| 创建前覆盖检查 | PASS | 不修改 frozen contract 或最小内核 owner。 |
| 生成后一致性确认 | PASS-WITH-NOTE | 目标行为和实现一致；legacy canonical 收敛见 SR-1。 |
| release scope / not-planned / candidate | PASS | 未引入后置能力、provider-specific 策略或新配置。 |
| 并行边界 | PASS | 与 `refine-openai-compatible-model-adapter` 共享 `FN-4.1` 已在 design 明确协调，归档只保留 canonical 定义。 |
| 第一性原理/KISS/SOLID | PASS | 不因容量超限丢弃全部安全输出；不引入第二套 terminal、retry 或 provider protocol。 |
| 基于存量代码的增量设计 | PASS | 复用现有累计快照、RunBound lifecycle、fallback guard 和 runtime terminal commit。 |
| 唯一可实施路径 | PASS | 文档与代码均采用单一路由执行器和单一有界投影。 |

## 需求和设计清晰度

行为已唯一确定：`length` 进入受限恢复；字符硬上限不进入恢复或 fallback，而是停止当前输出、保留不拆分 surrogate pair 的有界顺序前缀、闭合受支持的 Markdown tail、追加固定标记并以普通 `REQUEST_COMPLETED` 提交。超限后缀和未完成 Tool call 不进入公开边界。

## 验证

- `npx -y @fission-ai/openspec@1.6.0 validate recover-ts-model-output-token-limit --strict`：PASS。
- `npx -y @fission-ai/openspec@1.6.0 validate --all --strict`：目标 change PASS；全局存在与本 change 无关的既有 `fix-agent-web-live-run-identity-recovery` validation failure。
- `git diff --check`：PASS。

## 建议下一步

完成实现门禁；归档时使用 `openspec-archive-design-sync` 将输出恢复契约收敛到 `model-invocation-contract` 并移除 legacy 竞争定义。
