# add-agent-web-long-answer-collapse

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：product experience candidate
主要 owner：`frontend/agent-web` assistant message presentation
认领人：不可认领
依赖：既有 assistant Markdown/history rendering

当前状态：
- assistant 长答案可完整渲染、复制和搜索，但没有自动折叠。
- Process Panel 的 entry 折叠与 assistant message 折叠是不同 owner 和生命周期。

目标：
- 对超长 assistant answer 提供可访问、可逆的折叠呈现，避免长报告占满会话视口。

进入 `ready` 前必须确认：
- 唯一折叠阈值使用字符数、渲染高度还是行数，以及代码块/表格/structured segment 如何计量。
- 默认折叠范围、展开后是否在当前 tab/session 保持、history reload 是否重新折叠。
- 折叠后复制、浏览器查找、锚点跳转、screen reader 和键盘操作语义。
- streaming 中何时允许判断超长，避免内容增长导致布局反复跳变。

实现约束：
- 只拥有 assistant message presentation，不修改 Process Panel、runtime、message persistence 或 context truncation。
- 完整 answer content 仍是 canonical；折叠只是 local view state。

并行边界：
- clarify 状态不可实施。
- 不与 `add-agent-web-process-activity-affordances` 合并。
