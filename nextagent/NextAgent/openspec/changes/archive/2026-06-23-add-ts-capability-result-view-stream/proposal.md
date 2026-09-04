## 背景与问题（Why）

当前 Web 执行详情面板接收的 `CAPABILITY_RESULT_DELTA` 中，`text`/`content` 由 `safeSummary` 或通用 fallback 文本 `Capability result is available.` 合成。Runtime 已经在 `inlinePayload.result` 中持有结构化 capability result，但 Web stream projection 没有暴露一个字段语义清晰的 safe、bounded 结果投影。因此 UI 无法解释 tool 返回了什么，除非把通用占位文本当作内容，或者解析原始 capability payload。

## 变更范围（What Changes）

- 规范化 `agent-channel-web` 中 `CAPABILITY_RESULT_DELTA.payload` 的语义：
  - `safeResult`：channel 拥有的、allowlisted、bounded 结构化结果投影。
  - `safeSummary`：由上游 `safeSummary` 或 `safeResult` 派生的简短 safe 摘要，忽略通用占位文本。
  - `text`/`content`：可用时为 safe 详情文本，否则为空字符串；绝不为通用技术占位文本。
- 从 Web 可见的 capability result 与 completion 事件投影 safe 的 capability 失败字段，包括 `safeErrorCode`、`safeErrorCategory`、`status`，以及可用时具体的 safe 摘要。
- `safeResult` 只从 allowlisted 结果字段派生，不来自原始 tool 参数、隐藏的 assistant tool-use message、runtime id 或任意 metadata。
- 支持初始的内置结果 shape：命令输出、文件读取、文件列表、文件写入操作状态和 Skill 加载结果。
- 把原始 `structuredPayload`、命令/代码参数、`toolCallId`、`eventId`、runtime id 和任意 metadata 排除在普通用户可见详情之外。
- 前端执行详情先从 `safeResult` 渲染，回退到 `safeSummary`，在没有结构化投影时再回退到 safe 的 `text`/`content`。
- 当 `offset`/`limit`/`nextOffset` 可用时，把文件读取结果渲染为人类可读的选中行范围与续读提示，而不是把这些字段名当作 UI 文本暴露。
- 把形如 `CODE: message` 的命令 stderr 渲染为代码与 safe message 分离的详情，使摘要保持用户可读，且 policy 拦截不会看起来像普通命令完成。
- 用用户可读的失败原因作为摘要渲染失败的历史 capability result，同时把 error code/category/status 保留在二级详情中。
- 当历史回放包含真实 timeline 支撑的 process 事件时，刷新后保持执行详情与全流程入口一致。
- 只有当 terminal content 是真实的 assistant 输出时，才在历史重载后保留失败 turn 的部分回答内容；当它是诸如 `Request failed safely: CODE` 之类的 safe failure 占位文本时绝不应保留。
- 执行详情面板的展开/收起使用测得的 height、opacity 和 clipped overflow 做动画，使流式回答内容在过渡期间不会在视觉上与执行详情重叠。
- 对聊天视口和侧边栏 session 列表使用同一套主题化滚动条样式，包括暗色模式的 gutter/track 颜色。
- 把侧边栏 session 列表的展开/收起偏好持久化到 sessionStorage，并在同一浏览器 tab 内跨 mount、request 控制和 stream 恢复刷新保持当前 session 列表数据窗口一致。
- 在浏览器 tab 存活期间按 session 缓存 normal 模式的 composer 草稿，使切换 session 后返回时能恢复该 session 未发送的输入，而不做长期持久化。

## 影响范围（Impact）

- `agent-channel-web`：把 bounded capability result 数据投影到 live stream envelope 中，具有显式的 `safeResult`/`safeSummary`/`text` 语义。
- `agent-web`：从 safe 投影渲染 capability result 摘要和二级详情，同时保证通用 fallback 文本和 safe failure 占位文本不产生误导。
- `agent-web`：在刷新或 session 导航时保持 session 列表滚动条样式、session 列表展开状态和未发送 composer 草稿稳定，因为这些属于本地 UI 关注点。
- 测试：stream projection、前端 process-detail 投影覆盖，以及本地 UI 状态/session 列表刷新窗口覆盖。
