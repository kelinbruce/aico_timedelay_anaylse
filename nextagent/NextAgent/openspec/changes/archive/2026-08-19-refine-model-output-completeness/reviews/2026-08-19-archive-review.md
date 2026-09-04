# OpenSpec 归档语义检视

- Change：`refine-model-output-completeness`
- 检查日期：2026-08-19
- 状态：PASS

## Findings

无未解决 finding。归档只同步已合入并验证的目标行为与长期设计，不修改生产代码。

## 需群内确认

已解决。项目群于 2026-08-19 确认新增 `ModelIncompleteOutputReason`、optional `ModelFinalResult.incompleteOutputReason` 及其 `agent-contracts/model` ownership；确认结果由用户在当前归档任务中转达，未提供独立消息链接。该 refinement 不新增 Web、runtime、gateway 或 persistence contract。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | `agent-model` 建立 provider-neutral 完整性证据，`agent-core` 独占有界恢复；依赖方向不变。 |
| core contracts | PASS | 复用既有 `ModelFinalResult`，新增 optional 封闭字段，不新增平行 DTO、port、event 或 durable fact。 |
| roadmap owner boundaries | PASS | 只修改既有 `FN-4.1 调用模型` 与 canonical `model-invocation-contract`。 |
| roadmap change rules | PASS | 单一系统可验证目标、单一主要 owner 链和唯一实施路径。 |
| current code | PASS | 当前代码已包含相同 enum/schema、adapter evidence classification 与 Core recovery consumption，且已通过原 change 的实现验证。 |
| engineering principles | PASS | 一个 optional 字段与两个处置语义不同的枚举值是闭合问题所需的最小 contract refinement。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 既有 `FN-4.1 调用模型` 与 `model-invocation-contract` 的 canonical 映射不变，无新增多对多关系。 |
| Delta/stable operation | PASS | 三个 MODIFIED Requirements 已完整合入同名 stable spec。 |
| Function 变更汇总 | PASS | 归档输入按输出、处理过程、结果和规格字段刷新长期 Function，未写入 stable spec。 |
| Function 规格 | PASS | 保留面向黑盒验收的输出不完整恢复规格及精确边界。 |
| Requirement 元数据 | PASS | stable spec 保留唯一所属 Function、需求类别以及适用的质量属性和范围。 |
| 质量属性分层 | PASS | 黑盒恢复、安全和容量目标归 stable spec；证据分类与恢复机制归 owning module/architecture design。 |
| 触发机制 | PASS | 由 `ModelFinalResult.incompleteOutputReason` 作为唯一恢复触发事实。 |
| 输入和前置条件 | PASS | 明确 finish reason、结构残缺 Tool call、合法 usage 与有效输出预算边界。 |
| 输出和副作用 | PASS | 完整结果、受控重生成/续写、安全失败与残缺 Tool call 零执行均已闭合。 |
| 核心决策逻辑 | PASS | `output-limit` 与 `truncated-tool-call` 的不同恢复规则唯一确定。 |
| 存量代码基线 | PASS | design 基于既有 terminal normalization、OpenAI-compatible adapter 与输出恢复流程增量扩展。 |
| 增量实施路径 | PASS | 未新建 provider registry、恢复服务、配置项或 runtime retry。 |
| 唯一实施路径 | PASS | contract 定义事实、model 建立证据、core 消费事实。 |
| 状态或 artifact 契约 | PASS | optional enum、closed schema、finish reason 独立性及失败互斥边界均已稳定化。 |
| flow 集成 | PASS | complete/stream 统一 normalization 后进入既有 Core model route。 |
| 失败和降级 | PASS | 缺少可信证据 fail closed；恢复耗尽按当前已合入基线安全失败。 |
| 验收示例 | PASS | 覆盖 Token 饱和边界、usage 缺失/非法、重生成、续写、取消和残缺 Tool call 零执行。 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | OpenSpec Function 与 runtime Capability 未混用。 |
| canonical terminology | PASS | `finishReason`、`incompleteOutputReason` 与两个枚举值跨 artifact 一致。 |
| BCP 14 规范关键词 | PASS | 规范义务保留在 stable spec。 |
| 语义闭合 | PASS | 证据主体、条件、恢复结果和失败结果均可唯一判断。 |
| 量词与可测量边界 | PASS | 使用整数 Token、无容差、一次预算提升、最多三次续写及 `150000` UTF-16 code unit 边界。 |
| 形式化表示适配性 | PASS | decision table 与场景足以闭合行为，不需要新增状态机。 |
| scenario-to-test 来源 | PASS | 场景对应 contract、adapter 和 Core 黑盒/边界测试。 |
| 黑盒/白盒边界 | PASS | stable spec 定义可观察行为，module/architecture design 承载 owner 和内部流程。 |
| 端到端追踪 | PASS | Feature → `FN-4.1` → Requirements → Scenarios → tasks/tests 可定位。 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | PASS | proposal、design、specs 与 tasks 覆盖目标、owner、依赖、范围和验收。 |
| 创建前覆盖检查 | PASS | 不改变最小内核 owner，不增加未来扩展点。 |
| 生成后一致性确认 | PASS | artifacts、架构、代码和长期基线一致。 |
| release scope / not-planned / candidate | PASS | 未混入 provider quirk registry、容差配置或第二恢复 owner。 |
| 并行边界 | PASS | 后续 degradation notice refinement 按用户确认的顺序基于本次 stable spec 继续调整，不与本次归档形成未协调并行写入。 |
| 第一性原理/KISS/SOLID | PASS | 最小跨 package 事实满足证据 owner 与恢复 owner 的职责分离。 |
| 基于存量代码的增量设计 | PASS | 复用已有结果、normalization 与恢复流程。 |
| 唯一可实施路径 | PASS | 无竞争方案或 owner 漂移。 |

## 需求和设计清晰度

归档后的 stable spec 定义完整黑盒契约；`model-provider-boundary.md`、`agent-model.md` 与 `agent-core.md` 保留证据建立、恢复 owner、失败边界、禁止项和验证关注点。后续维护无需依赖 archived change 才能理解或修改该能力。

## 验证

- `openspec validate --all --strict`：301 passed，0 failed。
- `git diff --check`：通过。
- 长期文档文本自检的命中均来自本次未触达的既有 baseline 文档；本次更新文件没有新增 `TBD`、`TODO` 或归档 change 跳转式措辞。
