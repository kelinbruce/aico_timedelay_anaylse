## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.1 查看会话消息流` | 已交付的 live 过程正文在完成边界原地收敛；缓存未命中时仍由 Message 安全恢复；ordinary Tool result 恢复唯一 durable body owner | `ts-web-sse-ws-transports` | `FN-1.1 查看会话消息流` |

## `FN-1.1 查看会话消息流`

### 目标与规范依据

本设计满足 proposal 中“live 热路径不依赖同一 Message 写入后的立即回读、冷路径保持 Message-first、停止 ordinary Tool result 双写”的目标。浏览器继续只消费 `StreamEnvelope`，SSE 与 WebSocket 继续复用同一安全投影，Message 与 Event 的 durable ownership 不变。

#### 本 Function 的目标 Requirements

canonical spec：`ts-web-sse-ws-transports`

- `MODIFIED`：`Web stream 在服务端解析过程消息引用`

本 change 同时恢复 stable Requirement `可恢复过程事件引用唯一消息正文` 已定义但当前代码未满足的 persisted Event shape；该 Requirement 的目标正文不变，因此不创建重复 delta。

### 当前实现

1. `agent-core` 在 Tool 轮次先追加 `ASSISTANT_TOOL_USE` 或 `CAPABILITY_RESULT` Message，再发布携带 `messageId` 的 completed `LLM_CONTENT_DELTA`、`CAPABILITY_STARTED` 或 `CAPABILITY_COMPLETED`。成功 Tool 路径还在 completion 前发布 live-only `CAPABILITY_RESULT_DELTA`。
2. `projectTimelineEventsToStreamEnvelopes(...)` 对每个引用事件先调用 `resolveProcessMessage`。订阅级 `processMessageCache` 会把成功结果和首次 miss 都缓存；miss 使用 `null` 表示，并在订阅剩余生命周期内不再读取该 `messageId`。
3. `web-stream-delivery.ts` 的 resolver 对一次 `resolveProcessMessages(...)` 返回空集合或非取消异常都返回 `undefined`，没有 read-after-write 可见性保证，也没有 live snapshot 短路。
4. `projectStreamPayload(...)` 在 completed `LLM_CONTENT_DELTA` 无 Message association 时生成空 `content/text`、`contentUnavailable=true` 和 completed metadata。`conversationStore.appendLiveEnvelopes(...)` 按同一 lane 无条件用新 accumulated snapshot 替换旧 snapshot，因此空完成态会覆盖已显示的非空 live 内容。
5. 成功 Tool completion 当前同时把 `result.structuredPayload` 写入 `CAPABILITY_RESULT` Message 和 persisted `CAPABILITY_COMPLETED.inlinePayload.result`。runtime persistence policy 特别允许该 `result`，channel 又优先从 inline result 生成投影，Message association 只作为旧记录回退。该行为与 stable Message-first ownership 及 history projector test 的 Message 权威预期冲突。
6. 现有测试分别覆盖 Message association 成功/失败、inline Tool result 无 association 投影、persisted result 放行、live accumulated snapshot 替换和 cold history 恢复；没有覆盖“非空 live snapshot → Message 暂时不可见 → completed ref”这一组合，也没有禁止新 `CAPABILITY_COMPLETED.result`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 已交付的同 occurrence 安全累计正文直接收敛为 completed | 每个 completed 引用事件都先读取 Message | live 热路径依赖远程 Gateway 的立即 read-after-write，未利用当前订阅已有安全事实 |
| 暂时不可读不得清空已交付正文 | 空 association 被投影为 accumulated 空完成态，frontend 无条件替换 | 暂时性读取结果被解释为正文最终为空 |
| 缓存未命中继续 Message-first 且 fail closed | resolver miss 被永久缓存为 `null` | 同一订阅后续相同 Message 引用没有再次关联机会，瞬时 miss 被扩大为订阅级永久 miss |
| ordinary Tool result 只有一个 durable body owner | `CAPABILITY_RESULT` Message 与 `CAPABILITY_COMPLETED.result` 双写，inline result 优先 | Event 成为第二 durable body owner，Message 不再是唯一投影权威 |
| SSE、WebSocket、frontend 与 history 对完成态一致 | shared projector 输出空完成态，frontend 覆盖非空 live；history 依赖另一读取时机 | active live 与 cold history 可能显示不同正文 |

### 修改方案

主要 owner 保持为 `agent-channel-common` 的 shared stream projection。`agent-core` 和 `agent-runtime` 只移除违反既有持久化契约的 Tool result 副本；`frontend/agent-web` 只增加 active live view-state 的非破坏性保护。不得新增 Gateway port、Web API、runtime event type、公开 DTO 或配置项。

#### 1. 在共享 stream projector 中维护订阅级安全快照

`projectTimelineEventsToStreamEnvelopes(...)` 增加一个最多 1,000 项、订阅关闭即释放的内存缓存。该缓存由 `agent-channel-common` 拥有，不持久化、不记录日志、不进入 Web payload，也不被不同订阅、session 或 run 共享。

私有状态只接受已经由 `projectTimelineEventToStreamEnvelope(...)` 成功生成且正文非空的安全投影：

```ts
type LiveProcessSnapshot =
  | {
      readonly kind: 'LLM_CONTENT';
      readonly sessionId: string;
      readonly requestId: string;
      readonly runId: string;
      readonly rootMessageId: string;
      readonly stepId: string;
      readonly safePayload: JsonObject;
    }
  | {
      readonly kind: 'CAPABILITY_RESULT';
      readonly sessionId: string;
      readonly requestId: string;
      readonly runId: string;
      readonly rootMessageId: string;
      readonly capabilityId: string;
      readonly toolCallId: string;
      readonly safePayload: JsonObject;
    };
```

- 全部字段 required、non-null，string 字段 trim 后必须非空。
- `safePayload` 来自当前订阅即将交付的 allowlisted `StreamEnvelope.payload`，不是 runtime raw payload、Message record 或浏览器输入。
- 同 key 的新 accumulated snapshot 替换旧值；不同 `stepId`、`toolCallId`、turn 或 run 必须形成不同项。
- 达到 1,000 项后沿用现有 subscription cache 的最旧项淘汰方式；不引入时间 TTL、后台清理器或跨连接 cache。
- `OUTPUT_GUARD_BLOCKED` 终止 delivery 后关闭 iterator，缓存随订阅销毁；不得让已拦截正文进入后续 delivery。

#### 2. 使用穷尽决策表选择完成正文来源

| 当前事件 | matching live snapshot | 动作 | Message resolver |
|---|---|---|---|
| completed `LLM_CONTENT_DELTA` | 同 turn/run/root 且同非空 `stepId` 的 `LLM_CONTENT` | 从 snapshot 生成 completed envelope | 不调用 |
| `CAPABILITY_COMPLETED` | 同 turn/run/root、同 `capabilityId` 和同非空 `toolCallId` 的 `CAPABILITY_RESULT` | 从 snapshot 生成 completed envelope | 不调用 |
| 上述两类完成事件 | 不存在、正文为空或任一坐标不一致 | 按 `messageId` 关联 Message | 调用 |
| `CAPABILITY_STARTED` | 任意 | 保持 Message association | 调用 |
| 其他事件 | 任意 | 保持现有投影 | 不新增调用 |

completion envelope 的 outer identity、sequence、timeline reference、status、duration 和 safe failure fields 必须来自完成事件；正文、safe result fields、`resultPresentationLevel` 与 content type 只从 matching snapshot 的 `safePayload` 继承。LLM completion 设置现有 accumulated/completed metadata；Capability completion 使用现有安全 result projection shape。该合并只存在于 delivery 内存，不修改 `RunTimelineEvent`，也不构造伪 Message association。

所有复用后的 envelope 继续经过既有 output guard、watermark、terminal suppression 和 transport serialization。禁止从 pre-projection runtime payload 或 Event inline body创建 snapshot，避免绕过 Capability result presentation policy、redaction 或 managed projector。

#### 3. Message association 只缓存成功结果

保留最多 1,000 条的 `processMessageCache`，但只写入成功解析并通过坐标校验的 Message。resolver 返回空或非取消读取失败时，本事件按既有 `contentUnavailable` fail-closed；不得把该 miss 作为订阅剩余生命周期的永久 `null` 命中。该调整不增加单事件重试、等待阈值或 Gateway contract，只避免一次瞬时 miss 阻止后续独立引用事件再次尝试。

缓存未命中场景继续使用 `RuntimeSessionPort.resolveProcessMessages(...)` 并执行 Owner Scope、Agent Scope、session、request、run、Message type 和 `toolCallId` 校验。history route 不使用 live snapshot cache，仍批量从 Message 恢复正文；浏览器不得使用 settled/history cache补齐关联失败。

#### 4. 移除 ordinary Tool result 的第二 durable body owner

- `agent-core` 成功 Tool 路径继续先写 `CAPABILITY_RESULT` Message、发布 live-only `CAPABILITY_RESULT_DELTA`，再发布 ref-only `CAPABILITY_COMPLETED`；从 completed inline payload 删除 `result`。
- `agent-runtime` persistence policy 恢复把 `result` 视为 recoverable body；新的 persisted `CAPABILITY_COMPLETED` 携带 `result` 时必须在 append/publish 前失败。
- `agent-channel-common` 删除 completed inline result 优先分支。cache miss 时只从有效 `CAPABILITY_RESULT` Message 生成安全结果；Event 内已有 `result` 不作为正文来源。
- `resultProjectionKind` 等既有 closed non-content classifier 保持允许，Workflow completed product 的 Event-owned 规则保持不变。

已存在的双写 rows 不做数据库迁移。新 projector 忽略其 result 副本并按 `messageId` 读取同次写入的 Message；若 Message 暂时或永久不可读，history 继续显式 `contentUnavailable`，不得重新启用 Event body fallback。

#### 5. 增加 frontend active lane 的非破坏性保护

`conversationStore.appendLiveEnvelopes(...)` 在且仅在 active live bucket 中处理同 lane replacement：旧 accumulated snapshot 正文非空，而新 completed snapshot 为 `contentUnavailable=true` 且 `content/text` 为空时，保留旧正文并合并完成 envelope 的 identity/status metadata。该保护不访问隐藏 Message、不生成 history envelope、不跨 `sessionId + rootMessageId + attemptId + eventType + stepId` lane，也不适用于 output guard terminal。

共享 projector 是主修复，frontend 保护用于防止代理、旧 server 或传输边界再次发送破坏性空完成态。history hydration 与 settled cold cache继续只接受服务端安全投影，不从 active browser cache 回填。

#### 6. 保留边界与明确不修改项

- `agent-runtime` 继续拥有 timeline append-before-publish 与 request lifecycle。
- `agent-context-engine` 和模型上下文继续只消费 Message，不读取 timeline 或 frontend state。
- Gateway contract、远程数据库一致性级别和 Message schema 不变。
- `CAPABILITY_STARTED` 没有可复用的先前安全 Tool-use snapshot，继续读取 Message。
- final Assistant answer、thinking completed snapshot、Workflow product、fork snapshot 和 conversation REST shape 不变。
- 不增加 sleep、轮询、固定 backoff 或用户可配置重试次数。

#### 质量属性影响

本次 delta 的规范依据是功能性 Requirement `Web stream 在服务端解析过程消息引用`，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；沿用 `ts-stream-history-consistency` 的 Message-first recovery | live snapshot 原地收敛、miss 不永久缓存、cache miss 保持 Message fallback | 延迟可见、连接中途加入、刷新/history、同 Message 后续引用 |
| 安全 | 无新增黑盒质量目标；沿用 stable `过程消息引用保持作用域隔离` | 仅缓存已安全投影内容、精确 occurrence key、订阅隔离、无 Event body fallback | 跨 step/run/tool 负例、output guard、未知/损坏 inline result |
| 性能/容量 | 无新增黑盒质量目标 | live 命中减少一次远程 read；两个订阅 cache 均至多 1,000 项 | 长流淘汰、无跨订阅增长、cache miss 请求数有界 |

#### 备选方案（Alternatives Considered）

1. **只改 frontend，忽略空 completed 内容**：能够遮挡当前页面症状，但 server 仍执行失败的 read-after-write，SSE/WS 非浏览器 consumer 仍收到错误空投影，且不能清理 Tool result 双写。因此不采用为主方案，只保留 frontend defense-in-depth。
2. **为每个完成引用增加固定重试/backoff**：能缓解部分 eventual consistency，但增加每个 Tool step 的延迟和远程负载，且无法给出适用于全部 Gateway 的稳定时间阈值。因此本 change 不引入轮询；已有 live snapshot 的热路径直接免读，cache miss 继续显式降级并允许后续独立读取。
3. **继续把正文复制到 persisted Event**：会固化两个 durable body owner，并使 Message/ Event 的安全投影和历史演进可能分叉，直接违反稳定架构，因此移除。

## 验证策略（Verification Strategy）

- characterization/contract：构造真实事件顺序，断言 non-empty live content/result 后的 completed ref 在 resolver 不可见时仍保留正文、完成状态和 transport equivalence，并断言 resolver 未被调用。
- unit：覆盖 snapshot key、同 key latest replacement、不同 step/tool/run miss、1,000 项淘汰、仅成功 Message association 缓存和 inline result 禁止持久化。
- integration：覆盖 Agent Core 的 `Message → live result delta → ref-only completion` 顺序，以及 shared delivery 对成功/失败 resolver 的选择。
- frontend：覆盖同 lane 空 completed 不覆盖 non-empty active snapshot、跨 lane 不复用、history/settled bucket 不从 active cache backfill 和 output guard 清理。
- history regression：刷新、重连、晚加入与 run event history 继续从 Message 恢复相同 safe result；既有 inline result 不优先于 Message，也不作为缺失 Message 的 fallback。
- architecture/semantic review：确认 channel 只拥有 transient projection state、frontend 只拥有 view state、runtime/core 不转移 lifecycle 或 persistence ownership，且没有新增 `agent-contracts` 变化。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 `Web stream 在服务端解析过程消息引用` 的目标态。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：更新描述、处理过程、结果及“活跃流完成收敛”规格。
- `openspec/designs/features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.1-实时查看处理过程.md`：更新 live 完成边界连续性保证，并移除与 Event result 副本一致的任何表述。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-process-history.md`：补充订阅级安全 snapshot 收敛、cache miss Message fallback 和 ref-only Tool completion。
- `openspec/designs/modules/agent-channel-web.md`：补充 shared channel transient projection cache 与非 ownership 边界。
- `openspec/designs/modules/agent-web.md`：补充 active lane 非破坏性完成合并边界。
- `openspec/designs/modules/agent-core.md`：确认 Tool completion 只发布 Message reference 与非正文 lifecycle fields。
- `openspec/designs/modules/agent-runtime.md`：确认 persistence policy 拒绝 ordinary completion result body。
- `openspec/designs/adr/`：无；该变更恢复既有 Message-first 决策，不新增独立长期取舍。
- `openspec/designs/spec-to-design-map.md`：更新 `ts-web-sse-ws-transports` 的设计摘要和验证入口。

## 风险与取舍（Risks / Trade-offs）

- 当前订阅未观察到 live snapshot 时仍可能在 Message 暂时不可读的窗口得到 `contentUnavailable`。这是 fail-closed 边界；本 change 不用无依据的等待阈值换取不确定恢复。
- snapshot key 错误可能串联不同 model step 或并行 Tool。通过穷尽事件类型、全部 turn/run/root 坐标和 `stepId`/`toolCallId` 负例约束。
- 缓存的是安全投影而非 raw result，后续 presentation policy 变化不会在同一订阅内重新放宽已经交付的内容；cold history 始终按当前 Message projector 重新计算。
- 已有 Event rows 仍物理包含 result 副本，但新读取不使用它。立即清理数据库会扩大风险且没有必要，因此只停止新写并在逻辑上恢复单一 owner。

## 迁移与回滚（Migration / Rollback）

发布不需要 schema migration。实施必须以同一版本同时交付 Tool completion ref-only producer、收紧的 persistence policy、shared projector snapshot 收敛和 frontend 保护，避免只删除 inline result 而尚未具备 live 收敛。

新版本读取旧双写 Event 时忽略 inline result 并使用其 `messageId`；旧版本读取新 ref-only Event 时沿用原有 Message association fallback，因此 wire/event shape 保持向后可读。若验证发现跨 occurrence 复用、output guard 绕过或正文越权，必须整体回滚应用版本；回滚不需要恢复数据库，Message 事实和旧/新 ref-only Event 均保留。

## 待确认问题（Open Questions）

无。
