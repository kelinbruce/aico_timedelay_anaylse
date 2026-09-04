# add-agent-web-structured-onboarding

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：candidate
类型：product experience change
主要 owner：`frontend/agent-web` welcome experience
认领人：不可认领
依赖：现有 welcome/high-frequency/category question/skill catalog UI

当前状态：
- welcome、high-frequency/category question 和 skill catalog 已有产品路径；本卡只考虑在这些稳定投影之上的首次使用编排，不重建数据源。

目标：
- 在现有欢迎页基础上，为首次使用者提供可跳过、可恢复且与当前 Agent 能力一致的结构化上手引导。

规格输入：
- 进入 ready 前必须确定首次触发条件、完成/跳过状态 owner、按 user/agent/host mode 的隔离方式和重置入口。
- 引导内容必须来自当前可用 skill/question/capability projection，不硬编码不存在的能力。
- 引导不得阻塞熟练用户直接开始对话；失败时降级到现有欢迎页。

契约输入：
- 优先复用现有前端 view state 和已公开 catalog/question API。
- 若完成状态需要跨设备持久化，必须先定义 owner-scoped Web/persistence contract；不得把 trusted identity 放入 local payload。

实现约束：
- 不复制 WelcomeState、SkillSelector 或问题推荐的数据源。
- 三种 host mode 复用同一业务组件，差异只来自可信 host context 和布局。

非目标：
- 不实现营销 tour、管理员配置控制台、遥测画像或权限系统。
- 不在 candidate 状态创建 active OpenSpec change。

验收要点：
- 转为 ready 前给出 first visit、skip、complete、reset、catalog unavailable 和三 host mode 的验收场景。

并行边界：
- candidate 状态不可实施。
- 后续实现只拥有 welcome/onboarding view，不修改 request lifecycle、skill catalog truth 或 host identity。
