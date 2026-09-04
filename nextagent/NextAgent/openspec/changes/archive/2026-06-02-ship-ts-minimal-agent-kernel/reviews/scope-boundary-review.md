## 范围边界检视（Scope Boundary Review）

Change：`ship-ts-minimal-agent-kernel`

### real

- Web submit/session/create/history/SSE 路由表。
- Runtime request acceptance、assembly 绑定、单 active run guard、canonical timeline、terminal commit。
- Agent core 直接回答路径、context render、model invocation、read tool loop、message 持久化。
- OpenAI model adapter 工厂和 stream 归一化路径。
- Owner-scoped session/message/run/timeline gateway 访问。

### minimal

- 用于可重复内核验证的内存 local gateway。
- Context render 窗口和电信术语保留指令。
- Read capability catalog 和 workspace 相对路径的有界文件切片。
- 从 runtime timeline 投影 SSE，不拥有 WebSocket/replay。

### noop

- 产品 audit writer 是显式 no-op provider。
- Checkpoint/recovery 在本 change 中仍只由 contract 兼容的 gateway 面承载。

### deferred

- 超出 public 空 `attachments?: []` 的附件。
- Memory、多 provider fallback、多 tool 来源、Skill source、WebSocket。
- 完整 cancel/retry/edit、输出 continuation、terminal retry/takeover 和多实例 recovery。

检视结论：最小内核路径中没有 deferred 能力被暴露为产品路由或启用的 capability。
