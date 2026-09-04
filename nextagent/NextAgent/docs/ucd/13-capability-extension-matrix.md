# NextAgent 能力与集成方扩展点矩阵

> 原始数据来自 `00-overview-feature-map.md` 与 `12-integrator-customization-guide.md`。本文档由原 Excel 工作簿转换而来，以便在 Git 中直接审阅和维护。

> 本矩阵同时收录已实现能力与 UCD 目标，用于分析扩展影响，不是当前实现清单或测试验收依据。判断能力是否已交付时，必须回到关联 UCD 文档的状态标记，并核对 owning Stable Spec、当前代码和测试；未明确标为已实现的能力不得由本矩阵推导为已交付。

## 文档范围

- 系统能力清单：42 项。
- 集成方扩展点：40 项。
- 能力与扩展点关系以本文下方逐行矩阵为准；新增或调整能力时不维护易漂移的汇总计数。
- HostMode：`local`、`immersive`、`piu`；“全部”表示三种模式均适用。

## 图例

| 标记 | 含义 |
|---|---|
| ★ | 扩展引入该能力——该能力因扩展点而存在 |
| ● | 扩展直接影响该能力——扩展点改变该能力的呈现或行为 |
| ○ | 扩展间接影响该能力——扩展点产生全局影响或影响上下文 |
| — | 无关系或无数据 |

扩展点状态含义：

- **已实现**：代码已落地并有 spec 承载。
- **UCD 设计建议**：spec 显式 reserved，或属于 UCD 建议补齐项。
- **缺口**：spec 尚未定义，参见 `10-implementation-gap-analysis.md`。

## 系统能力清单

| 编号 | 类别 | 功能 | 用户能做什么 | UI 位置 | 用户价值 | 关联旅程 | 关联规范 | HostMode 适用 | 涉及集成方扩展 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | 1.对话输入与发送 | 提问到答案 | 输入问题、发送、收流式回复 | Composer + 对话区 | 核心对话能力，从提问到答案的完整路径 | 旅程 1 | composer.md, message-bubble.md | 全部 | D2,D4 |
| 1.2 | 1.对话输入与发送 | 附件上传 | 拖拽/粘贴/选择附件发送 | Composer | 多模态输入，支持图片/CSV/文件 | 旅程 2 | composer.md | 全部 | — |
| 1.3 | 1.对话输入与发送 | pending input 应答 | 对 Agent 的确认/授权/问答应答 | 对话区 pending input 卡片 | 高危操作显式授权，Agent 主动交互 | 旅程 3 | pending-input-card.md | 全部 | — |
| 1.4 | 1.对话输入与发送 | 编辑重发 | 修改最近用户消息重发 | 对话区消息气泡 hover | 快速修正，无需重开会话 | 旅程 8 | message-bubble.md | 全部 | — |
| 1.5 | 1.对话输入与发送 | 并行工具调用 | 一次对话触发多个工具并行执行 | 过程面板 | 复杂任务并行处理，缩短等待 | 旅程 27 | process-panel.md, capability-card.md | 全部 | — |
| 1.6 | 1.对话输入与发送 | Skill 选择与使用 | 在 Composer 选择/切换 Skill，触发对应能力 | Composer SkillSelector | 明确意图定向，激活特定 Agent 能力 | 旅程 1 | composer.md, 12-integrator-customization-guide.md | 全部 | E1 |
| 1.7 | 1.对话输入与发送 | 快捷问题入口 | 点击高频问题/分类问题模板快速发送 | Composer 引导区 | 降低输入成本，引导新用户 | 旅程 1 | composer.md, 12-integrator-customization-guide.md | 全部 | E2 |
| 1.8 | 1.对话输入与发送 | 推荐后续问题 | 查看并点击助手推荐的后续问题 | 助手消息气泡底部 | 引导深入对话，降低思考成本 | 旅程 1 | message-bubble.md | 全部 | — |
| 1.9 | 1.对话输入与发送 | Slash 命令 | 输入 / 触发命令面板，高亮选择并补全 | Composer slash 面板 | 快速触发指令，减少输入 | 旅程 1 | composer.md | 全部 | E5 |
| 2.1 | 2.过程查看与控制 | 多轮思考与工具调用 | 查看思考过程、能力调用、中间结果 | 过程面板 | 过程透明，理解 Agent 推理路径 | 旅程 12 | process-panel.md, capability-card.md | 全部 | D3 |
| 2.2 | 2.过程查看与控制 | Run Graph 查看 | 打开 Run Graph 抽屉查看完整执行时间线 | 过程面板 → Run Graph 抽屉 | 复杂流程回溯，调试与审计 | 旅程 19 | process-panel.md | 全部 | D3 |
| 2.3 | 2.过程查看与控制 | 取消与重试 | 取消执行中请求，重试失败请求 | 能力卡片 + 对话区 | 用户主动控制，错误恢复 | 旅程 9, 10 | capability-card.md, message-bubble.md | 全部 | E4 |
| 2.4 | 2.过程查看与控制 | 执行中发新消息（supersede） | 执行中直接发新消息终止旧请求 | Composer | 不等了就发新问题，旧请求被取代 | 旅程 17 | composer.md, message-bubble.md | 全部 | — |
| 2.5 | 2.过程查看与控制 | 降级提示查看 | 查看 capability 降级原因 | 过程面板 | 理解为何结果不完整 | 旅程 12 | degradation-notice.md | 全部 | — |
| 2.6 | 2.过程查看与控制 | 快捷键操作 | 通过键盘快捷键执行常用操作 | 全局 | 提升效率用户操作速度 | - | 02-dynamic-behavior-and-interaction.md | 全部 | — |
| 3.1 | 3.长时任务与后台执行 | 三选择分流 | 长时任务执行中选择等待/转后台/Fork 继续 | 能力卡片底部 CTA | 长时任务不阻塞，输出与上下文关系由用户决定 | 旅程 14 | capability-card.md, conversation-ui-state.md | 全部 | — |
| 3.2 | 3.长时任务与后台执行 | 多会话后台 run | 切换会话后原会话 run 继续执行 | 会话列表 ⚡ 指示 | 多会话并行工作，不互相阻塞 | 旅程 13 | session-list-item.md | 全部 | — |
| 3.3 | 3.长时任务与后台执行 | 后台任务监控 | 查看/Kill 后台任务（shell/tool 两类） | 后台任务监控面板 | 转后台任务的可观测与控制 | 旅程 24 | background-task-monitor.md | 全部 | — |
| 3.4 | 3.长时任务与后台执行 | Cron 定时任务管理 | 查看/创建/修改/删除/启停/立即执行定时任务，并查看执行记录 | Cron Dashboard（任务/执行记录 Tab） | 定时自动化，按受信 Owner + Agent scope 管理任务与执行记录 | 旅程 25 | cron-task.md | 全部 | — |
| 4.1 | 4.会话组织与检索 | 历史对话浏览 | 切换/浏览历史会话 | 会话列表 | 回溯历史工作 | 旅程 5 | session-list-item.md | 全部 | — |
| 4.2 | 4.会话组织与检索 | 当前会话快速定位 | 通过 preview marker 悬停查看摘要、点击跳转到长会话目标回合 | 会话列表与主对话区之间的预览轨道 | 在长会话中快速定位，不触发过程请求风暴 | 旅程 5 | conversation-preview-rail.md | 全部 | — |
| 4.3 | 4.会话组织与检索 | 会话搜索与管理 | 搜索/重命名/删除会话；查看当前 favorite turn 条目 | 会话列表 + 搜索 dialog | 快速定位历史会话，组织工作空间 | 旅程 15 | session-list-item.md | 全部 | — |
| 4.4 | 4.会话组织与检索 | 派生新会话（消息级 fork） | 从已完成 turn 派生新会话 | 对话区消息气泡 | 基于历史点探索不同方向 | 旅程 11 | message-bubble.md | 全部 | — |
| 4.5 | 4.会话组织与检索 | 会话分享 | 分享会话链接给他人 | 对话区分享按钮 | 协作与知识传递 | 旅程 11 | message-bubble.md | 全部 | — |
| 5.1 | 5.富内容展示与交互 | 右侧展开面板富内容 | 查看地图/图表/PIU 等富内容 | 右侧展开面板 | 复杂结果可视化呈现 | 旅程 20 | expand-panel.md | 全部 | B3,F3 |
| 5.2 | 5.富内容展示与交互 | 文件下载 | 下载 Agent 生成的文件 | 对话区文件下载卡片 | 结果落地为可分发文件 | 旅程 22 | file-download.md | 全部 | — |
| 5.3 | 5.富内容展示与交互 | 扩展面板审核配置保存 | 在扩展面板审核/修改配置并保存反馈 | 右侧展开面板 PIU | 交互式审核，配置反馈到对话 | 旅程 23 | expand-panel.md | 全部 | F3,F4 |
| 5.4 | 5.富内容展示与交互 | 导航卡片跳转 | 从对话通知跳转到集成方系统页面 | 对话区导航卡片 | 跨系统联动，从告警直达配置 | 旅程 21 | sub-window.md | 全部 | F1 |
| 5.5 | 5.富内容展示与交互 | 内嵌 PIU/DSL 富内容 | 在对话气泡内查看 PIU/DSL 渲染的富交互组件 | 对话区消息气泡 | 集成方自定义富内容嵌入对话流 | 旅程 20 | message-bubble.md, 12-integrator-customization-guide.md | 全部 | E6,E7 |
| 5.6 | 5.富内容展示与交互 | ACTION 自动触发 | Agent 完成任务后自动 dispatch ACTION 事件触发集成方页面动作 | 对话区（隐式触发） | 跨系统自动化联动，无需用户手动操作 | 旅程 21 | sub-window.md, 12-integrator-customization-guide.md | 全部 | F2 |
| 6.1 | 6.错误与异常恢复 | 断线重连 | 网络中断后自动重连恢复 | 全局重连提示 | 网络抖动下不丢失工作 | 旅程 4 | 06-empty-loading-error-states.md | 全部 | — |
| 6.2 | 6.错误与异常恢复 | 路径拒绝提示 | 查看被策略拒绝的原因 | 对话区拒绝消息 | 理解为何操作不被允许 | 旅程 7 | message-bubble.md | 全部 | — |
| 6.3 | 6.错误与异常恢复 | 页面关闭与重开 | 关闭/刷新后恢复会话状态 | 全局 | 工作连续性，不因关闭丢失 | 旅程 18 | 06-empty-loading-error-states.md | 全部 | D1 |
| 6.4 | 6.错误与异常恢复 | 流式恢复 gap 处理 | stream resume 时 gap/failure 提示 | 对话区 | 历史与 live 一致性保障 | 旅程 18 | 06-empty-loading-error-states.md | 全部 | — |
| 7.1 | 7.上下文管理 | 上下文压缩 | 长对话自动压缩，用户可查看压缩通知 | 过程面板压缩条目 | 长对话不因上下文超限中断 | 旅程 6 | process-panel.md, message-bubble.md | 全部 | — |
| 7.2 | 7.上下文管理 | 上下文监控 | 查看 active context 状态（设计建议） | 过程面板（待定） | 理解上下文窗口使用情况 | 旅程 6 | process-panel.md | 全部 | — |
| 8.1 | 8.集成与扩展 | 嵌入模式切换 | local/immersive/piu 三种模式 | 全局 | 灵活适配部署场景 | - | 04-information-architecture.md | 全部 | G1,G2 |
| 8.2 | 8.集成与扩展 | Sub-agent 委派 | Agent 调用子 agent 处理专长任务 | 过程面板 Agent 卡片 | 领域专长扩展 | 旅程 16 | capability-card.md | 全部 | — |
| 8.3 | 8.集成与扩展 | 宿主页面触发提问 | 从宿主页面「询问 AI」按钮触发 | PIU 宿主面板 | 集成方页面内嵌 AI 能力 | 旅程 26 | composer.md | piu | D4 |
| 8.4 | 8.集成与扩展 | PIU 协作式嵌入 | 作为面板嵌入宿主页面，支持 docked/floating/maximized/minimized 四态 | PIU docked/floating/maximized/minimized | 宿主产品内嵌 NextAgent，灵活适配工作流 | 旅程 26 | 04-information-architecture.md, 12-integrator-customization-guide.md | piu | A1,A2,B2,B4,D5,D6,E8,F5,F6,G1,G3,G4 |
| 8.5 | 8.集成与扩展 | 自定义功能入口 | 通过 operators 注入自定义按钮/卡片/链接到侧边栏或顶部 | 侧边栏/顶部 operators 区 | 集成方扩展 NextAgent 功能边界，接入自有系统 | - | 12-integrator-customization-guide.md | immersive/piu | A6,B1,E3 |
| 8.6 | 8.集成与扩展 | 宿主历史聊天回放 | 宿主按 chatId 注入 PIU 历史内容；自动打开并恢复协作面板，在消息列表上方展示 | PIU 对话滚动区 | 展示宿主历史业务内容，不写入 canonical conversation | - | 12-integrator-customization-guide.md | piu | D7 |

## 集成方扩展点

| 编号 | 类别 | 扩展点 | 集成方能做什么 | 契约字段/配置 | UI 呈现位置 | HostMode 适用 | 影响系统能力 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | A.主题与视觉定制 | 顶栏/侧栏 header 图标 | base64 替换 header logo | AICOConfig.icon | PIU/immersive header | immersive/piu | 8.4 | 已实现 |
| A2 | A.主题与视觉定制 | 协作式入口按钮图标 | base64 替换 PIU 入口小 logo | AICOConfig.entranceIcon | PIU 入口按钮 | piu | 8.4 | 已实现 |
| A3 | A.主题与视觉定制 | Welcome 品牌图标 | base64 替换欢迎页 logo | AICOConfig.guideIcon | 欢迎页 | 全部 | 1.1 | 已实现 |
| A4 | A.主题与视觉定制 | 品牌名称（wordmark） | 替换硬编码 NextAgent wordmark | AICOConfig.name | 欢迎页 | 全部 | 1.1 | 已实现 |
| A5 | A.主题与视觉定制 | 主题切换 | lightday/evening 切换，映射 AntD token + data-theme | PIU handler switchTheme | 全局主题 | piu | 全局 | 已实现 |
| A6 | A.主题与视觉定制 | Operator 明暗双主题图标 | 每个 operator 提供明暗两套图标 | Operator.lightIcon/darkIcon | operators 区 | 全部 | 8.5 | 已实现 |
| A7 | A.主题与视觉定制 | 预留 activeIcon | 预留字段，本期不消费 | AICOConfig.activeIcon (reserved) | — | — | — | UCD 设计建议 |
| B1 | B.布局定制 | 顶栏 vs 侧栏布局 | LEFT=侧栏；RIGHT=顶部栏替代侧栏 | layoutConfig.operatorPosition | 侧栏/顶部栏 | immersive | 8.5 | 已实现 |
| B2 | B.布局定制 | 协作面板尺寸 | 定制 docked 面板宽/高/最小宽 | AICOConfig.modalSize | PIU docked 面板 | piu | 8.4 | 已实现 |
| B3 | B.布局定制 | 扩展面板位置 | 预留字段，本期不改变渲染 | layoutConfig.expandPanelPosition (reserved) | 右侧展开面板 | — | 5.1 | UCD 设计建议 |
| B4 | B.布局定制 | 协作面板形态切换 | 用户切换面板形态 docked/floating/maximized | PIU 内部状态 | PIU 面板 | piu | 8.4 | 已实现 |
| C1 | C.文案/i18n | 欢迎副标题 | 替换 i18n 默认副标题 | AICOConfig.welcome | 欢迎页 | 全部 | 1.1 | 已实现 |
| C2 | C.文案/i18n | 底部免责声明 | 隐藏/显示/自定义免责声明文案+提示 | AICOConfig.declaration | 右侧底部 | 全部 | 全局 | 已实现 |
| C3 | C.文案/i18n | 国际化语言切换 | 宿主切换中英文 | PIU handler switchLocale | 全局文案 | piu | 全局 | 已实现 |
| C4 | C.文案/i18n | 免责声明 Tooltip | 鼠标悬停展示详细提示 | i18n rightPane.disclaimerTip | 右侧底部 tooltip | 全部 | 全局 | 已实现 |
| D1 | D.行为定制 | 会话恢复开关 | true 时协作式不恢复上次会话 | AICOConfig.clearStorage | 会话恢复逻辑 | piu | 6.3 | 已实现 |
| D2 | D.行为定制 | 用户消息时间戳 | 控制用户气泡是否显示时间戳 | AICOConfig.showAskTime | 用户消息气泡 | 全部 | 1.1 | 已实现 |
| D3 | D.行为定制 | 完整过程入口显隐 | false 时隐藏 ProcessPanel 完整过程按钮 | AICOConfig.showThinkingChain | 过程面板入口 | 全部 | 2.1,2.2 | 已实现 |
| D4 | D.行为定制 | 宿主注入问题 | 宿主页面→对话注入问题，可选直接发送 | PIU handler sendQuestionToLui | Composer/对话区 | piu | 8.3,1.1 | 已实现 |
| D5 | D.行为定制 | PIU 显示状态控制 | 宿主控制入口 logo 和面板的显示/隐藏 | PIU handler displayAIAgent | PIU 入口+面板 | piu | 8.4 | 已实现 |
| D6 | D.行为定制 | PIU 最小化 | 宿主触发面板最小化 | PIU handler minimizeAIAgent | PIU 面板 | piu | 8.4 | 已实现 |
| D7 | D.行为定制 | 历史聊天回放 | 宿主按 chatId 注入 PIU 历史内容，在消息列表上方展示；仅进程内 view state | PIU handler handleHistoricalChatReplay | PIU 对话滚动区 | piu | 8.4 | 已实现 |
| E1 | E.组件替换/PIU注入 | Skill 区 PIU 替换 | 用 PIU 替换整个 SkillSelector 区域 | AICOConfig.quickInfo.type=SELF_DEFINE | Composer Skill 区 | 全部 | 1.6 | 已实现 |
| E2 | E.组件替换/PIU注入 | 高频问题区 PIU 替换 | 用 PIU 完全替换整个 GuideArea | AICOConfig.guideInfo.type=SELF_DEFINE | Composer 引导区 | 全部 | 1.7 | 已实现 |
| E3 | E.组件替换/PIU注入 | 自定义按钮注入 | 注入自定义按钮到侧栏/header/更多菜单 | AICOConfig.operators (Operator[]) | 侧栏/header/更多菜单 | immersive/piu | 8.5 | 已实现 |
| E4 | E.组件替换/PIU注入 | 答案操作区 PIU 替换 | 替换默认 BubbleActions | AICOConfig.answerOperator | 助手消息气泡操作区 | 全部 | 2.3 | 已实现 |
| E5 | E.组件替换/PIU注入 | Composer 操作区 PIU 替换 | 替换 composer slash-hint 区域 | AICOConfig.inputOperator | Composer 操作区 | 全部 | 1.9 | 已实现 |
| E6 | E.组件替换/PIU注入 | PIU 消息内嵌渲染 | ANSWER 事件携带 PIU 时自动加载渲染 | toolMessageType=PIU + PiuMessage | 对话区消息气泡 | 全部 | 5.5 | 已实现 |
| E7 | E.组件替换/PIU注入 | DSL 消息渲染 | 后端返回 DSL 时直接用 DSL 引擎渲染 | toolMessageType=DSL + DSLEngine | 对话区消息气泡 | 全部 | 5.5 | 已实现 |
| E8 | E.组件替换/PIU注入 | Knowledge 列表渲染 | 在指定容器中独立渲染知识源列表 | PIU handler renderKnowledge | 宿主指定容器 | piu | 8.4 | 已实现 |
| F1 | F.宿主事件/回调 | OPERATOR 按钮事件 | ANSWER 渲染按钮组，点击 dispatch CustomEvent | toolMessageType=OPERATOR → CustomEvent | 对话区操作按钮 | 全部 | 5.4,8.5 | 已实现 |
| F2 | F.宿主事件/回调 | ACTION 事件 | ANSWER 携带 ACTION 时立即 dispatch 多个 CustomEvent | toolMessageType=ACTION → CustomEvent | 对话区（隐式） | 全部 | 5.6 | 已实现 |
| F3 | F.宿主事件/回调 | PIU 扩展面板回调 | PIU 组件调用回调打开/关闭扩展面板 | handleExpandPanelOpen/Close + expandPanelId | 右侧展开面板 | 全部 | 5.1,5.3 | 已实现 |
| F4 | F.宿主事件/回调 | PIU onPiuSubmit 回调 | Expand Panel 内 PIU 提交结果反馈到对话 | onPiuSubmit (UCD 建议) | 右侧展开面板 | 全部 | 5.3 | 缺口 |
| F5 | F.宿主事件/回调 | 宿主菜单事件 | 宿主框架菜单事件转发 + 退出登录 | piu.attach userAction.febsMemuEvent/logout | 宿主框架菜单 | piu | 8.4 | 类型已声明/未接线 |
| F6 | F.宿主事件/回调 | $stateChange 状态变更 | 当前仅 theme 变化触发页面 reload，不是通用状态字典 | piu.attach $stateChange.theme | 全局状态 | piu | 8.4 | 部分实现 |
| G1 | G.基础设施 | 宿主容器 ID | 宿主指定入口 logo 渲染位置 | AICOConfig.containerId | PIU 容器 | piu | 8.4,8.1 | 已实现 |
| G2 | G.基础设施 | PIU 注入路径 | 沉浸式从 sessionStorage 读取 AICOConfig | sessionStorage[AICOConfig] | 配置注入 | immersive | 8.1 | 已实现 |
| G3 | G.基础设施 | Prel/PIU 生命周期 | 宿主通过 Prel 框架加载并启动 PIU | Prel.start/piu.attach/loadAIAgent | PIU 生命周期 | piu | 8.4 | 已实现 |
| G4 | G.基础设施 | 宿主站点上下文 | 宿主通过 Prel 注入会话/用户/语言/主题 | site.session/user/locale/theme | 全局上下文 | piu | 8.4 | 已实现 |

## 能力 × 扩展影响矩阵

原工作簿使用 40×38 宽矩阵。Markdown 改为稀疏表示，只列出每项能力对应的非空关系；未列出的扩展点即无关系。

| 能力编号 | 功能 | 非空扩展关系 |
| --- | --- | --- |
| 1.1 | 提问到答案 | ● A3 Welcome 品牌图标<br>● A4 品牌名称（wordmark）<br>○ A5 主题切换<br>● C1 欢迎副标题<br>○ C3 国际化语言切换<br>● D2 用户消息时间戳<br>● D4 宿主注入问题 |
| 1.2 | 附件上传 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 1.3 | pending input 应答 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 1.4 | 编辑重发 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 1.5 | 并行工具调用 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 1.6 | Skill 选择与使用 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● E1 Skill 区 PIU 替换 |
| 1.7 | 快捷问题入口 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● E2 高频问题区 PIU 替换 |
| 1.8 | 推荐后续问题 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 1.9 | Slash 命令 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● E5 Composer 操作区 PIU 替换 |
| 2.1 | 多轮思考与工具调用 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● D3 完整过程入口显隐 |
| 2.2 | Run Graph 查看 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● D3 完整过程入口显隐 |
| 2.3 | 取消与重试 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● E4 答案操作区 PIU 替换 |
| 2.4 | 执行中发新消息（supersede） | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 2.5 | 降级提示查看 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 2.6 | 快捷键操作 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 3.1 | 三选择分流 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 3.2 | 多会话后台 run | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 3.3 | 后台任务监控 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 3.4 | Cron 定时任务管理 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 4.1 | 历史对话浏览 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 4.2 | 当前会话快速定位 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 4.3 | 会话搜索与管理 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 4.4 | 派生新会话（消息级 fork） | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 4.5 | 会话分享 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 5.1 | 右侧展开面板富内容 | ○ A5 主题切换<br>● B3 扩展面板位置<br>○ C2 底部免责声明<br>○ C3 国际化语言切换<br>○ C4 免责声明 Tooltip<br>● F3 PIU 扩展面板回调 |
| 5.2 | 文件下载 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 5.3 | 扩展面板审核配置保存 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● F3 PIU 扩展面板回调<br>★ F4 PIU onPiuSubmit 回调 |
| 5.4 | 导航卡片跳转 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>★ F1 OPERATOR 按钮事件 |
| 5.5 | 内嵌 PIU/DSL 富内容 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>★ E6 PIU 消息内嵌渲染<br>★ E7 DSL 消息渲染 |
| 5.6 | ACTION 自动触发 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>★ F2 ACTION 事件 |
| 6.1 | 断线重连 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 6.2 | 路径拒绝提示 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 6.3 | 页面关闭与重开 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● D1 会话恢复开关 |
| 6.4 | 流式恢复 gap 处理 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 7.1 | 上下文压缩 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 7.2 | 上下文监控 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 8.1 | 嵌入模式切换 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>● G1 宿主容器 ID<br>● G2 PIU 注入路径 |
| 8.2 | Sub-agent 委派 | ○ A5 主题切换<br>○ C3 国际化语言切换 |
| 8.3 | 宿主页面触发提问 | ○ A5 主题切换<br>○ C3 国际化语言切换<br>★ D4 宿主注入问题 |
| 8.4 | PIU 协作式嵌入 | ● A1 顶栏/侧栏 header 图标<br>● A2 协作式入口按钮图标<br>○ A5 主题切换<br>● B2 协作面板尺寸<br>★ B4 协作面板形态切换<br>○ C3 国际化语言切换<br>● D5 PIU 显示状态控制<br>● D6 PIU 最小化<br>● E8 Knowledge 列表渲染<br>● F5 宿主菜单事件<br>● F6 $stateChange 状态变更<br>● G1 宿主容器 ID<br>★ G3 Prel/PIU 生命周期<br>● G4 宿主站点上下文 |
| 8.5 | 自定义功能入口 | ○ A5 主题切换<br>● A6 Operator 明暗双主题图标<br>● B1 顶栏 vs 侧栏布局<br>○ C3 国际化语言切换<br>★ E3 自定义按钮注入<br>● F1 OPERATOR 按钮事件 |
| 8.6 | 宿主历史聊天回放 | ★ D7 历史聊天回放 |
