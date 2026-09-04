# NextAgent 测试特性树能力补齐版本计划

> 本文基于 `docs/NextAgent测试特性树.md` 的 2026-07-09 测试追溯快照，结合 2026-07-20 当前 active OpenSpec change 状态重新排序。本文是测试特性树缺口的规划视图，不替代 `openspec/specs/`、active change artifact 或 `docs/nextagent-ts-change-roadmap-v2.md`。

## 判定口径

- `P0`：没有规格就无法提测，或缺口会阻断当前测试特性树形成可执行验收。
- `P1`：已有 active change 覆盖或正在实现，但需要补完验证、归档同步或核心闭环。
- `P2`：机制已存在，缺少数量上限、策略细则或边界选择，影响专项测试的断言来源。
- `P3`：厂商生态、远端协议或体验增强，可在基础验收后推进。

## 当前待补齐能力总表

| 优先级 | 能力项 | 当前判断 | 待补齐内容 | 推荐承载 |
|---|---|---|---|---|
| P0 | 上下文缓存 | 真缺口 | system prompt 缓存优先策略、缓存命中/失效、100% 缓存目标是否强制 | 新增 context cache OpenSpec change |
| P0 | 流控 | 真缺口 | `30` 并发、`30` 排队、拒绝/排队/降级语义和 scope 维度 | 新增 flow-control/capacity OpenSpec change |
| P0 | 性能 SLO | 真缺口 | `1C2G/30` 并发、首字 `<=1s`、submit `<=500ms`、routing `<=50ms` | `add-ts-capacity-benchmark-gate` 或拆分 SLO change |
| P0 | 集群部署 | 真缺口 | 多实例部署协议、timeline sequence 协调、恢复/锁/幂等边界 | P5 distributed runtime changes |
| P0 | remote agent / AgentLink | 真缺口 | 远端 agent 发现、调用、认证、结果回传、失败映射协议 | remote Agent protocol change |
| P1 | Task channel / 任务中心接入 | active change 已覆盖 | stable spec/design/map 基线同步、归档确认 | `add-ts-task-channel` 归档同步 |
| P1 | Cron / 定时任务 | active change 已覆盖 | 验证证据、stable spec/design/map 同步 | `add-ts-cron-tools` 归档同步 |
| P1 | Workflow event history | active change 未完成 | 所有节点事件投影、safe input/output、diagnostic、redaction negative case | `add-ts-workflow-event-history` |
| P1 | Workflow orchestration policy | active change 未启动 | workflow/model-loop 双模式、路由目标、fallback、model-planned workflow、DAG validation | `add-ts-workflow-orchestration-policy` |
| P1 | 长期记忆管理 | 基本实现，剩验证 | build、前端测试、architecture lint、openspec strict | `add-ts-long-memory-manage` |
| P1 | OTel trace export | 基本实现，剩验证 | build、定向测试、contract、architecture、openspec strict | `add-otlp-trace-export` |
| P2 | 请求重试上限 | 机制已有，数字缺失 | `maxRetry=5` 是否强制、超过后 safe error | `request-retry` refinement |
| P2 | 请求抢占/优先级调度 | 抢占已实现，数字规则缺失 | 既有“新请求在安全边界抢占旧请求”语义保持不变；补齐最多 5 个和优先级排队规则，多实例一致性由 P5 change 覆盖 | scheduling refinement + `add-ts-runtime-multi-instance-consistency` |
| P2 | 路由目标枚举 | 部分已有 | `recipe`、`agent loop`、`指定 Skill`、`拒答` 决策枚举和 evidence | 并入 orchestration policy |
| P2 | 模型 fallback 策略 | 后置 | 指定 fallback 模型、自定义策略、失败降级 evidence | agent-core fallback refinement |
| P2 | subagent 限制 | 数字缺失 | 主+subagent 两级、`<=10`、继承/不继承上下文选择 | agent-tool / invoked-agent refinement |
| P2 | hook 点位 | 机制已有，枚举缺失 | 9 个 hook stage、单点 `<=8` 上限 | lifecycle-hook refinement |
| P2 | Skill 渐进加载细则 | 部分缺失 | 分级定义、Skill scope tool `<=20`、激活禁用部分工具 | skill/source/tool refinement |
| P2 | 多 Agent 共部署 | 机制已有，数字缺失 | 单实例 5 agent、默认 1 agent 是否强制 | runtime host agent selection refinement |
| P3 | 厂商模型协议 | provider-agnostic 架构选择 | DS/Qwen/Mistral/GLM/MiniMax、OpenAI/A 公司协议适配 | provider adapter changes |
| P3 | 北斗/审计服务上报 | 厂商生态差异 | 北斗 trace/metric、外部审计服务 adapter | observability vendor adapter changes |
| P3 | 系统资源指标 | 可观测增强 | CPU、内存、队列、并发等指标定义 | metrics/health refinement |
| P3 | Recipe v2 剩余项 | 部分延期 | `global_vars` 迁移、`onError` warning、静态校验器、DAG 并行 | recipe v2 follow-up changes |

## 版本计划排序

| 版本计划 | 目标 | 必须完成 | 可并行推进 | 验收出口 |
|---|---|---|---|---|
| V0 当前收尾版 | 把已经落地的能力从“报告缺失”收敛为 stable baseline | Task channel、Cron、长期记忆管理、OTel trace export 的验证和归档同步 | operational log hardening、composition pipeline 收尾 | active change tasks 全部完成；`openspec validate --all --strict`；影响范围 build/test |
| V1 测试可提测版 | 消除测试特性树中不可测的 P0 规格空白 | 上下文缓存 spec、流控 spec、性能 SLO spec、remote AgentLink spec 初版、集群部署是否后置的明确结论 | 数字型上限 refinement 草案 | 每个 P0 项都有 SHALL/MUST requirement、owner、非目标和验证入口 |
| V2 Workflow 闭环版 | 让 workflow 从“可执行节点”收敛到“可路由、可审计、可复盘” | workflow event history、workflow orchestration policy 首版、路由目标枚举、workflow fallback | Recipe v2 静态校验器、`onError` warning | workflow 黑盒/e2e、redaction negative case、routing evidence 验证通过 |
| V3 策略与容量版 | 补齐可测数字、调度和治理细则 | retry 上限、subagent 上限、hook 上限、Skill 渐进加载细则、多 Agent 共部署上限、模型 fallback 策略 | 抢占数量和优先级规则 refinement | contract/architecture/专项 capacity gate 能断言所有数字型规则 |
| V4 厂商与生态版 | 对接具体商用模型、厂商观测和审计系统 | provider adapter spec、北斗/审计 adapter spec、系统资源指标清单 | 厂商兼容 e2e、部署文档 | provider/observability adapter contract 和安全错误映射通过 |
| V5 分布式运行版 | 支撑多实例一致性、会话亲和重连和故障接管 | `refine-ts-agent-gateway-state-store-boundary`、`add-ts-runtime-multi-instance-consistency`、`add-ts-session-affinity-reconnect-replay`、`add-ts-runtime-failure-takeover`、workflow distributed execution | parallel execution 能力组 | 两个显式路由实例下，正常操作一致性、持久化回放、陈旧写隔离和故障恢复验证通过；不依赖仓内负载均衡实现 |

## Roadmap 映射

| 版本计划 | Roadmap 位置 | 当前处理方式 |
|---|---|---|
| V0 | `P2`、`P3`、`待规划模块` 中的 active changes | 不新建能力，优先完成验证和归档同步 |
| V1 | `Release Quality Gates`、`待规划模块`、`P5` | 对 P0 真缺口创建或收敛 OpenSpec change |
| V2 | `P3 — Workflow 执行范式` | 优先推进 event history 和 orchestration policy |
| V3 | `P0/P1/P2` 已有能力 refinement | 用小型 refinement change 固化数量和策略 |
| V4 | `Observability`、`Model Invocation`、remote gateway 相关候选 | 按厂商 adapter 独立 change 推进 |
| V5 | `P5 — 分布式与并行执行` | 等 V1 明确集群目标后实施 |

## 推进原则

1. P0 缺口先补规格，不直接补测试或实现。
2. 已有 active change 覆盖的能力先归档同步，避免测试报告继续按旧快照重复登记缺失。
3. 数字型要求必须有稳定 requirement，测试不得从报告文本反向创造产品约束。
4. Workflow 相关缺口按 event history 先于 orchestration policy 推进；没有可复盘事件，就很难验收路由和 fallback。
5. 厂商生态差异独立到 adapter change，不污染 provider-agnostic 核心 contract。
