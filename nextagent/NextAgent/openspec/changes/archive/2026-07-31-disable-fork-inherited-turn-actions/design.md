## 背景和现状（Context）

派生会话继承 turn 的 retry/edit 按钮必点必错（lane 无 `RequestRun`，后端返回 `REQUEST_RETRY_NOT_FOUND`/`EDIT_LATEST_NOT_FOUND`）。已确认的两个收敛事实：

- 前端 retry/edit 按钮只在 latest turn 渲染（`TurnBlock.tsx` 的 `showLatestTurnActions = isLatest && !turnActionsDisabled`），后端也只接受 lane latest target，问题面只剩"尚无新提问的 child session 的最新继承 turn"。
- 前端缺少持久化信号识别继承 turn：`forkNotice` 在首条新消息后消失，且规格禁止暴露 anchor message id；copied message 的 child run anchor 与真实 run 在 UI 上不可区分。

通道现状：`SessionMessage.metadata`（`JsonObject`）从 gateway record 到 domain 对象到 Web conversation response（items 为 `looseObject`）全程直通，前端 `SessionConversationMessage.metadata` 已接收；`conversationAdapter.toHistoryEnvelope` 会把 metadata 展开进 history envelope payload。因此一个 metadata 布尔标记可以零 contract 变更地从 fork 写入点流到前端 projection。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- fork 写入 copied messages 时注入 child-owned 继承标记，前端据此禁用继承 latest turn 的 retry/edit 入口并给出 Tooltip 原因说明。
- 零存储结构变更、零 contract 变更、零 Web schema 变更。

**非目标：**

- 不让继承 turn 真正可 retry/edit（需要 lane run 物化，改动面大，已被明确放弃）。
- 不回填既有派生会话。
- 不改变后端 retry/edit 任何语义；不做 attachment 相关处理。

## 设计决策（Decisions）

### D1：metadata 布尔标记，而非暴露 anchor id 或新增 DTO 字段

候选：暴露 `childAnchorMessageId`（需改 fork notice 规格与 Web schema，且分页场景下前端需按消息序推算边界，脆弱）；新增显式 DTO 字段（需改 contract 与 Web schema）。采用 metadata 标记：`metadata` 是既有公开通道，写入点唯一（fork copy），递归 fork 天然一致（grandchild 全部 copied messages 都写入），分页/刷新下每个 turn 自带信号无需推算。标记命名 `forkInherited`，值为 JSON `true`。

### D2：标记只做投影提示，不做后端合法性依据

后端 retry/edit 的权威边界仍是 lane `RequestRun` 事实；标记缺失（旧会话）或被绕过（直接调 API）时行为与今天完全一致。这避免把安全语义绑到一个可被客户端观察的字段上，也保证旧派生会话零迁移。

### D3：禁用而非隐藏按钮

与 retry 次数上限的既有禁用模式一致（`not-allowed` 光标、opacity 0.45、Tooltip 说明、点击不触发），用户可感知"这个操作存在但不适用于继承内容"，比静默消失更可解释。禁用同时覆盖 TurnBlock 按钮与 Composer 的 `canRetryLatest`/`canEditLatest` 入口。

### D4：递归 fork 语义

grandchild 的 copied messages 全部重新写入标记（`copyForkMessage` 无条件注入），与 source child 消息是否已带标记无关；`forkInherited` 不在 `isUnsafeForkMetadataKey` 名单内，布尔值经 `remapForkValue` 原样保留，无 fork 拒绝风险。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
| --- | --- | --- |
| 安全 | 标记不含任何 source 坐标；不作为后端授权/合法性依据；后端安全错误边界不变 | runtime fork 测试断言标记无 source id；后端 not-found 负例测试保持通过 |
| 性能/容量 | 每条 copied message 的 metadata 多一个布尔 key，存储增长可忽略 | 既有 fork resource limit 测试回归 |
| 可靠性/恢复 | 标记随 fork 同事务落库，无部分状态；不影响 recovery/stream/activeRun | 既有 fork 事务测试回归 |
| 可维护性 | 写入点唯一（`copyForkMessage`），前端读取点唯一（projection 标记映射）；不新增 contract | code review 检查点：标记 key 常量在 runtime 与 frontend 各自唯一定义 |
| 可测试性 | 标记写入与投影禁用均可用既有测试替身确定性验证 | 见验证映射 |
| 审计/可追溯性 | 标记是 child-owned provenance 事实，不改变 audit/lineage 语义 | N/A |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
| --- | --- | --- |
| fork 为每条 copied message 写入 `forkInherited: true` 且无 source 坐标 | T1 | runtime fork 测试断言 copied message metadata |
| fork 后新提交消息不携带标记 | T1 | runtime 测试断言 child 新 submit 的 root user message metadata 无标记 |
| 递归 fork 全部 copied messages 带标记 | T1 | runtime fork-of-fork 测试 |
| 前端 projection 将标记映射到 TurnBlock | T2 | agent-web projection 单元测试 |
| 继承 latest turn 的 retry/edit 按钮禁用 + Tooltip + 点击不触发 | T3 | agent-web TurnBlock/Composer 测试 |
| 新提问后的 latest turn 按钮正常 | T3 | 同上测试覆盖对照组 |
| 后端边界不变（绕过禁用仍 not-found） | T1 | 既有 retry/edit not-found 测试保持通过（回归） |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/session-fork-from-message/spec.md`（标记写入与语义，主承载）、`openspec/specs/request-retry/spec.md` 与 `openspec/specs/request-edit-resubmit/spec.md`（按钮禁用投影）。
- 架构/模块设计/ADR/导航：无。标记是单点 metadata 事实，不产生新的跨模块状态机、接口语义或长期取舍。

## 风险与取舍（Risks / Trade-offs）

- [旧派生会话按钮仍可点、点了仍报 not-found] -> 明确不回填；行为与今天一致，无回归。
- [metadata 标记作为投影信号不如显式 DTO 字段正式] -> 换取零 contract 变更；`SessionMessage.metadata` 本就是公开通道，且标记无语义安全依赖（D2）。
- [继承回答无法重新生成，用户需手动复制问题重新提问] -> 可接受的 product trade-off；继承历史已在 child active context，重新提问效果等价。

## 迁移计划（Migration）

无数据迁移、无配置变更。旧派生会话无标记，前端按现状渲染，行为不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/session-fork-from-message/spec.md`：合并继承标记 requirement。
- `openspec/specs/request-retry/spec.md`、`openspec/specs/request-edit-resubmit/spec.md`：合并按钮禁用投影 requirement。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-1.11-从消息派生子会话` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/request-edit-resubmit/spec.md`、`openspec/specs/request-retry/spec.md`、`openspec/specs/session-fork-from-message/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
