# OpenSpec 语义检视

- Change：`refine-model-output-completeness`
- 日期：2026-08-12
- 结论：PASS

| 检查项 | 结论 | 证据 |
|---|---|---|
| Function/spec 归属 | PASS | 只修改既有 `FN-4.1 调用模型` 及 canonical `model-invocation-contract`。 |
| Requirement 合并 | PASS | 三个 MODIFIED 标题与 stable spec 精确一致。 |
| 契约闭合 | PASS | 新字段的类型、optional/null、允许值、字段间约束和失败结果均已定义。 |
| 唯一实施路径 | PASS | contracts 定义事实、model 建立证据、core 编排恢复。 |
| 安全与容量 | PASS | 残缺 Tool 零执行，推断要求预算饱和，恢复次数保持有界。 |
| 端到端追踪 | PASS | proposal、Requirements、tasks 与 contract/adapter/Core tests 可定位。 |
| 冲突检查 | PASS | active changes 未定义同名字段或平行恢复 owner。 |

## 需群内确认

已解决。项目群于 2026-08-19 确认新增 `ModelIncompleteOutputReason` 及 optional `ModelFinalResult.incompleteOutputReason`，并确认该 vocabulary 与字段继续由 `agent-contracts/model` 拥有；确认结果由用户在当前归档任务中转达，未提供独立消息链接。该 refinement 不新增 Web、runtime、gateway 或 persistence contract，无待确认项。

复检发现并已解决两个 P1：补齐 NetAgent contract shape guard 及外部接口汇总；恢复链记录首次 `truncated-tool-call`，确保预算提升后原因变为 `output-limit` 时仍安全失败，同时保留纯文本 `output-limit → output-limit` 的既有 continuation。正反原因转换测试与 focused architecture guard 均通过，当前无未解决 finding。
