## 背景和现状（Context）

当前 NextAgent 的 structured log 统一通过 `ObservabilityProjectorHost.acceptObservation(event)` 进入 `agent-observability`，在 host 接收边界先执行 redaction，再由 `StructuredLogProjector` 等 surface projector 写出。这个边界保证了日志、audit、metric 不会拿到 raw prompt、raw provider body、stack、path、secret、credential 或 token。

现状问题不是“系统没有 safe”，而是默认 safe 输出对本地排障过于克制。当前 normal 行为以 `safeReasonCode`、低基数字段和有界 `safeSummary` 为主，很多排障线索虽然已经在 trusted observation、safe error 或 diagnostic snapshot 中存在，但默认没有稳定投影到日志。与此同时，系统没有“关闭 safe”的受控配置入口，直接放开 raw 日志会与现有 redaction / observability 基线冲突。

本 change 面向本地 runtime 的排障诉求，相关方包括：
- 本地开发者和运维排障人员：希望在不泄露敏感数据的前提下获得更多诊断线索；
- `agent-app`：拥有配置加载、overlay、freeze 和 app composition；
- `agent-observability`：拥有 redaction、observation handoff 和 structured logging；
- 其它业务模块：只能继续通过 observation / safe diagnostic 提供输入，不能新增旁路日志协议。

约束如下：
- 配置必须落在 `default-system.yaml` / `application.yaml` 的现有配置边界内；
- redaction 仍是强制安全边界，不能被 debug 模式关闭；
- 只能选择一个实现路径，不能同时支持“safe debug”和“unsafe debug”两种解释；
- 不能引入新的 observability event bus、logger side-channel 或跨 package raw config 消费。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在系统配置中新增 `observability.logging.redaction`，可选值为 `normal` 和 `debug`，默认 `normal`。
- 定义两档日志模式：
  - `normal`：当前默认行为；
  - `debug`：保持 redaction，不放开 raw 敏感字段，但扩展 safe 诊断字段投影。
- 让 debug 模式成为 frozen runtime config 的一部分，由 `agent-app` 注入 `agent-observability` 使用。
- 保持 observation 主链路唯一：所有 debug 增强仍来自同一 `ObservabilityObservationEvent`。

**非目标：**
- 不支持关闭 redaction。
- 不支持输出 raw exception、stack、path、provider body、tool args/result、prompt 或附件正文。
- 不新增第三种 `unsafe-debug` 模式。
- 不新增独立 debug 日志文件、独立 sink 或直接 `logger.debug(rawError)` 旁路。
- 不修改 audit、metric、health 的契约范围，除非它们复用同一 safe diagnostic 字段且不改变现有输出承诺。

## 设计决策（Decisions）

### 决策 1：配置入口固定为 `observability.logging.redaction=normal|debug`

唯一选定方案是在 `default-system.yaml` 中新增：

```yaml
observability:
  logging:
    redaction: normal
```

用户 `application.yaml` 可以 overlay 该字段。原因：
- 与现有 `default-system.yaml -> application.yaml -> frozen config` 模型一致；
- `normal|debug` 可以直接表达两档稳定模式，避免布尔值与语义映射分离；
- `normal` 对应当前默认行为，兼容现有部署和测试。

放弃方案：
- `observability.logging=normal|debug`：shape 较浅，但会把日志模式和 redaction 语义混在同一层，不利于后续在 `logging` 下继续增加其它配置。
- `redaction.enabled=false`：与安全基线冲突，且会把 debug 诉求错误解释为关闭 safe。

### 决策 2：debug 是 safe debug，不是 raw debug

debug 模式只允许扩展 safe 诊断字段投影，不能改变 redaction 分类和 forbidden field 集。原因：
- 用户的真实诉求是“看更多相关数据”，不是“看所有原始数据”；
- 现有 OpenSpec 明确禁止 raw 敏感数据进入日志；
- 本地 runtime 也会处理 provider credential、客户网络诊断输入、路径和 tool 输出，不能因为 debug 就突破边界。

放弃方案：
- debug 模式绕过 `sanitizeObservation()`；
- 允许 logger sink 读取 unsanitized observation；
- 在 `catch` 里直打 raw `error.stack`。

### 决策 3：debug 增强必须仍来自同一 observation

唯一允许的增强来源：
- trusted observation fields；
- safe error fields；
- policy-approved diagnostic candidates；
- 同一 observation 的 bounded safe summary。

实现上仍由 `agent-app` 在 composition 时把 frozen logging mode 传给 `agent-observability`，由 projector 或 safe diagnostic 组装逻辑决定 normal/debug 下的可见字段集合。业务模块不感知 logger 模式，不新增新的 logger API。原因：
- 符合 `ObservabilityObservationEvent` 单一事实流设计；
- 避免业务模块按日志模式分支，破坏模块边界；
- 避免不同 surface 出现不一致的事实来源。

放弃方案：
- 业务模块直接根据 config 打不同日志；
- `agent-app` 在 projector 外二次拼接 debug 日志；
- 从 structured log 回放生成额外 debug 记录。

### 决策 4：debug 增强字段采用 allowlist，而不是“尽量多打”

设计上不引入模糊规则“能打就打”，而是要求 debug 只扩大 allowlist。建议实现归属：
- `StructuredLogProjector`：决定 structured log entry 在 debug 模式下额外带出哪些 safe diagnostic fields；
- safe error / wrapper 组装：必要时补齐对本地排障有意义、但仍然低风险的 safe diagnostic 字段；
- `sanitizeObservation()`：继续负责最后一道统一裁剪。

原因：
- allowlist 可测试、可审计、可回归；
- 避免“多打一层对象”导致高基数或敏感内容混入；
- 更符合电信场景下的安全与可追溯性要求。

### 决策 5：首版不定义长期持久化或热切换语义

logging mode 配置是 restart-scoped frozen config 的一部分，只有在进程启动时决定。原因：
- 当前 app config 本来就是 restart-scoped；
- 不需要为本地排障引入热更新配置复杂度；
- 避免 logger/projector 在运行中切模式导致行为不确定。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | debug 模式不关闭 redaction；禁止 raw prompt、tool payload、provider body、stack、path、secret、credential、token 进入日志；增强字段仅来自 allowlisted safe diagnostic fields | redaction policy tests、structured logging tests、negative leakage tests |
| 性能/容量 | 只增加少量 safe 字段投影，不新增第二条日志链路、不做额外业务调用；对日志体积有轻微增长，但仍受 bounded fields 约束 | structured logging unit tests、必要时日志体积断言 |
| 可靠性/恢复 | logging mode 配置为 restart-scoped；logger/debug 投影失败仍按现有 logging degradation 处理，不影响 request lifecycle 或 terminal truth | projector failure tests、transport degradation tests |
| 可维护性 | 配置归属固定在 `agent-app`，日志模式消费归属固定在 `agent-observability`；不让业务模块按模式分支 | config assembly tests、architecture/code review |
| 可测试性 | normal/debug 是确定性的枚举输入，可用 config + projector 黑盒测试验证；allowlist 适合写正负向断言 | config validation tests、structured log projector tests、redaction tests |
| 审计/可追溯性 | debug 模式增强的是 safe 诊断可见性，不改变 audit truth、metric truth 或 request truth；仍可通过 stable refs 和 reason code 关联 | observability tests、trace-log-linking related tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `observability.logging.redaction` 是稳定枚举配置，取值仅允许 `normal|debug`，默认 `normal` | 1.1, 1.2 | app config validation tests、config assembly tests |
| `default-system.yaml` 提供默认值，`application.yaml` 可 overlay | 1.1, 1.2 | config assembly tests、local runtime package tests |
| debug 模式不关闭 redaction | 2.2, 3.2 | redaction policy tests、negative leakage tests |
| debug 模式只增强 safe diagnostic fields | 2.1, 2.3 | structured log projector tests |
| observation 主链路唯一，不新增旁路 logger 协议 | 2.1, 3.3 | code review、architecture checks、projector tests |
| debug 失败不影响业务结果 | 2.3, 3.2 | transport degradation tests、existing logging tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：
  - `openspec/specs/app-config-schema/spec.md`：配置字段、默认值、overlay 规则
  - `openspec/specs/structured-logging/spec.md`：normal/debug 两档行为和 safe diagnostic 增强
  - `openspec/specs/redaction-policy/spec.md`：debug 模式不绕过 redaction
- 架构和跨模块设计：
  - `openspec/designs/architecture/configuration-boundary.md`：配置归属、overlay、restart-scoped 语义
  - `openspec/designs/architecture/observability-boundaries.md`：debug 模式与 redaction / observation boundary 的关系
- 模块设计：
  - `openspec/designs/modules/agent-app.md`：frozen config 注入 observability 的职责
  - `openspec/designs/modules/agent-observability.md`：debug-aware projector / safe diagnostic 投影职责
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [debug 字段过多导致日志重新变噪] -> 首版使用 allowlist，不采用“自动输出全部 safeDetails”策略，并通过测试锁定字段集合。
- [开发者误以为 debug 可以看到 raw 异常] -> 在 spec/design 中明确 debug 仍受 redaction 约束，禁止把该字段解释为 unsafe 模式。
- [不同 producer 对 debug 的理解不一致] -> 由 `agent-observability` 统一消费 frozen flag，业务模块不直接分支。
- [后续想扩展更多模式] -> 首版先固定为 `normal|debug`；若未来出现第三档模式，必须通过新的 OpenSpec change 扩展允许值和行为契约。

## 迁移计划（Migration Plan）

无破坏性迁移。发布步骤：
- 在 `default-system.yaml` 增加 `observability.logging.redaction=normal`；
- 用户如需本地排障，可在 `application.yaml` 中显式 overlay 为 `debug`；
- 如出现意外日志体积增长或字段不符合预期，可回滚到 `normal` 或回退该 change。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/app-config-schema/spec.md`：保留 `observability.logging.redaction=normal|debug` 配置契约
- `openspec/specs/structured-logging/spec.md`：保留 normal/debug 两档 structured log 行为
- `openspec/specs/redaction-policy/spec.md`：保留 debug 不绕过 redaction 的契约
- `openspec/designs/architecture/configuration-boundary.md`：补充该配置的归属和 overlay 语义
- `openspec/designs/architecture/observability-boundaries.md`：补充 safe debug 与统一 redaction 的边界
- `openspec/designs/modules/agent-app.md`：补充 app composition 消费该配置的职责
- `openspec/designs/modules/agent-observability.md`：补充 projector/debug allowlist 设计
- `openspec/designs/spec-to-design-map.md`：补充映射导航

## 待确认问题（Open Questions）

- debug 模式下首版要额外暴露哪些 safe diagnostic fields，需要在实现前列出最小 allowlist；当前方向已收敛为“allowlist”，但字段清单仍待在实现任务中落地。
