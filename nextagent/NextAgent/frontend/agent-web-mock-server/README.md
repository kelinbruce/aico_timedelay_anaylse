# agent-web mock-server

`agent-web-mock-server` 是 `../agent-web` 的本地契约 mock 服务。它用于帮助前端在不启动 TypeScript 后端 packages 的情况下，验证当前基于 `StreamEnvelope` 的 Web Channel 契约。

这个 mock-server 的目标是契约联调，而不是模拟一个完整后端。默认流式回复会让 `LLM_CONTENT_DELTA` 使用累计快照，确保 replay、重连和前端合并逻辑尽量贴近当前后端契约。`append-token` 这类兼容性行为只在单次请求中显式开启。

## 启动方式

以下路径均以本 README 所在目录为基准。

推荐的前端 + mock-server 启动方式：

```powershell
cd ../agent-web
npm run dev:mock
```

只启动 mock-server：

```powershell
npm start
```

也可以从 `../agent-web` 启动 mock-server：

```powershell
cd ../agent-web
npm run mock
```

mock-server 监听 `http://localhost:3001`。前端 mock mode 会把 `/api` 代理到这个服务。不要用 `npm run dev` 做 mock-server 手测；该模式会读取 `../agent-web/.env.backend` 并指向真实后端地址。

## 默认行为

普通输入默认使用 `contract-suite` 计划，包含：

- request 和 session 生命周期事件
- 可见思考 / 执行详情事件
- capability result delta
- 较长的 Markdown 助手回复
- Markdown 表格、代码块、Mermaid、中文和英文段落
- 终态 `REQUEST_COMPLETED`

默认助手正文 delta 是累计快照：

```text
event 1 text = "A"
event 2 text = "AB"
event 3 text = "ABC"
```

默认使用累计快照，是因为它匹配当前前端契约预期，并让 replay 不依赖补齐每一个历史 delta frame。

## Stream replay 与过滤参数

SSE 与 WebSocket stream 都支持这些查询参数：

| 参数 | 含义 |
| --- | --- |
| `lastSeenSequence` | session 级递增 cursor。mock-server 只回放 `sequence > lastSeenSequence` 的事件。 |
| `requestId` | 可选过滤条件，只回放该 request 的事件。 |
| `runId` | 可选过滤条件，只回放该 run / attempt 的事件。 |

前端主路径应使用未过滤的 session 级长连接：

```text
GET /api/v1/sessions/session-1/stream?lastSeenSequence=42
```

`lastSeenSequence` 来自当前页面生命周期内已经收到的最大 timeline-backed `StreamEnvelope.sequence`，只用于同一页面内断线重连。刷新页面、新 tab 或新设备打开会话时，前端不读取持久化 cursor；它先读取 conversation bootstrap，如果存在 `activeRun`，再使用 `activeRun.requestId`、`activeRun.runId` 和 `lastSeenSequence=0` 打开 run-scoped stream。`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED` 或 `REQUEST_SUPERSEDED` 只表示某次 request/run 终态，不表示未过滤的 session stream 必须关闭；如果服务端主动断开，同一页面内前端应按最新内存 cursor 重连。

`requestId` 和 `runId` 只是过滤条件，不会让 `sequence` 变成 request 级或 run 级。过滤后可能自然跳过其他请求的 sequence，例如回放 `[1, 3]` 而不是 `[1, 2, 3]`；这不是 replay gap。mock-server 只有在未过滤的 session 级 replay 中发现真正的连续性缺口时，才会发送 `DEGRADATION_NOTICE` 提示前端刷新会话快照。

过滤参数同时作用于 replay 和后续 live push。也就是说，同一个 session 可以同时存在一个未过滤连接和一个 `requestId/runId` 过滤连接；mock-server 会只把匹配过滤条件的 live event 推给过滤连接，但不会影响未过滤 session 连接。

示例：

```text
GET /api/v1/sessions/session-1/stream?lastSeenSequence=42&requestId=request-1&runId=run-1
```

## 请求模式

请求模式由 `inputText` 中的关键字选择。它不是全局状态，不需要重启 mock-server。

| 输入关键字 | 模式 | 用途 |
| --- | --- | --- |
| 无关键字 | `contract-suite` | 默认长成功流，覆盖工具过程、长回复和 Markdown 压力内容。 |
| `[mock:capability-presentation ...]` | `capability-presentation` | 在同一轮依次观察成功结果三级投影、四类事实性失败和失败后的真实后续步骤。 |
| `mock:fail` | `failure` | 生成安全失败路径，最终以 `REQUEST_FAILED` 结束。 |
| `mock:pending` | `pending-input` | 生成需要用户补充输入的路径，不会自动完成。 |

注意：`mock:fail` 和 `mock:pending` 要写在普通输入文本里，不要写进 `[mock:...]`。内联 mock 控制会在模式选择前被剥掉。

## 单次请求控制

单次请求控制只影响当前请求，不会修改 mock-server 默认行为，也不需要重启服务。

内联控制格式：

```text
[mock:<control> <control> key=value] 用户输入
```

控制参数之间可以用空格、逗号或分号分隔。

| 内联参数 | 含义 |
| --- | --- |
| `append-token` | 本次请求的助手正文使用 append-token delta。 |
| `append-tokens` | `append-token` 的别名。 |
| `append` | `append-token` 的别名。 |
| `cumulative` | 本次请求的助手正文使用累计快照 delta。 |
| `contract` | `cumulative` 的别名。 |
| `delay=<number>` | 事件间隔，单位 ms。 |
| `delay-ms=<number>` | `delay` 的别名。 |
| `delayms=<number>` | `delay` 的别名。 |
| `terminal-delay=<number>` | 全部 mock 事件发完后，推送终态事件前暂停，单位 ms。 |
| `terminal-delay-ms=<number>` | `terminal-delay` 的别名。 |
| `terminaldelayms=<number>` | `terminal-delay` 的别名。 |
| `idle-pause=<number>` | `terminal-delay` 的别名，用于表达“制造尾部空闲”。 |
| `idle-pause-ms=<number>` | `terminal-delay` 的别名。 |
| `idlepausems=<number>` | `terminal-delay` 的别名。 |
| `pause-after-answer=<number>` | 推送到第 N 个助手正文 delta 后暂停一次。 |
| `pause-after-answer-deltas=<number>` | `pause-after-answer` 的别名。 |
| `pauseafteranswer=<number>` | `pause-after-answer` 的别名。 |
| `pauseafteranswerdeltas=<number>` | `pause-after-answer` 的别名。 |
| `pause-after-process=<number>` | 推送到第 N 个执行详情 detail delta 后暂停一次。 |
| `pause-after-process-deltas=<number>` | `pause-after-process` 的别名。 |
| `pause-after-process-events=<number>` | `pause-after-process` 的别名。 |
| `pauseafterprocess=<number>` | `pause-after-process` 的别名。 |
| `pause=<number>` | 中途暂停时间，单位 ms。 |
| `pause-ms=<number>` | `pause` 的别名。 |
| `pausems=<number>` | `pause` 的别名。 |

`delay` 会被限制在 `0..200` 毫秒，默认值是 `8`。`terminal-delay`、`pause` 会被限制在 `0..10000` 毫秒，默认值是 `0`。`pause-after-answer`、`pause-after-process` 会被限制在 `1..10000`。

自动化测试也可以通过请求体传入控制参数：

```json
{
  "inputText": "检查骨干网络延迟",
  "mockControls": {
    "answerDeltaMode": "cumulative",
    "delayMs": 16,
    "pauseAfterAnswerDeltas": 120,
    "pauseAfterProcessDeltas": 180,
    "pauseMs": 4000,
    "terminalDelayMs": 3500
  }
}
```

支持的请求体字段：

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `mockControls.answerDeltaMode` | `"cumulative"` 或 `"append-token"` | 本次请求的助手正文 delta 形态。 |
| `mockControls.delayMs` | number | 事件间隔，单位 ms，会被限制在 `0..200`。 |
| `mockControls.pauseAfterAnswerDeltas` | number | 推送到第 N 个助手正文 delta 后暂停一次，会被限制在 `1..10000`。 |
| `mockControls.pauseAfterProcessDeltas` | number | 推送到第 N 个执行详情 detail delta 后暂停一次，会被限制在 `1..10000`。 |
| `mockControls.pauseMs` | number | 中途暂停时间，单位 ms，会被限制在 `0..10000`。 |
| `mockControls.terminalDelayMs` | number | 终态事件前暂停时间，单位 ms，会被限制在 `0..10000`。 |

如果内联控制和 `mockControls` 同时存在，`mockControls` 优先。

## 正文空闲流光手测

`../agent-web` 的正文流光不是“只要流式中就显示”。当前预期是：

- 还没有助手正文时，显示“正在思考”占位。
- 已有助手正文、请求仍在执行中时，正文正常增量显示，不持续流光。
- 连续约 2.5 秒没有新的非 history stream event 时，最后一段正文、表格末行或代码块尾部显示流光；即使前端仍在露出已经收到的缓冲正文，也可以显示。
- 任意新 stream event 到达或请求进入终态后，正文流光立即消失。
- 用户系统设置为 reduced motion 时，不显示正文流光动画。

用于验证流中空闲流光：

```text
[mock:contract delay=20 pause-after-answer=120 pause-ms=4000] 测试正文流中空闲流光
```

预期表现：

1. 前 120 个助手正文 delta 持续到达时，正文不应该一直流光。
2. mock-server 中途暂停 4 秒时，约 2.5 秒后正文尾部出现流光。
3. 暂停结束后继续推送新的 stream event，正文流光立即消失。
4. 后续流完成并推送 `REQUEST_COMPLETED`，执行详情进入已完成。

用于验证执行详情流中空闲流光：

```text
[mock:contract delay=8 pause-after-process=180 pause-ms=8000] 测试执行详情流中空闲流光
```

预期表现：

1. `pause-after-process` 只计数会让执行详情 detail 增长的 `LLM_THINKING_DELTA` 和 `CAPABILITY_RESULT_DELTA`。
2. 前 180 个执行详情 detail delta 持续到达时，执行详情不应该一直流光。
3. mock-server 中途暂停 8 秒时，约 2.5 秒后执行详情最后一条 detail 出现流光。
4. 暂停结束后继续推送新的 stream event，执行详情流光立即消失。

用于验证尾部终态前空闲流光：

```text
[mock:contract delay=4 terminal-delay=3500] 测试正文空闲流光
```

预期表现：

1. 长正文持续增长时，正文不应该一直流光。
2. mock 事件发完但终态还没到达时，约 2.5 秒后正文尾部出现流光。
3. `terminal-delay` 到期后推送 `REQUEST_COMPLETED`，执行详情进入已完成，正文流光消失。

用于验证 append-token 兼容流的流中空闲：

```text
[mock:append-token delay=1 pause-after-answer=120 pause-ms=4000] 测试英文 token 流中空闲
```

这个例子会保留类似 `" this"`、`" is"`、`" for"`、`" test"` 的英文 token cadence，同时在正文推送中途制造一段可观察空闲。

## 执行说明交接手测

用于观察“第一轮执行完成 → 输出执行说明 → 继续第二轮执行 → 输出最终答案”的交接：

```text
[mock:process-handoff delay=30 terminal-delay=2500] 检查骨干网络延迟
```

预期表现：

1. 第一段思考完成并开始第一个工具时，第一段思考自动折叠。
2. 第一个工具完成后出现执行说明，执行详情面板仍保持展开，不得提前进入已完成折叠状态。
3. 执行说明之后，第二段思考和第二个工具仍能继续显示；前一条已完成步骤按交接规则折叠。
4. 用户仍跟随会话底部且没有手工保持展开时，最终答案输出完成并收到 `REQUEST_COMPLETED` 后，整个执行详情面板自动折叠。
5. 用户已经离开底部阅读过程，或手工保持步骤展开时，终态不得强制折叠并抢走阅读焦点。
6. 手工重新展开已完成的执行详情后，两轮思考和两个工具步骤仍然存在。

该用例只使用现有 `LLM_CONTENT_DELTA`、思考和能力事件，不新增 mock 专用的阶段说明或最终答案协议字段。

## 工具结果三级投影手测

用于观察本地页面对后端已治理 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 投影的黑盒呈现：

```text
[mock:capability-presentation delay=200 terminal-delay=3000] 验证工具结果展示策略
```

预期表现：

1. `CustomNetworkProbe` 只显示工具身份和完成状态，不显示“暂无可展示摘要”、其他摘要或详情入口。
2. 第一个 `Read` 使用语言中立 code/args，并按当前界面语言显示文件读取摘要；不显示 `safeResult` 或文件正文。
3. `Rag` fixture 显式使用 `SUMMARY` 显示召回数量，不展示原始正文或内部来源；这不是当前内置默认档位。
4. 第一个 `Bash` 显示安全摘要并提供可展开详情；详情包含完整的有界链路结果，不显示截断标记。
5. 第二个 `Bash` 专门展示长输出容量保护；详情只包含有界预览和明确的截断标记。
6. `Write` 失败只陈述“修改前需要完整读取最新内容”的事实；`Agent` 失败只陈述当前环境不支持该能力，不承诺重试、恢复或后续动作。
7. `CustomConflictProbe` 用 `CONFLICT` 类别显示状态冲突事实，即使携带未知 code 也不能显示上游错误文案；`CustomUnknownProbe` 使用通用失败事实。
8. 四个失败步骤的主原因始终可见且各只有一次；技术详情默认收起，展开后最多显示安全 code、category 和本地化调用状态。
9. 四个失败之后出现第二个真实 `Read` 成功步骤，证明后续动作作为独立新事实呈现，而不是写进旧失败卡片。
10. 页面和浏览器网络响应中不得出现 `SECRET-CAPABILITY-RESULT-MUST-NOT-LEAK`、raw credential、完整原始输出、Event type 或上游建议文案。
11. 最终答案出现后刷新当前会话，十个步骤的结果级别、失败原因、技术详情与后续步骤时序保持一致。

该场景只生成既有 public StreamEnvelope，验证 Agent Web 如何消费已治理投影；它不在 mock-server 内重复实现后端配置匹配或安全 projector。

## PIU 过程 Detail 折叠手测

用于观察过程 Detail 包含 PIU 时的自动折叠和用户主动 disclosure：

```text
[mock:piu-process-detail delay=120 pause-after-process=3 pause-ms=5000 terminal-delay=10000] 检查骨干网络延迟
```

预期表现：

1. 思考完成后出现“骨干网络链路诊断”步骤，Detail 中显示开发环境专用的网络诊断 PIU 卡片，包含时延、丢包率、状态和“记录一次本地检查”按钮。
2. PIU Detail 保持 5 秒，便于确认其处于展开状态。
3. 随后答案开始输出，该步骤自动收起，但执行详情面板保持打开。
4. 在自动收起前点击“记录一次本地检查”，确认卡片内计数增加；点击“骨干网络链路诊断”重新展开后，计数若归零，表示 PIU 已卸载并重新挂载。
5. 用户手工展开后，后续终态不得覆盖该手工状态。
6. 再次点击步骤手工收起时，卡片应保持挂载但不可见、不可交互；重新展开后计数仍保持不变。
7. `networkDiagnostic completed` 这类纯 lifecycle completion text 不得替换 PIU Detail；答案开始后自动收起再重新展开，计数同样应保持不变。

## PIU 答案区排布手测

用于观察结构化 PIU 与后续模型总结在答案区域中的排布：

```text
[mock:piu-answer delay=120 terminal-delay=10000] 检查骨干网络延迟
```

预期表现：

1. 执行详情中先显示模型思考和网络诊断能力状态。
2. 答案区域依次显示“诊断能力已经返回结构化结果”的前置说明、网络诊断 PIU 卡片和“模型总结”文字。
3. PIU 与总结属于同一答案区域，按照事件顺序纵向排列；总结不得覆盖、替换或折叠 PIU。
4. PIU 不进入执行详情的步骤级 disclosure；收起执行详情不影响答案区 PIU。
5. 点击卡片中的“记录一次本地检查”可以验证 PIU 自身交互状态。

## 手测例子

默认契约流：

```text
检查骨干网络延迟
```

显式指定默认契约流：

```text
[mock:contract] 检查骨干网络延迟
```

累计快照流，事件间隔变慢：

```text
[mock:cumulative delay=16] 检查骨干网络延迟
```

append-token 兼容流：

```text
[mock:append-token] 测试英文 token 推送
```

高频 append-token 压力测试：

```text
[mock:append-token delay=1] 测试 token 高频推送
```

慢速 append-token 肉眼观察：

```text
[mock:append-token delay=40] 测试慢速 token 推送
```

append-token 别名：

```text
[mock:append delay=16] 测试 append 简写
```

```text
[mock:append-tokens delay-ms=16] 测试 append-tokens 简写
```

安全失败路径：

```text
mock:fail 测试模型输出超限
```

安全失败路径，事件间隔变慢：

```text
mock:fail [mock:delay=20] 测试慢速失败流
```

需要补充输入路径：

```text
mock:pending 测试需要人工确认
```

需要补充输入路径，事件间隔变慢：

```text
mock:pending [mock:delay=10] 测试慢速补充输入
```

最快默认累计流压力测试：

```text
[mock:contract delayms=0] 测试最快默认契约流
```

最慢 append-token 流：

```text
[mock:append-token delay=200] 测试最慢 append 流
```

## 自动化例子

创建普通累计契约流：

```json
{
  "inputText": "检查骨干网络延迟",
  "mockControls": {
    "answerDeltaMode": "cumulative",
    "delayMs": 16
  }
}
```

创建 append-token 兼容流：

```json
{
  "inputText": "测试英文 token cadence",
  "mockControls": {
    "answerDeltaMode": "append-token",
    "delayMs": 1
  }
}
```

创建流中空闲流：

```json
{
  "inputText": "测试正文流中空闲流光",
  "mockControls": {
    "answerDeltaMode": "cumulative",
    "delayMs": 20,
    "pauseAfterAnswerDeltas": 120,
    "pauseMs": 4000
  }
}
```

创建终态前空闲流：

```json
{
  "inputText": "测试正文空闲流光",
  "mockControls": {
    "answerDeltaMode": "cumulative",
    "delayMs": 4,
    "terminalDelayMs": 3500
  }
}
```

创建安全失败流：

```json
{
  "inputText": "mock:fail 测试失败终态",
  "mockControls": {
    "delayMs": 20
  }
}
```

## Process-history 压力会话

在 `frontend/agent-web` 运行 `npm run dev:mock`，然后打开：

```text
http://127.0.0.1:5173/#/session/session-process-history-stress-200
```

预置会话 `200轮复杂网络诊断历史` 包含 200 轮已完成对话。每轮包含 3 段完整 think、3 次工具调用和对应的持久化工具结果，可用于验证快速滚动、预览跳转、刷新、会话切换、缓存复用和淘汰后的重新加载。

## 相关实现文件

- `routes/requests.js`：解析内联 `[mock:...]` 控制和请求体 `mockControls`。
- `routes/stream.js`：SSE stream replay、`lastSeenSequence` 和 `requestId` / `runId` 过滤。
- `routes/websocket.js`：WebSocket stream replay、`lastSeenSequence` 和 `requestId` / `runId` 过滤。
- `data/store.js`：内存会话数据、对话快照和 replay buffer。
- `data/events.js`：生成确定性的契约事件计划。
- `data/stream.js`：按计划推送 SSE / WebSocket 事件，并在需要时延迟终态事件。
- `../agent-web/tests`：前端与 mock 契约相关测试。

## 注意事项

- 除非后端契约变化，否则默认流应保持累计快照。
- append-token 模式只是兼容性测试路径，用于模拟后端观测到的 token cadence，例如 `" this"`、`" is"`、`" for"`、`" test"`。
- `pause-after-answer` / `pause-after-process` / `pause` 只暂停推送调度，不改变事件内容或 delta 形态。
- `pause-after-process` 只计数 `LLM_THINKING_DELTA` 和 `CAPABILITY_RESULT_DELTA`，用于制造执行详情 detail 增长中途的空闲窗口。
- `terminal-delay` 只延迟终态事件，不改变前面已经推送的契约事件内容。
- 内联 `[mock:...]` 控制会从用户消息中剥掉，不会作为用户输入正文存储。
- `mockControls` 更适合自动化测试，因为它不会把控制语法混入可见用户文本。
- 新增 mock 行为时，应在 `../agent-web/tests` 中补充聚焦的契约测试。
