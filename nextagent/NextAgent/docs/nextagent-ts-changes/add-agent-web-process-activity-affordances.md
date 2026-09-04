# add-agent-web-process-activity-affordances

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P2

状态：ready（已认领）
类型：implementation change
主要 owner：`frontend/agent-web` process presentation
认领人：当前 Change1 交付
依赖：已归档的 `establish-conversation-process-history-continuity`

当前状态：
- Process Panel 已有 panel-level auto-collapse、per-entry manual expand/collapse、idle sweep 和 reduced-motion handling。
- per-entry terminal auto-collapse 已进入稳定基线；缺口收窄为当前 running entry 高亮、新条目 fade-in 和 scroll-to-active。
- 真实交互复审确认，既有 800ms 条目 settle delay 会在下一步骤已开始输出后再次改变页面高度；完成面板重开时全部 detail 展开也会放大长流程的视觉跳动。
- 长答案折叠属于 assistant message behavior；parallel batch metadata 需要 backend/Web contract；两者不属于本卡 owner。

目标：
- 在统一的 live/history process presentation model 上补齐 B12/B13/B14 的活动提示，并在既有 shared disclosure hook 内 refinement B11 的视觉交接时序，同时保留用户手动控制和 accessibility。

规格输入：
- live 与 history 必须从同一 presentation model 得到 activity/terminal 语义；history 不重放 transient animation。
- entry 进入 terminal 后的无延迟自动交接、用户手动 override、完成后目录式重开和后续 run reset 必须在 OpenSpec 中固定为一条状态路径。
- running highlight、fade-in 和 scroll-to-active 必须尊重 reduced-motion、用户手动滚动、当前 viewport anchor 和手动展开覆盖。
- auto-scroll 只能跟随当前活动 entry；用户主动离开底部后暂停并提供可恢复入口，不抢夺焦点。

契约输入：
- 只消费 process history continuity 的 canonical frontend presentation model；不新增 runtime event、RunStatus 或 backend batch metadata。

实现约束：
- 一个 change 拥有 `ProcessPanel`/相关 process presentation activity state，避免 B11-B14 多分支争夺同一组件。
- 动画只是状态呈现，不新增业务状态或 timeline event。
- 不顺带修改 long-answer、parallel batch、degradation field policy 或 todo formatter。

非目标：
- 不修改 runtime lifecycle、thinking persistence、tool execution 或 canonical RunStatus。
- 不实现通用 Tool Presentation Policy。

验收要点：
- component/integration tests 覆盖 terminal auto-collapse、manual override、next-run reset、running highlight、fade-in、scroll pause/resume 和 reduced motion。
- history tests 证明没有 transient animation replay，内容与 live settled state 等价。
- frontend build 和相关 browser journey tests 通过。

并行边界：
- process history continuity 已合入并归档，依赖门禁已释放。
- 实施期间独占 `ProcessPanel` 和 process activity view-state 的相关改动面；不得与 long-answer 或 batch projection 合并。

重新准入结论（2026-07-28）：
- `ready`：依赖已归档，目标、owner、最小增量路径与验收出口唯一。
- B11 refinement 只替换既有浏览器 disclosure delay 与完成后重开默认布局，继续复用同一个 hook 和 presentation model；不建立第二套 lifecycle。
- B12/B13/B14 与该 bounded refinement 共同修改 `ProcessPanel`、disclosure 和既有 viewport 接入，作为一个 change 可避免同一组件的并行 ownership 冲突。
- 不新增 `agent-contracts`、stream event、Message/Event、runtime、channel、persistence、stage-note 或 Provider 输出分类。
