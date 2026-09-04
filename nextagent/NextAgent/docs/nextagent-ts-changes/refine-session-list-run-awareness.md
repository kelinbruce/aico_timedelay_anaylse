# refine-session-list-run-awareness

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P1

状态：absorbed
类型：implementation change
主要 owner：`frontend/agent-web` session navigation
认领人：不再独立认领
依赖：既有 `ts-run-status-visibility` Web DTO

处置：

- 本卡的“仅消费 session list DTO 显示运行中”路径，已由 [`add-ts-cross-session-activity-awareness`](./add-ts-cross-session-activity-awareness.md) 吸收。
- 新 change 以独立全 scope activity connection、后端进程内派生、终态匹配消费和三宿主共享呈现形成唯一实施路径；本卡以下内容只保留为历史规划输入，不得单独实施。

目标：
- 让用户在会话列表中直接识别仍有请求运行的会话，而不加载 conversation 或复制 runtime truth。

当前状态：
- 后端 session list Web DTO 已投影 `lastRunStatus` 和必填 `hasInFlightRequest`。
- frontend `SessionHistoryEntry`、session adapter 和 `SessionHistoryEntryRow` 尚未消费这两个字段。

规格输入：
- frontend list contract 必须同形接收 `lastRunStatus?` 和 `hasInFlightRequest`；不得重命名、重新解释或为运行态额外请求 conversation。
- API-facing contract 保持 `hasInFlightRequest` 必填；若 runtime defensive read 遇到 malformed/缺失输入，只能抑制运行标识，不得把公开字段改成可选或猜测运行态。
- 运行中标识以 `hasInFlightRequest === true` 为 canonical 判定；已知的非终态 `lastRunStatus` 只用于补充安全、可访问的状态文案，不产生新的前端生命周期。
- `hasInFlightRequest === false` 时必须恢复普通列表项，即使 `lastRunStatus` 是 terminal；首版不显示“已完成/失败”角标，不引入 unread/viewed/自动消失状态。
- in-flight 时 `lastRunStatus` 缺失或未知必须降级为通用“运行中”标识；字段整体缺失则稳定降级为普通列表项，不影响打开、重命名或删除会话。
- 运行态呈现必须有非颜色唯一的 accessibility label，并复用现有运行态 i18n 文案；若确需新增 key，须先与 todo i18n change 协调共享资源文件写入区。

契约输入：
- 只补齐 frontend `SessionHistoryEntry`/API adapter；不修改 channel schema、gateway record、session persistence 或 RunStatus vocabulary。

实现约束：
- 只修改 session list DTO adapter、`SessionHistoryEntryRow` 和定向测试。
- 不使用当前会话的 local stream 状态覆盖其他会话的 canonical list fields。
- 不实现 sidebar preview、favorite 聚合、terminal 完成提醒、未读服务或通知中心。

非目标：
- 不修改 session title/search/fork/share/delete 语义。
- 不读取完整 conversation，不新增 list preview 字段或 session favorite 字段。

验收要点：
- contract/adapter tests 覆盖两个字段的同形映射、可选 `lastRunStatus` 和未知状态。
- component tests 覆盖 in-flight 已知/未知状态、terminal 且非 in-flight 时恢复普通列表项、字段缺失、accessibility 和 hover/menu 行为不回归。
- integration tests 证明列表运行态不会触发 conversation/preview 请求，打开会话继续走既有导航路径。
- `frontend/agent-web` build 和相关 tests 通过。

并行边界：
- 不修改 preview API、conversation annotation、runtime lifecycle、timeline projection、Process Panel 或 terminal truth。
- 与 todo i18n 逻辑无依赖；共享翻译资源按认领约定协调。
