## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.11 从消息派生子会话` | 每次新建派生会话时，在当前源标题前机械添加固定 `Fork · ` 前缀，并保持 fork notice 使用未加前缀的源标题快照 | `session-fork-from-message` | `FN-1.11 从消息派生子会话` |

## `FN-1.11 从消息派生子会话`

### 目标与规范依据

本设计落实 proposal 中“让用户仅凭标题即可区分原会话与派生会话”的目标。每次成功创建新的 child session 都只执行一次固定前缀拼接；多级派生自然累加，兄弟 child 允许同名，不引入序号、标题唯一性或并发协调。

#### 本 Function 的目标 Requirements

canonical spec：`session-fork-from-message`

- `MODIFIED`：`Fork From Durable Visible Assistant Message`
- `MODIFIED`：`Fork Notice Projection`

影响实施和验收的唯一补充约束是：child 标题继续使用现有会话标题的 JavaScript `string.length` 计数上限；超过 100 时只截断源标题快照的尾部，并保留本次新增的完整前缀。该约束不改变公共 API schema。

### 当前实现

- `packages/agent-runtime/src/lifecycle/submit.ts` 的 message-anchor fork 路径由 `agent-runtime` 编排，并在调用 `SessionForkStoreGateway.forkSessionFromMessage(...)` 前组装 child `SessionRecord` 和 `ForkSourceRecord`。
- 私有方法 `normalizeForkSessionTitle(...)` 对源标题执行 trim，并在缺失或 trim 后为空时返回 `Untitled session`。
- 当前 child `SessionRecord.title` 直接使用上述规范化结果；`ForkSourceRecord.sourceSessionTitleSnapshot` 随后又取 `childSession.title`。因此 child 标题与 notice 源标题快照当前是同一个值。
- `packages/agent-session/src/services/session-preparation.ts` 的手动标题校验使用 JavaScript `string.length` 执行 100 字符上限；Web title schema 也声明 100 字符上限。
- `tests/agent-kernel/session-fork-runtime.test.ts` 已覆盖源标题规范化及 fork source metadata，但当前断言 child 标题与 notice 快照相同。
- 现有 gateway composite write、idempotency replay、owner+agent scope、message 复制和 fork notice read model 已能承载目标行为；标题不是 session 身份或查询 key。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 新 child 标题为固定前缀与源标题快照的拼接 | child 标题仅为规范化后的源标题 | 缺少固定前缀拼接和超长结果的尾部截断 |
| 每一级派生都机械累加一次前缀，已有前缀不折叠 | 当前没有派生标题前缀处理 | 需要确保实现不解析、检测或折叠源标题文本 |
| fork notice 保留未加前缀的源标题快照 | metadata 当前复用 child 标题 | 需要在拼接前保存独立源标题快照并写入 metadata |
| 兄弟 child 可同名且 replay 不重复增加前缀 | gateway 已按 session id 和 idempotency key 管理创建事实，不按标题去重 | runtime 只需保持现有 composite write 和 replay 语义，不得新增标题查询或唯一性协调 |

### 修改方案

`agent-runtime` 仍是唯一 owner，修改范围限定在 `packages/agent-runtime/src/lifecycle/submit.ts` 的现有 fork 编排路径：

1. 在 runtime 内定义固定私有常量 `forkSessionTitlePrefix = 'Fork · '`，不进入配置、locale、公共 contract 或 gateway contract。
2. 在组装 child 事实前调用现有规范化逻辑得到不可变的 `sourceSessionTitleSnapshot`。该值来自已经通过可信 scope 校验并加载的 source session 当前标题，仍执行 trim/空标题 fallback。
3. 使用现有 100 字符计数规则计算可保留的源标题长度：`100 - FORK_SESSION_TITLE_PREFIX.length`；用 `sourceSessionTitleSnapshot.slice(0, sourceLimit)` 截断尾部，再与完整前缀拼接得到 `childSessionTitle`。前缀长度小于 100，因此该计算始终产生非负边界。
4. `childSession.title` 写入 `childSessionTitle`；`forkSource.sourceSessionTitleSnapshot` 独立写入未加前缀、未为 child 上限截断的 `sourceSessionTitleSnapshot`。这样 notice 继续表示 fork 时看到的源会话标题，child 标题只承担派生识别。
5. 保留现有 `forkSessionFromMessage(...)` composite write、idempotency key、child `sessionId` 生成和 replay 结果。实现不查询其他 session 标题，不做标题去重，也不增加锁、序号或并发状态；相同源标题自然得到相同 child 标题。

该路径对 request-anchor fork 同样生效，因为它最终委托现有 message-anchor fork。错误路径、owner+agent scope 校验、事务原子性、fork notice read model 和 Web projection 均保持不变。`agent-contracts`、Gateway port、SQLite schema、`agent-session` 和 `agent-channel-web` 无需修改。

选择机械前缀累加是因为它直接表达派生层级，并避免判断标题中的文本究竟来自用户还是历史 fork。序号方案要求查询兄弟会话并定义并发唯一性，单层折叠方案又要求解析用户标题；二者都超出“区分原会话与派生会话”的必要范围。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | 无新增黑盒质量目标；由两个功能性 Requirements 派生 | 单一固定常量、单次规范化与单次拼接；不增加查询、配置或状态 | 审查实现仅位于 runtime fork 编排，不出现前缀解析、标题唯一性或 Gateway 扩展 |
| 可测试性 | 无新增黑盒质量目标；由两个功能性 Requirements 派生 | 标题计算为确定性纯字符串规则，notice 快照与 child 标题在写入前显式分离 | 覆盖普通、累加、已有前缀、空标题、上限、同名和 idempotency replay |

## 验证策略（Verification Strategy）

- runtime characterization/integration 测试覆盖可观察的 child session metadata 和写入的 fork source metadata，断言普通派生、递归累加、用户已有前缀、手动重命名、空标题和 100 字符边界。
- 同一源的两次成功创建必须断言 child `sessionId` 不同但标题相同；同一 idempotency key replay 必须断言返回首次 child，且标题不会再次增加前缀。
- notice 行为通过 fork source metadata 与现有 session read-model 测试边界验证：source snapshot 不包含本次 child 前缀，现有显隐与 scope 行为不回归。
- 语义审查确认没有修改公共 schema、Gateway port、持久化表、owner/agent scope 或前端投影，也没有引入标题查询、序号和并发协调。
- OpenSpec strict validation 覆盖 delta operation、规范关键词和 Function 映射；实现阶段运行受影响 runtime 测试及仓库架构/契约门禁。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/session-fork-from-message/spec.md`：合并两个 `MODIFIED` Requirements。
- `openspec/designs/functions/D1-会话与流式交互/D1.2-会话生命周期管理/FN-1.11-从消息派生子会话.md`：刷新描述、输出、处理过程、结果和“派生标题”规格项。
- `openspec/designs/features/D1-会话与流式交互/D1.2-会话生命周期管理/F-1.6-基于历史回复新建会话.md`：刷新用户可见的派生标题识别价值与边界。
- `openspec/overview.md`：无；该局部展示行为不改变系统范围或全局不变量。
- `openspec/designs/architecture/core-contracts.md`：无；fork notice 公共 shape、runtime/Gateway 边界和数据 owner 均未变化。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 在 fork materialization 中生成 child 派生标题并独立保留 source title snapshot 的职责。
- `openspec/designs/modules/agent-session.md`：无；仍只按现有 metadata 投影 fork notice。
- `openspec/designs/adr/`：无；没有需要独立保留的跨模块技术决策。
- `openspec/designs/spec-to-design-map.md`：无；spec、Function、Feature 和 module 的导航关系未变化。

## 风险与取舍（Risks / Trade-offs）

- 多级派生会让标题逐步变长。通过既有 100 字符上限和只截断源标题尾部控制长度；完整保留最近一次前缀，确保派生身份仍可识别。
- 同一源会话多次派生会出现同名 child。该结果是明确接受的产品取舍；session 身份、访问和运行继续只依赖可信 scope 与 `sessionId`。
- 固定英文前缀在中英文场景中均不随 locale 变化。当前目标明确接受统一使用 `Fork · `，避免新增本地化配置和跨层依赖；后续若产品要求本地化，应通过独立 OpenSpec change 处理。
- 已存在的 child session 不回填标题，因此发布前后的历史会话展示可能不同。该兼容边界避免数据迁移和对用户手动标题的覆盖。

## 待确认问题（Open Questions）

无。行为、契约、owner、持久化和验收路径均已收敛；本 change 不修改 `agent-contracts`，无需群内契约确认。
