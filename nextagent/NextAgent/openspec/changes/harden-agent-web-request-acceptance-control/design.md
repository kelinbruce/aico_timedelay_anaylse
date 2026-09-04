## 当前实现基线（Current Baseline）

- `requestStore` 负责 submit、带附件 submit、retry、edit、cancel 和 stream terminal settlement，但 foreground status、pending identity 和 active root 使用单一全局槽位。
- `requestService` 的 action HTTP 没有 action-local timeout；HTTP 永不返回时 browser request control 可以无限等待。
- `MessageInput` 和 composer controller 有各自交互条件，但 store owner 没有覆盖全部入口的同 session single-flight gate。
- 现有 live-run identity recovery 分别保存 canonical request/run/context，并规定 HTTP identity 未确认前的 stream candidate 不能成为 action control truth。本 change 复用该不变量，不重写 identity binding。
- 现有 session/conversation snapshot 和 activeRun bootstrap 可以恢复 canonical presentation，无需新增 API。

## 目标设计（Proposed Design）

### Owner 与唯一调用路径

`frontend/agent-web/src/state/requestStore.ts` 是唯一 foreground request-control owner。固定路径为：

```text
composer or direct action
  -> requestStore same-session gate
  -> action-local 90s AbortController
  -> existing requestService HTTP
  -> HTTP acceptance or one snapshot recovery
  -> owning SessionRequestState
```

组件只投影当前 route session 的 tracker 并提供交互反馈，不拥有 request lifecycle。`useChatSessionStream` 只把 canonical stream acceptance/terminal 路由给 owning session tracker。

### SessionRequestState

`requestStore` 使用 frontend-private `sessionId -> SessionRequestState` 映射。每个 entry 保存：

- status：`submitting | accepted | retrying | editing | canceling | confirmation-timeout | idle`；
- 当前 pending canonical identity 和 active root；
- action generation、acceptance timeout controller 和 snapshot-recovery-used 标记；
- 当前 session 的 safe request notice。

所有 action、HTTP continuation、stream acceptance、terminal、activeRun hydration、manual reload resolution 和 Stop/Cancel 都显式携带 `sessionId`。terminal 或已确认无 active run 的 reload 后回到 idle；无 pending、active root 和 notice 的 idle entry 删除。

### Acceptance timeout

submit、带附件 submit、retry 和 edit 分别创建 action-local `AbortController`，固定常量 `REQUEST_ACCEPTANCE_TIMEOUT_MS = 90_000`。signal 只传入本次 action HTTP，不成为 `apiClient` 全局默认值。

timeout 后按固定顺序处理：

1. 只 abort 浏览器 HTTP wait，不重发、不判断 backend 失败。
2. 清除未经 HTTP 确认的 action control candidate；已投影的 canonical stream bucket保持不变。
3. 对该 action 最多调用一次既有 session/conversation snapshot recovery。
4. snapshot 有 activeRun 时恢复该 session accepted control；snapshot 已有 terminal history且无 activeRun 时回到 idle；失败或无法确认时进入 `confirmation-timeout` 并显示安全 notice。
5. matching terminal、canonical snapshot 或手工 reload 结果可以解除 uncertainty；late HTTP completion 和 duplicate terminal 是 no-op。

### 同 session single-flight

当 owning session entry 处于 `submitting`、`accepted`、`retrying`、`editing`、`canceling` 或 `confirmation-timeout` 时，requestStore 拒绝新的 submit/retry/edit，且不得创建 optimistic Turn。`MessageInput`、Enter、slash command、建议问题和 controller direct send 同时使用当前 session gate，但 store action 是最终正确性边界。草稿仍可编辑和保存。

不同 session 的 tracker 独立，因此 session B 可以在 session A 执行时提交；两者的 HTTP continuation、terminal settlement 和 Stop/Cancel target 不互相覆盖。

## 失败与降级

- timeout snapshot 失败或无 canonical truth：进入非 terminal 的 `confirmation-timeout`，保留手工 reload。
- provider/transport 普通失败：沿用现有 safe error，不记录 raw response、query、token、路径或 owner scope。
- session 切换：只改变当前 selector，不清除其他活动 tracker。
- component gate 被绕过：store owner 拒绝 action，保证无第二次 HTTP side effect。

## 质量属性与验证

- 安全：不新增信任来源；timeout 不制造 runtime truth；按 session 隔离 control identity。
- 容量：map 只保留活动或有 notice 的 entry；每个 timed-out action最多一次 snapshot。
- 可靠性：fake timer 固定 90 秒边界；late completion、duplicate terminal 和 session switch 均幂等。
- 可测试性：使用 deferred HTTP、fake clock 和不同 session/request/run fixture 验证黑盒 action 次数、可见 status 与 Stop target。

## 风险与取舍

- 合法 acceptance 超过 90 秒时会进入恢复；这是 browser wait budget，不是 backend timeout，且不会自动重发。
- session map 增加状态数量；通过 idle cleanup 保持页面运行期有界。
- 多入口 gate 可能重复交互判断；store gate 是唯一 correctness owner，组件判断仅改善反馈。

## 归档前更新基线

归档前将稳定行为同步到 proposal 列出的 stable spec 和 Agent Web module design；不新增 ADR，不修改 public contract。
