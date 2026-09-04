# agent-web-auth-control

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
OpenSpec 归档：[`2026-06-29-agent-web-auth-control`](../../openspec/changes/archive/2026-06-29-agent-web-auth-control)
所属分组：AgentWeb 前端

状态：complete
类型：implementation
主要 owner：`agent-web`
协作 owner：`agent-channel-web`
依赖：`add-agent-web-multi-host-modes`

目标：
- 前端宿主模式基于 trusted `HostSiteContext` ops 做权限控制。
- 区分只读和读写用户操作入口，确保 UI 不展示或不触发未授权操作。

规格输入：
- Host-provided ops are trusted only from the host/prelude boundary selected by the current host mode.
- AgentWeb MUST derive visible and enabled operations from ops permissions.
- Read-only mode MUST suppress write actions and prevent write command submission from UI entry points.
- Permission denial must be represented as safe UI state, not by leaking backend error details.

契约输入：
- 复用 multi-host mode 的 host context and prelude boundary。
- 不修改 backend auth identity、owner scope、runtime lifecycle or session contracts。

实现约束：
- `agent-web` owns UI gating and interaction affordances.
- `agent-channel-web` only projects bootstrap/host context facts needed by the frontend; it does not own frontend operation policy.
- UI gating must not be treated as backend authorization substitute.

非目标：
- 不新增后端 RBAC model。
- 不改变 Web API、stream event、runtime command 或 gateway persistence。
- 不定义 custom operation injection；该能力由 `agent-web-customization` 消费 ops 约束。

验收要点：
- UI tests cover read-only and read-write operation visibility/enabled state。
- Interaction tests cover denied write entry points do not submit write commands。
- Backend boundary tests confirm no runtime/session contract changes。

并行边界：
- `agent-web-customization` consumes ops for custom operation visibility but does not redefine auth-control semantics。
- Backend authorization remains owned by channel/auth boundary and server-side owner scope checks。
