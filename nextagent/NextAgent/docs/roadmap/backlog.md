[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)

## 待规划模块

本文件集中维护尚未归入具体路标版本、但后续仍可能排序进入 P0-P5 的规划池。明确不规划的能力不进入待排序池。

排序规则：

1. 先判断是否必须先补 OpenSpec；没有权威 requirement 的能力不得直接进入实现阶段。
2. 再判断是否已有 `docs/nextagent-ts-changes/` 输入；已有输入优先做 owner、scope 和验收收敛。
3. 最后按测试阻塞程度、产品依赖和实现 owner 稳定性排序到 P0-P5。

## 待排序池

| 排序键 | 来源 | 能力/Change | 当前状态 | 待规划原因 | 建议归属 |
|---|---|---|---|---|---|
| T0-01 | 测试特性树缺口 | 上下文缓存 | no-change | system prompt 缓存优先、命中/失效和 100% 缓存目标没有权威 requirement | V1 测试可提测版 |
| T0-02 | 测试特性树缺口 | 流控 | no-change | `30` 并发、`30` 排队和拒绝/排队/降级语义未规格化 | V1 测试可提测版 |
| T0-03 | 测试特性树缺口 | 性能 SLO | partial-change | `1C2G/30` 并发、首字 `<=1s`、submit `<=500ms`、routing `<=50ms` 需要确认是否升级为 SHALL | V1 测试可提测版 |
| T0-04 | 测试特性树缺口 | remote Agent / AgentLink | candidate-split-needed | 远端 agent 发现、调用、认证、结果回传、失败映射协议尚未形成单一承载 change | V1 或 V4，先做协议 spec |
| T0-05 | 测试特性树缺口 | 集群部署目标确认 | candidate-split-needed | 多实例部署协议是否进入近期版本尚未确认；若进入，需拆到 P5 distributed runtime changes | V1 先确认，V5 实施 |
| T1-01 | 测试特性树缺口 | 请求重试上限 | refinement-needed | `maxRetry=5` 是否强制、超过后的 safe error 需要补 requirement | V3 策略与容量版 |
| T1-02 | 测试特性树缺口 | 请求抢占/优先级调度 | clarify | 当前 minimal 内核后置抢占；是否支持最多 5 个抢占和优先级队列需产品确认 | V3 或继续后置 |
| T1-03 | 测试特性树缺口 | subagent 限制 | refinement-needed | 主+subagent 两级、`<=10` 和上下文继承选择机制需要归入 agent-tool / invoked-agent refinement | V3 策略与容量版 |
| T1-04 | 测试特性树缺口 | hook 点位和数量上限 | refinement-needed | 9 个 hook stage 与单点 `<=8` 上限需要和 lifecycle hook 已完成能力对齐 | V3 策略与容量版 |
| T1-05 | 测试特性树缺口 | Skill 渐进加载细则 | refinement-needed | 分级定义、Skill scope tool `<=20`、激活禁用部分工具未规格化 | V3 策略与容量版 |
| T1-06 | 测试特性树缺口 | 多 Agent 共部署上限 | refinement-needed | 单实例 5 agent、默认 1 agent 是否强制需要和 runtime host agent selection 对齐 | V3 策略与容量版 |
| T2-01 | 测试特性树缺口 | 厂商模型协议 | adapter-needed | DS/Qwen/Mistral/GLM/MiniMax、OpenAI/A 公司协议属于 provider adapter 层，不应污染 provider-agnostic core contract | V4 厂商与生态版 |
| T2-02 | 测试特性树缺口 | 北斗/审计服务上报 | adapter-needed | 北斗 trace/metric 与外部审计服务 adapter 需要独立厂商承载 | V4 厂商与生态版 |
| T2-03 | 测试特性树缺口 | 系统资源指标 | refinement-needed | CPU、内存、队列、并发等指标需要和 metrics/health、capacity gate 对齐 | V4 或 V3 |

## 已有 Change 待归属

| Change | 状态 | 目标 | 详情 |
|---|---|---|---|
| [`add-ts-request-edit-resubmit`](../nextagent-ts-changes/add-ts-request-edit-resubmit.md) | ready | 支持编辑最近完成请求输入并重新提交为新请求。 | [详情](../nextagent-ts-changes/add-ts-request-edit-resubmit.md) |
| [`add-ts-feedback-audit-linking`](../nextagent-ts-changes/add-ts-feedback-audit-linking.md) | ready | 将 feedback 与 tenantId、subjectId、sessionId、requestRunId、messageId 和 audit event 关联；记录 feedback.submitted/rejected，并执行 redaction policy 和 owner-scope 可见性约束。 | [详情](../nextagent-ts-changes/add-ts-feedback-audit-linking.md) |
| [`add-ts-memory-infrastructure-adapters`](../nextagent-ts-changes/add-ts-memory-infrastructure-adapters.md) | active | 记忆存储可适配不同基础设施（本地/远端/向量数据库）。 | [详情](../nextagent-ts-changes/add-ts-memory-infrastructure-adapters.md) |
| [`add-ts-long-term-memory-remote-adapter`](../nextagent-ts-changes/add-ts-long-term-memory-remote-adapter.md) | active | 远端长期记忆 adapter 可接入，本地和远端 adapter 可切换。 | [详情](../nextagent-ts-changes/add-ts-long-term-memory-remote-adapter.md) |

## 已完成但仍在旧池中的条目

| Change | 状态 | 处理 |
|---|---|---|
| [`add-ts-local-artifact-store`](../nextagent-ts-changes/add-ts-local-artifact-store.md) | complete | 已完成，后续只作为 artifact download 的依赖引用，不再作为待排序项。 |
