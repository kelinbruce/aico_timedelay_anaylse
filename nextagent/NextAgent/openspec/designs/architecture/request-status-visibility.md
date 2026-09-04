# 请求状态可见性

## 目的

request status visibility 定义 run 状态如何从 runtime-owned facts 投影到 Web/API/stream/read model。它保证用户能看见 queued、running、cancelled、failed、completed、recovery failed 等状态，而 channel 不拥有状态机。

## 事实来源

`RequestRun`、timeline event、terminal commit、pending-input fact 和 session lane facts 是状态 source of truth。Web channel、frontend、SSE 和 WebSocket 只消费 runtime/session projection。

## 状态可见性

- submit accepted 后必须可见 request/run id、attempt 和初始 queued/running 状态。
- same-session lane 中等待执行的 run 必须可见 queued 状态。
- cancel command accepted 后必须投影 cancelling/cancelled 或已 terminal result。
- retry command accepted 后必须产生新的 attempt/run，并按 replacement visibility 更新默认 history。
- recovery failed 必须作为 terminal 状态可见，而不是后台日志。
- pending input、capability result、projection error 必须以 safe envelope 或 public DTO 表达。

## Capability 业务名称来源

过程标题使用一个集中名称解析入口，按固定优先级命中后停止查找：平台固定 `kind + id` 映射、当前 AICOConfig 中当前界面语言的集成名称、当前前端产物中当前界面语言的构建期集成映射、合法技术标识或中性标题降级。平台固定映射覆盖文件、执行、知识/计划、Memory 和能力获取等内置 Tool 身份；Tool value 为完整业务标题，Agent、Skill、Workflow value 只含资源业务名称并由平台固定模板包装。

AICOConfig 集成名称由前端从启动期 AICOConfig snapshot 与当前界面语言派生的 `${kind}:${id} → name` lookup 传入过程 builder 与 `capabilityProcessTitle` resolver，resolver 不直接订阅 store 或 import React hook，保持纯函数可测性。当前语言缺失时继续到下一优先级，不借用另一语言。平台固定映射优先于全部集成名称来源；AICOConfig 中与平台固定身份相同的条目不改变平台名称。名称按纯文本渲染，不解释 HTML 或 Markdown。

历史记录只保存执行身份而非映射名称。当前有效 AICOConfig、前端产物或界面语言变化后，live 与 history 按当前优先级重新渲染标题，不冻结执行时名称。业务名称映射与结果显示策略正交：`STATUS_ONLY`/`SUMMARY`/`DETAIL` 不改变标题身份，业务名称也不改变有效结果级别、平台安全上限或安全投影字段。

## 流投影

状态变化通过 canonical stream envelope 投影。SSE 和 WebSocket 必须保持同一语义、顺序和 replay anchor。channel 不得制造 fake terminal 或在 projection failure 时篡改 runtime fact。

## 历史投影

visible conversation history 只能在 terminal durable-write boundary 成功后更新。retry replacement 后，旧 attempt 输出默认隐藏但保留审计可读事实。

## 跨会话活动投影

`agent-session` 从已提交的 session、RequestRun、pending-input 和 terminal facts 为每个 session 派生唯一 attention state，固定优先级为 `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE`。该投影只观察 canonical facts，不推进 request lifecycle、pending-input timeout 或 terminal commit。

每个 app instance 通过独立的 Session Activity Projection Stream 接收 Owner + Agent scope 的稀疏 snapshot 和 session-keyed delta。`WAITING_FOR_INPUT` 与 `RUNNING` 可在重启后从 durable in-flight facts 恢复；terminal unread 只在同一进程中保留，进程重启不得把历史 completed/failed run 重新标成未读。删除 session 时 activity service 清理内部状态并向 live subscriber 发送 `NONE`，但不承担目录 tombstone 或列表刷新。

终态活动只能在 matching `activityId` 对应的 `observedRunId` 已真实呈现在前台 conversation surface 后消费。打开列表、hover、focus、打开 History、加载分页或仅激活 route 都不消费活动；跨 scope、迟到或旧 run consume 安全失败且不得清除较新状态。

## 验证关注点

- queued/running/cancelled/retry/recovery failed 状态有 API 和 stream contract 测试。
- channel 不直接写 run/session lifecycle。
- retry replacement 默认 history 和 hidden audit access 有 session tests。
- projection failure 使用 safe error，不泄漏 raw runtime/provider detail。
- Session Activity 派生只响应已提交事实，状态优先级、scope 隔离、重启降级和 matching consume 有 contract/session/Web/frontend 测试。
