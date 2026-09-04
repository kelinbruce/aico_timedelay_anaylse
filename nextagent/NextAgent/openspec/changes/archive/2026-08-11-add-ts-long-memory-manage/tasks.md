## 1. 前端 Service 层和类型定义

- [x] 1.1 在 `frontend/agent-web/src/state/contracts.ts` 中新增 V2 API 的 TypeScript 类型定义（`LongTermMemoryRecord`、`LongTermMemorySummary`、`MemoryType`、`KnowledgeSourceType`、`SharingState`、`MemoryState`、`PatchLongTermMemoryReq` 等）。`sourceMemoryId` 和 `lastAccessedAt` 为可选字段，匹配 YAML 和公开管理视图，不复用 Gateway Record。
  验证：TypeScript 编译通过。

- [x] 1.2 新增 `frontend/agent-web/src/services/memoryService.ts`，封装全部 12 个 V2 API 端点。每个方法对应一个端点，响应统一解包 `data` 字段，`errorCode !== 0` 时抛出 `Error`。URL 前缀为 `/api/v1/memory/long-term-mem`。
  验证：TypeScript 编译通过。

- [x] 1.3 在 `frontend/agent-web/src/services/apiClient.ts` 中新增 `patch` 方法，与 `put` 同构。
  验证：`apiClient` TypeScript 类型包含 `patch`。

## 2. 页面组件

- [x] 2.1 新增 `frontend/agent-web/src/pages/MemoryManagePage.tsx` 和 `MemoryManagePage.css`，实现内容区骨架：标题和主要操作区、metrics 统计区、三 Tab 切换、筛选区、列表区、右侧详情面板，样式变量使用 `--ltm-` 前缀。
  验证：页面渲染，三 Tab 切换正常，宽度无跳动。

- [x] 2.2 实现"我的记忆" Tab：列表展示（调用 `listLongTermMemory`）、搜索、筛选（类型/来源/pin）、分页、点击行选中并加载详情。
  验证：Playwright 截图确认列表渲染、搜索和详情加载。

- [x] 2.3 实现"我的记忆" Tab 的单条操作：新增（`manualSaveLongTermMemory`）、编辑保存、设为保持不变/允许自动更新（PATCH isPinned）、归档/撤销归档（PATCH targetState）、删除（`deleteLongTermMemory`）。确认弹窗和反馈提示。
  验证：Playwright 截图确认操作按钮和表单。

- [x] 2.4 实现"共享记忆库" Tab 和"已归档" Tab。共享记忆库：列表（`listPublishedLongTermMemory`）、发布（`publishLongTermMemory`）、取消发布（`unpublishLongTermMemory`）、复制（`copyPublishedMemory`）。已归档：列表（`listLongTermMemory` state=ARCHIVED）、单条撤销归档（PATCH targetState=ACTIVE）。
  验证：Playwright 截图确认共享和归档 Tab 交互。

## 3. Shell 内容集成

- [x] 3.1 历史阶段：从 `frontend/agent-web/src/app/ImmersiveApp.tsx` 移除绕过 Shell 的 `/memory` 全屏 route registration；新增 `ImmersiveLeftLayout` 并让 LEFT/RIGHT layout 以私有 `conversation | memory` view state 保持常驻 chrome。该阶段“URL 不变、刷新恢复 conversation”的目标已由 9.86-9.87 替代，最终目标为 Shell 内部 `#/memory` 内容路径。
  验证：`immersive-routing.test.tsx` 覆盖 LEFT Sidebar 常驻、RIGHT header 常驻、重复点击仍为 memory、URL 不变、刷新默认 conversation、前进/后退与会话入口恢复 conversation，以及 route tree 不含 `/memory`。

- [x] 3.2 确认 Vite proxy `/api` 规则已覆盖 memory API 路径（`/api/v1/memory/long-term-mem/...`），无需额外 `/rest` 代理规则。
  验证：本地开发启动后 `/api/v1/memory/...` 请求能正确代理。

- [x] 3.3 历史阶段：扩展 `Sidebar` props，新增可选的记忆/会话选择 callback 和受控 active 状态，由 immersive shell 控制内容选择且保持 local 调用行为不变。该阶段禁止导航 `/memory` 的约束已由 9.86-9.87 替代；最终实现仍要求 Sidebar 不私有持有平行主内容状态，且切换 memory view 不重置折叠状态或会话列表展开状态。
  验证：`sidebar.component.test.tsx` 覆盖 callback、active 状态和 Sidebar 本地状态保持。

- [x] 3.4 将 `MemoryManagePage` 样式收敛为 shell 主内容区布局：移除 full-viewport 假设和重复产品 chrome，根容器使用父级可用宽高、`container-type: inline-size` 与受控 overflow；指标区使用 auto-fit；内容宽度大于 `1040px` 时列表/详情并列，不大于 `1040px` 时用 container query 纵向排列并由 `.ltm-main` 内部滚动，且不产生 document-level 水平滚动。
  验证：`MemoryManagePage.test.tsx` 覆盖内容结构和窄屏 class/状态；前端 build 通过，并以 LEFT/RIGHT 两种 shell 布局的浏览器截图确认常驻 chrome 与内部滚动。

- [x] 3.5 在 LEFT/RIGHT Shell 布局中使用 Ant Design `App` context 提供反馈消息实例；新增 `useShellFeedbackTop`，以主内容区 `getBoundingClientRect().top + 12px` 计算消息顶部偏移，并通过 `ResizeObserver` 和 window resize 重新计算。`MemoryManagePage` 改用 `App.useApp().message`，移除静态全局 `message`；portal 保持在 `.ltm-main` 等 overflow 容器之外，不复用或硬编码宿主菜单高度。
  验证：`memory-feedback-placement.test.tsx` 覆盖 RIGHT 顶栏下方定位、LEFT `12px` 定位、resize 后重算和 portal 不被 `.ltm-main` 裁剪；source-level negative assertion 在 `MemoryManagePage.tsx` 出现静态 `message` import/call 时失败。

## 4. 后端路由层

- [x] 4.1 将 `packages/agent-channel-web/src/routes/memory.ts` 收敛为 `registerMemoryRoutes(instance, longTermMemoryManagement: LongTermMemoryManagementPort)`，在 `/api/v1/memory/long-term-mem` 下注册 12 个 REST 端点并只调用 management port；删除长期记忆 Gateway import 和调用。
  验证：route tests 覆盖 12 个 application method 委托；architecture negative test 断言 Channel 出现长期记忆 Gateway import 时失败。

- [x] 4.2 在 `packages/agent-channel-web/src/routes/requests.ts` 的 `WebChannelDependencies` 中使用可选 `longTermMemoryManagement: LongTermMemoryManagementPort`，仅当 management port 存在时调用 `registerMemoryRoutes`。
  验证：registration tests 覆盖依赖存在/缺失两条路径，且无 Gateway fallback。

- [x] 4.3 在 `packages/agent-channel-web/src/index.ts` 中导出 `registerMemoryRoutes`。
  验证：TypeScript 编译通过。

- [x] 4.4 在 `packages/agent-app/src/composition/composition-contracts.ts` 的 `WebChannelRegistrationContext` 中使用可选 `longTermMemoryManagement: LongTermMemoryManagementPort` 字段，禁止暴露 `LongTermMemoryGatewayBindings`。
  验证：composition contract tests 和 architecture negative test 通过。

- [x] 4.5 在 `packages/agent-app/src/composition/channel-composition.ts` 中将 `context.longTermMemoryManagement` 传递到 `registerWebChannel` 的 `dependencies.longTermMemoryManagement`。
  验证：composition integration test 断言 Channel 只收到 management port。

- [x] 4.6 在 `packages/agent-app/src/composition/create-app.ts` 中使用 selected Gateway bindings 调用 `agent-memory` factory构造 `LongTermMemoryManagementPort`，只把 management port 传入 Channel；App 不做 DTO mapping 或 Gateway delegation。
  验证：composition integration test、`npm run build` 和 `npm run lint:architecture` 通过。

## 5. 验证

- [x] 5.1 运行 build、架构 lint 和前端测试。
  验证：`npm run build`、`npm run lint:architecture`、前端 Vitest 全部通过。
  当前结果（2026-07-25）：`npm run lint:architecture` 通过（36 个测试文件、225 个测试），前端相关回归通过（8 个测试文件、125 个测试），前端 `npm run build` 和 `npm run build:vite:modes` 通过；根 `npm run build` 当时被范围外的 `tests/fullstack-packaging-boundary.test.ts` TS2352 阻断，已登记 GitCode Issue #397，本 change 不修改该打包测试。

- [x] 5.2 运行 openspec strict 验证。
  验证：`openspec validate add-ts-long-memory-manage --strict` 通过。

## 6. 异常处理和数据安全加固

- [x] 6.1 修复详情面板"取消共享"按钮：根据 `sharingState` 动态调用 `unpublishLongTermMemory` 或 `publishLongTermMemory`。
  验证：代码审查确认 `handlePublish` 分支逻辑正确。

- [x] 6.2 收敛手工保存字段：新增/编辑表单删除置信度和更新方式控件，`manualSave` 后不再为 `isPinned`/`confidence` 补调 PATCH。
  验证：`npm test -- --run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts tests/apiClient.test.ts tests/i18n.test.ts` 通过，表单测试断言不显示两个控件、保存请求不含对应字段且不调用 `patchLongTermMemory`。

- [x] 6.3 前端数据安全解析：所有 API 返回字段通过 `safeArr`/`safeNum`/`safeStr` 访问；枚举查找通过 `safeLabel`/`safeChipClass` 加 fallback；`unwrap` 校验响应对象后再访问字段。
  验证：TypeScript 编译通过。

- [x] 6.4 请求竞态保护：列表和详情加载使用序列号 guard 丢弃过期响应；搜索 debounce 350ms。
  验证：代码审查确认 `listSeqRef`/`detailSeqRef` 逻辑。

- [x] 6.5 操作防重复：`actionLoading` 状态在操作期间禁用所有按钮。
  验证：代码审查确认所有操作按钮 `disabled={actionLoading}`。

- [x] 6.6 `loadMetrics` 失败展示错误状态而非静默显示 0。
  验证：代码审查确认 `metricsError` 状态和 UI 展示。

- [x] 6.7 `handleCopy` 空结果时展示 warning 而非静默。
  验证：代码审查确认 `results[0]` 空检查。

- [x] 6.8 硬编码展示值（"0 人"、"0 次"）改为 "-" 占位；forked 指标 note 改为 "暂不支持统计"。
  验证：代码审查。

- [x] 6.9 禁用统计接口：仅加载"我的记忆"（active count），其余四项显示"-"并标注"暂不支持统计"。
  验证：代码审查确认 `loadMetrics` 只调用一次 list，metrics 显示正确。

- [x] 6.10 禁用批量操作：移除列表行复选框、表头全选复选框、批量操作栏。单条操作不受影响。
  验证：代码审查确认无 checkbox 和 bulkbar 渲染。

## 7. 契约一致性修复

- [x] 7.1 后端 `memory.ts` 的全部 12 个端点（包括 `GET /shared`）统一从 trusted identity resolver 取得完整 `IdentityContext`，与独立可信 `agentId` 构造 `LongTermMemoryManagementScope`，不直接读取原始 header 作为授权事实，不从 query/body 读取身份字段，也不使用客户端可覆盖的 `agentId` fallback。
  验证：Fastify inject tests 断言合法请求把完整 `IdentityContext` 传给 management port 且 `displayName` 不进入响应；query/body authority 字段返回 4xx 且 management port 未调用。

- [x] 7.2 后端 4 个 POST/PATCH 端点（`PATCH /:memoryId`、`POST /:memoryId/publish`、`POST /:memoryId/unpublish`、`POST /shared/copy`）补上从 body 读取 `memoryInstance`。
  验证：代码审查确认 `asString(body.memoryInstance)`。

- [x] 7.3 后端 `asNumber` 和 `asBoolean` 支持字符串解析：Fastify query 参数均为字符串，`asNumber("1")` 返回 `1`，`asBoolean("true")` 返回 `true`。
  验证：curl 测试 `limit=1` 返回 `limit: 1`（非默认 10）。

- [x] 7.4 前端 `contracts.ts` 移除请求类型中的身份字段：`ManualSaveLongTermMemoryReq`、`PatchLongTermMemoryReq`、`SharingLongTermMemoryReq`、`CopyLongTermMemoryReq`、`ListSharedMemoryParams` 移除 `tenantId`/`userId`/`agentId`；`MemoryOwnerScope` 和 `LongTermMemoryRecord` 移除 `agentId`。
  验证：TypeScript 编译通过。

- [x] 7.5 前端 `memoryService.ts` `scopeQuery` 只保留 `memoryInstance`；`GET /shared` 不再传 `tenantId`/`agentId` query。
  验证：代码审查确认 scopeQuery 只返回 memoryInstance。

- [x] 7.6 前端 `MemoryManagePage.tsx` scope.tenantId 改用 `oDomain?.id`（fallback `domain`）；所有 body 调用移除 `tenantId`/`userId`/`agentId`。
  验证：代码审查确认无身份字段传递。

- [x] 7.7 前端 `AppProviders.tsx` header 设置从 `useEffect` 改为 `useMemo`，确保子组件 effect 执行前 header 已就绪。
  验证：浏览器刷新后首次 API 请求不再 400。

- [x] 7.8 前端 mock 环境（`prel-mock.ts` 和 `prelude-mock-source.mjs`）mock user 补上 `oDomain: { id: "tenant-1", name: "Local tenant" }`。
  验证：curl 测试 prelude-loader 脚本包含 oDomain。

- [x] 7.9 前端 `MemoryManagePage.tsx` 删除 `loadMetrics` 函数，活跃计数 `total` 直接从 `loadList` 响应获取，不再发单独的 `limit=1` 请求。
  验证：代码审查确认无 loadMetrics 调用，total 从 loadList 提取。

- [x] 7.10 design.md 和 spec.md 同步更新契约一致性修复内容。
  验证：`openspec validate add-ts-long-memory-manage --strict` 通过。

- [x] 7.11 前端 `MemoryManagePage.tsx` 活跃计数仅在 "我的记忆" tab 加载时更新（`view === "mine"`），切换到 "共享记忆库" 或 "已归档" tab 时不覆盖活跃计数，共享列表 `total` 不写入 "我的记忆" 指标。
  验证：代码审查确认 `setMetrics` 只在 `view === "mine"` 分支调用；openspec strict 验证通过。

- [x] 7.12 前端共享按钮状态切换：使用 `publishedMap`（`Map<string, string>`：原始 memoryId → 共享副本 memoryId）追踪发布状态。发布后按钮变为 "取消共享"，取消发布时用副本 ID 调用 `unpublishLongTermMemory` 并切回 "共享到记忆库"。
  验证：代码审查确认 `publishedMap` 逻辑；esbuild 编译通过。

- [x] 7.13 前端归档前置条件：`isPinned = true` 时点击归档显示 warning，不弹确认框，不发 API。
  验证：代码审查确认 `handleArchive` 中 `isPinned` 检查；esbuild 编译通过。

- [x] 7.14 前端切换 tab 时清空旧详情：共享记忆库直接使用共享摘要；我的记忆和已归档使用详情接口加载当前选择，不显示前一个 Tab 的记录。
  验证：组件测试覆盖 Tab 切换后的首条选择和详情更新。

## 8. Chat 风格界面优化

- [x] 8.1 将记忆内容区标题改为与 Chat 首页同形的 `54px` 简洁标题和内缩分隔线，移除左上角独立图标与副标题；页面字体、字号、文字颜色、背景、边框和交互状态统一复用 NextAgent `--font-family-app` 与 `--color-*` 主题变量。
  验证：`MemoryManagePage.test.tsx` 断言标题结构、无图标/副标题和主题变量；真实后端浏览器截图与 Chat 首页对照。

- [x] 8.2 删除全部指标卡；把活动记忆 `total` 作为“我的记忆”Tab 内的轻量计数展示，不请求或展示“保持不变”“共享中”“已复制”“已归档”统计。
  验证：`MemoryManagePage.test.tsx` 断言无 `.ltm-metrics`/`.ltm-metric`，活动列表响应 `total` 出现在 Tab 计数且切换共享/归档不覆盖。

- [x] 8.3 详情正文可解析为 JSON object/array 时以两空格缩进结构化展示，非 JSON 或 JSON scalar 保持原文；列表摘要和编辑表单不改写原始内容。
  验证：`MemoryManagePage.test.tsx` 覆盖 JSON object、array、非法 JSON 和普通文本；前端 `npm run build` 通过。

- [x] 8.4 详情正文容器不显示横向滚动条；JSON 长键值和普通连续文本都限制在卡片可用宽度内强制换行，同时保留 JSON 的换行与缩进。
  验证：`MemoryManagePage.test.tsx` 对 `.ltm-markdown`/`.ltm-json` 做禁止横向滚动和强制换行的 CSS 断言，并使用真实后端详情做浏览器检查。

- [x] 8.5 私有记忆和共享记忆详情的正文标题旁提供“复制正文”操作，复制 API 返回的原始 `content`；成功和失败通过 Shell message 反馈，失败时不修改数据。
  验证：`MemoryManagePage.test.tsx` 覆盖 JSON 原始正文复制、Clipboard API 写入调用和失败反馈；真实浏览器详情显示复制入口。

- [x] 8.6 重构详情面板的信息层级：身份区集中展示类型/状态/可见性/置信度/摘要，操作工具栏区分主操作、次操作和破坏性操作，正文/标签/属性使用独立语义 section，属性使用紧凑 `dl` 键值清单；共享详情复用同一结构并支持窄宽度换行。
  验证：`MemoryManagePage.test.tsx` 断言身份区、toolbar、三类 section、破坏性操作分组和 `dl` 属性清单；真实后端浏览器检查桌面与窄内容区。

- [x] 8.7 详情操作工具栏在支持的详情宽度内保持单行，使用紧凑按钮尺寸和间距容纳主操作、次操作及隔离后的破坏性操作，不产生横向滚动条。
  验证：`MemoryManagePage.test.tsx` 断言 toolbar/action group 为 `nowrap` 且窄宽度规则不把 danger group 扩成整行；真实浏览器检查工具栏 `scrollWidth` 不超过 `clientWidth`。

- [x] 8.8 为新增/编辑表单的详情 body 增加专用 `16px` 内边距，修复表单内容贴住卡片边缘，同时保持查看态由独立 section 承担留白。
  验证：`MemoryManagePage.test.tsx` 断言编辑态使用专用 form-body class 及 `16px` padding；真实浏览器检查表单与详情卡片边缘间距。

- [x] 8.9 让新增/编辑态的保存和取消按钮复用详情操作工具栏的紧凑按钮规格，统一最小高度、水平内边距和字号。
  验证：`MemoryManagePage.test.tsx` 断言 form-actions class 和共享尺寸规则；真实浏览器对比编辑态与详情态按钮的计算样式。

- [x] 8.10 三个 Tab 的列表成功返回后，有数据时默认选中当前页第一条并显示详情；当前选择仍在结果中时保留用户选择，空列表时清空详情。
  验证：`MemoryManagePage.test.tsx` 覆盖我的记忆、共享记忆库、已归档自动首选、空列表和刷新保留选择；真实浏览器切换 Tab 检查首行 active 与详情内容。

- [x] 8.11 新增和编辑表单最多允许 10 个解析后的非空标签；超过上限时显示计数错误、标记输入无效并禁用保存，禁止超限请求进入接口。
  验证：`npm test -- --run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，其中覆盖 10 个标签可提交、11 个标签不可提交且不调用 `manualSaveLongTermMemory`；真实 immersive 界面输入 11 个标签后显示计数错误、输入框呈无效状态且“保存”按钮禁用。

- [x] 8.12 复用 Chat 的 immersive 宿主适配链路：`MemoryManagePage` 全部界面自有文案接入 `memoryManagement.*` 中英文资源，日期跟随当前 locale；主题样式移除浅色固定色值并只使用 NextAgent 语义变量。宿主运行时切换 `site.locale` 或 `site.theme` 时，记忆视图原地更新且不新增独立切换状态或控件。
  验证：`MemoryManagePage.test.tsx` 覆盖 `en-us/evening` 到 `zh-cn/lightday` 的动态更新且保留当前内容状态；CSS 断言状态标签、提示、进度条和按钮不含浅色固定色值；`i18n.test.ts` 继续验证中英文 key 对齐；前端 `npm run build` 通过。

- [x] 8.13 修复英文详情宽度溢出：`USER_CHARACTERISTICS` 使用可在 Type 列完整显示的简洁英文标签，Type chip 在自身最大宽度内安全换行；详情 panel/header/toolbar 建立连续的 `min-width: 0` 收缩边界，英文操作使用紧凑文案并保持单行，任何内容不得撑出详情卡片宽度。
  验证：`npm test -- --run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，19 tests）；`npm run build` 通过；真实 immersive 英文界面选中 `USER_CHARACTERISTICS` 后，详情 panel/detail/header/toolbar/action groups 均满足 `scrollWidth <= clientWidth`；`openspec validate add-ts-long-memory-manage --strict` 通过。

- [x] 8.14 修复新增/编辑表单标签 placeholder 被截断：标签字段在双列表单中复用 `.ltm-field.wide` 跨越全部列，使中英文 placeholder 使用完整可用宽度，并保持计数或错误提示位于输入框下方。
  验证：`npm test -- --run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，19 tests），英文新增态断言标签输入字段包含 `wide` class 且完整英文 placeholder 可查询；`npm run build` 与 `openspec validate add-ts-long-memory-manage --strict` 通过；真实 immersive 新增态确认字段 class 为 `ltm-field wide`、字段宽度与 form 同为 `486px`，计数提示独立显示在输入框后。

- [x] 8.15 修复新增/编辑态操作按钮贴住卡片边缘：`.ltm-form-actions` 使用紧凑的 `8px` 底部留白，使 “Save”“Save Changes”“Cancel”与详情 header 底部分隔线保持间距，同时避免按钮上下留白过大。
  验证：`MemoryManagePage.test.tsx` 断言 form-actions 底部留白为 `8px`；前端构建和 `openspec validate add-ts-long-memory-manage --strict` 通过。

- [x] 8.16 全面修复英文筛选下拉框宽度：默认筛选 grid 从错误的五个下拉列修正为实际四列，列表面板使用命名 container 在 `720px` 和 `480px` 自适应为三列和单列，控件限制在 grid cell 内；类型、来源、更新方式和置信度的英文选项使用紧凑且语义明确的文案。
  验证：`npm test -- --run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，19 tests），覆盖四列 grid、列表面板 container query、控件宽度边界和全部精简英文筛选选项；`npm run build`、i18n key 对齐和 `openspec validate add-ts-long-memory-manage --strict` 通过；真实 immersive 中筛选容器及搜索、类型、来源、更新方式、置信度五个控件均满足 `scrollWidth <= clientWidth`。


## 9. 服务测试问题收敛

- [x] 9.1 对 `/manual` 增加接口同形校验：摘要 1..2048、正文 1..4000、标签允许空数组且最多 10 个、单标签 1..256；非法输入返回 HTTP 400 `LTM_QUERY_INVALID`，不调用 management port，也不转换为 500。
  验证：`npx vitest run packages/agent-channel-web/tests/memory-routes.test.ts packages/agent-memory/tests/long-term-memory-management.test.ts` 通过（2 files，9 tests），覆盖空标签成功、11 标签、空/超长摘要、空/超长正文、超长标签和 rejected SafeError 保持 4xx 语义。

- [x] 9.2 记忆详情 service 使用 `GET /{memoryId}/record` 并委托 `getLongTermMemory`，使管理界面查看详情不增加 `accessCount`；该统计只由智能体实际使用记忆的链路维护。
  验证：`memoryService.test.ts` 断言详情 URL 包含 `/record`；`MemoryManagePage.test.tsx` 覆盖打开详情后详情访问次数保持服务端值且列表不展示该值；`memory-routes.test.ts` 覆盖 `/record` 对 `getLongTermMemory` 的委托。

- [x] 9.3 实现三个 Tab 的服务端分页闭环，分页操作传递 `limit`/`offset` 并重新加载；筛选、搜索、切换 Tab 回到第一页，越界页回退。
  验证：`MemoryManagePage.test.tsx` 覆盖下一页 `offset=10`、搜索复位和新页首条自动选择；实现对空尾页回退到最后有效页。

- [x] 9.4 共享记忆库搜索从前端 REST query 到 management query 统一使用 `queryText` 调用后台 `/shared`，Channel 不做字段名映射；不得只过滤当前页。
  验证：`memoryService.test.ts` 断言 URL query string 直接使用 `queryText`；`memory-routes.test.ts` 断言 REST `queryText` 原样传给 management port。

- [x] 9.5 FORK 副本的共享按钮保持可见但禁用，并提供不可再次共享的中英文说明；PRIVATE 原记忆保持可共享。
  验证：`MemoryManagePage.test.tsx` 覆盖 FORK 按钮禁用和提示，既有 PRIVATE 详情测试覆盖共享按钮可用。

- [x] 9.6 新增/编辑表单显示与接口一致的中英文参数提示和计数，执行必填与长度校验；标签可空、最多 10 个且单个不超过 256。
  验证：`MemoryManagePage.test.tsx` 覆盖空标签可保存、摘要/正文空值禁用保存、提示文案与 `maxLength`；`i18n.test.ts` 验证中英文 key 对齐。

- [x] 9.7 将界面术语统一为“共享记忆库”/“Shared Memories”，移除置信度筛选；修正列表 header 与 row 的列数一致性，避免多余“更新”文本错位。
  验证：`i18n.test.ts` key 对齐通过；`MemoryManagePage.test.tsx` 断言无置信度筛选、共享术语正确、三种列表 header/row 列数一致。

- [x] 9.8 “我的记忆”和“已归档”文本搜索改为 GET 列表接口的后端 `queryText` 查询；Channel、management port 和 Store Gateway 原样传递，SQLite 在分页前过滤摘要、正文和标签并返回搜索后的 `total`，前端删除当前页二次过滤。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts` 通过（2 files，23 tests）；定向启用根 Vitest 中对应 package 后运行 `npx vitest run packages/agent-channel-web/tests/memory-routes.test.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts` 通过（3 files，12 tests），覆盖摘要/正文/标签匹配、ACTIVE/ARCHIVED 状态隔离、`%`/`_` 字面匹配和搜索后分页总数；`npm run build`、`npm run lint:architecture` 与 strict OpenSpec 验证通过。

- [x] 9.9 列表摘要契约贯通 `accessCount`：local Gateway 从持久化记录投影当前值，`agent-memory` 和 Channel 原样投影到 REST 列表；前端列表响应类型保留该字段但表格不展示，详情通过 record 接口展示真实次数。列表和管理详情查询均不递增计数，智能体实际使用记忆的链路独占该统计写入。
  验证：`MemoryManagePage.test.tsx` 覆盖列表不展示值 `7`、详情显示值 `7`；定向启用对应 package 测试后运行 `npx vitest run packages/agent-channel-web/tests/memory-routes.test.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts`，覆盖 Gateway 列表查询前后计数保持、management 与 REST summary 投影；运行前端 build、架构检查、strict OpenSpec 校验和 `git diff --check`。

- [x] 9.10 将使用统计文案统一为“访问次数”，仅用于详情属性；列表不渲染访问次数列。
  验证：`MemoryManagePage.test.tsx` 断言详情显示“访问次数”，列表表头不显示该文案。

- [x] 9.11 初步取消列表内部滚动：列表卡片按内容自然增高，由主内容区承担必要滚动；行高压缩为 `60px`、摘要单行截断，列表所有表头列居中对齐。并排布局的滚动策略后续由 9.35 根据低高度裁切问题收敛为仅数据行内部滚动，窄布局继续由主内容区承担整体滚动。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx` 通过，覆盖该阶段的列表自然增高、压缩行高和表头居中规则；最终滚动策略以 9.35 的验证为准。

- [x] 9.12 三个 Tab 的分页增加首页和末页快捷跳转，使用当前服务端 `total` 和 `limit` 计算末页 offset，并保持已有上一页、下一页和禁用语义。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx` 通过，覆盖“我的记忆”从 `total=21` 跳转末页 `offset=20` 及返回首页 `offset=0`，并覆盖“共享记忆库”和“已归档”使用各自列表接口跳转末页与首页。

- [x] 9.13 超长摘要时右侧详情卡片整体可纵向滚动，避免详情头把正文区域压缩为不可访问区域。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx` 通过，断言详情卡片为唯一纵向滚动容器、详情正文不再建立内部滚动容器。

- [x] 9.14 统一编辑态“保存修改”按钮与详情工具栏按钮的精确 `30px` 高度，并收紧编辑表单标题的上下间距。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx` 通过，断言表单按钮高度/最小高度、紧凑 form header 和编辑标题行高。

- [x] 9.15 继续收紧编辑态按钮上下留白：标题到按钮为 `6px`，按钮到底部分隔线为 `8px`。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx` 通过，断言 form header 间距和 form-actions 底部留白。

- [x] 9.16 摘要和正文输入框下实时显示按 Unicode code point 计算的 `current/max` 字符计数，分别使用 `current/2048` 和 `current/4000` 格式。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，覆盖初始计数和输入后的实时更新；`npm run build` 与 `openspec validate add-ts-long-memory-manage --strict` 通过。

- [x] 9.17 收紧新增/编辑态右侧详情头部，保持 `30px` 按钮点击目标并移除操作区多余的纵向留白。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，覆盖紧凑布局规则和表单操作组位置；`npm run build` 通过。

- [x] 9.18 编辑保存成功后显式重新请求当前记忆详情并刷新当前 Tab 列表，避免选中 ID 未变化时右侧卡片保留保存前 state。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，覆盖编辑后第二次详情请求和后端持久化内容展示；`npm run build` 通过。

- [x] 9.19 编辑态头部恢复两行布局：第一行显示“编辑记忆”和状态标签，第二行显示“保存修改”“取消”；两行使用 `6px` 间距并保持 `30px` 按钮高度。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，断言操作组位于标题行之后且不嵌套在标题行；`npm run build` 通过。

- [x] 9.20 禁止详情两条 `auto` Grid 行吸收剩余卡片高度，并让 form header 的两行按 `max-content` 顶部对齐，修复两行内容被默认拉高。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，断言详情和表单头部的纵向对齐规则；`npm run build` 通过。

- [x] 9.21 列表正文预览改用标准单行省略规则，并限制摘要 Grid 单元格的最小/最大宽度，确保大量换行或长连续文本显示省略号且不撑宽单行列布局。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，断言 `text-overflow: ellipsis`、单行显示和摘要单元格收缩边界；`npm run build` 通过。

- [x] 9.22 三个 Tab 共用的搜索框在有值时显示快速清除按钮；点击后取消待执行 debounce、立即清空搜索、回到第一页并触发不含 `queryText` 的后端请求。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，覆盖清除按钮显隐、输入清空和请求参数移除；`npm run build` 通过。

- [x] 9.23 私有和共享详情在摘要超过 1024、正文超过 2000 个 Unicode code point 时默认折叠，并分别提供展开/收起操作；切换记忆时重置折叠状态。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，覆盖默认折叠、展开/收起和中英文 key 对齐；`npm run build` 通过。

- [x] 9.24 修复正文折叠时详情下半部分被固定高度裁剪的问题：详情卡片改为自然高度且不建立内部纵向滚动，摘要默认预览缩为两行、正文缩为约五行，标签和属性保持在正常文档流中。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），覆盖详情卡片无内部滚动、摘要两行和正文五行折叠规则；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过；真实 immersive 页面检查确认折叠正文 `overflow-x/overflow-y: hidden`、详情卡片 `overflow: visible` 且属性区底部未被裁剪。

- [x] 9.25 将正文折叠裁剪移到带边框的正文卡片自身，保留完整下边框和圆角；窄内容区让列表与详情使用两个 `max-content` Grid 行，避免列表溢出后遮盖详情。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），覆盖正文卡片自身裁剪和窄布局内容行规则；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过；真实 immersive 页面确认列表底部 `843.2px`、详情顶部 `855.2px`，保持 `12px` 间距，正文卡片折叠后仍有 `0.8px` 下边框、`8px` 圆角且无横纵滚动条。

- [x] 9.26 删除正文折叠的 `height: calc(5 * 1.65em + 26px)` 固定高度计算，改由正文卡片自身的五行 line clamp 决定预览高度，避免最后一行文字贴近或被下边缘裁切。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），覆盖五行 line clamp 和禁止恢复固定高度公式；`npm run build` 通过；真实 immersive 页面确认页面实际加载五行 line clamp 规则，折叠正文显示五行及省略号，正文卡片保留 `12px` 上下内边距和完整下边框，标签与属性区正常显示。

- [x] 9.27 桌面并排布局把右侧详情卡片限制在主内容区可用高度内，内容不足时不显示滚动条、内容溢出时仅详情卡片内部纵向滚动；窄布局继续由主内容区承担整体滚动。
  验证：`MemoryManagePage.test.tsx` 覆盖详情卡片高度边界、内部滚动和窄布局恢复规则；真实 immersive 页面验证详情卡片内容溢出后可独立滚动。

- [x] 9.28 修复 9.27 引入的左侧列表回归：恢复 `1040px` 纵向布局断点、`60px` 行高和 `7px` 垂直内边距，不再为详情内部滚动强行压缩列表宽度和高度。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests）；真实 immersive 页面在 `972.8px` workspace 下确认列表与详情恢复上下排列，筛选区四个控件保持同一行、筛选区高度 `50.8px`、数据行高度 `60px`，表格列完整显示。

- [x] 9.29 固定左侧列表非数据区域的垂直尺寸：列表 Grid 顶部对齐，Tab 按钮保持 `34px`，搜索和筛选控件保持 `32px`，调整列表高度时不得拉伸 Tab 或筛选区。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），覆盖列表 Grid 对齐和 Tab/筛选控件固定高度；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过；真实 immersive 页面测得 Tab 按钮 `34px`、四个搜索/筛选控件均为 `32px`、筛选区约 `50.8px`，列表 Grid `align-content: start`。

- [x] 9.30 左侧列表摘要列的正文预览最多显示两行，超过两行时显示省略号；数据行只适度增加到 `72px`，不改变 Tab 和筛选控件高度。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），覆盖两行 line clamp、禁止恢复单行 nowrap 和数据行高度；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过；真实 immersive 页面测得正文预览高度约 `34.08px`（两行，每行 `17.04px`）、原始内容 `scrollHeight = 51px` 时被隐藏并显示省略号，数据行 `72px`，Tab 仍为 `34px`，筛选控件仍为 `32px`。

- [x] 9.31 FORK 副本不可再次共享的中英文说明移到禁用共享按钮的 `title`，鼠标悬停时显示；移除详情头部常驻的重复提示。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），断言 FORK 共享按钮保持禁用、中文和运行时切换后的英文 `title` 均使用本地化说明，且页面不再渲染常驻提示；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过。

- [x] 9.32 存在分页器时将其贴到左侧列表卡片最底部；列表剩余高度只由内容行吸收，不改变 Tab、筛选区、表头和分页器高度。该阶段未恢复列表内部滚动；最终由 9.35 将弹性内容行收敛为高度不足时可滚动的数据行区域。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，27 tests），覆盖该阶段的分页器底部对齐和固定控件高度；真实 immersive 页面测得分页器 `align-self: end`，其底边与卡片内底边仅相差 `0.8px` 边框，Tab 为 `34px`、筛选控件为 `32px`；最终数据行 overflow 以 9.35 的验证为准。

- [x] 9.33 正文折叠外层显式设置 `height: auto` 和 `max-height: none`，覆盖可能残留的旧 `calc(5 * 1.65em + 26px)` 固定高度；正文预览继续由五行 line clamp 决定。
  验证：同一组前端测试正向断言自动高度、无限制最大高度和禁止固定公式；真实 immersive 页面实际加载规则为 `.ltm-collapsible-content.collapsed { height: auto; max-height: none; overflow: visible; }`，全部样式表均不含旧 `calc`，折叠容器计算结果为 `max-height: none`、`overflow: visible`。

- [x] 9.34 统一“我的记忆”“共享记忆库”和“已归档”列表及详情的置信度颜色规则：小于 `60%` 使用低置信度色，大于或等于 `60%` 使用正常主题色。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，28 tests），同时覆盖共享与归档列表的 `59%`、`60%` 边界，并确认三个列表及两种详情复用 `confidenceBarClass`；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过。

- [x] 9.35 修复浏览器缩放或低高度分辨率下左侧表格被裁切：并排布局把数据行设为唯一的列表内部纵向滚动区，固定 Tab、筛选、表头和分页器；页面级断点绑定命名根容器 `ltm-app`，窄布局恢复由 `.ltm-main` 承担整体滚动。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过，覆盖命名根 container、列表 `minmax(0, 1fr)` 弹性行、数据行内部滚动及窄布局恢复规则；真实 immersive 页面在 `1440×600` 下测得根内容宽度 `1180px`、数据行 `clientHeight=301`/`scrollHeight=720`、`overflow-y=auto`，分页器距卡片底边约 `0.8px`，Tab/筛选控件仍为 `34px`/`32px`；在 `1100×600` 下根内容宽度 `840px`、列表数据行恢复 `overflow-y=visible`，`.ltm-main` 使用整体纵向滚动。

- [x] 9.36 删除“我的记忆”和“已归档”详情中的“失效时间”属性及中英文资源；保留后端真实的 `archivedAt` 归档生命周期字段，但前端不得将其改名为失效时间或据此推算失效时间。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，28 tests），分别断言“我的记忆”和“已归档”详情不显示“失效时间”，并验证中英文资源 key 对齐；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过。

- [x] 9.37 校正记忆属性语义：`accessCount` 和 `lastAccessedAt` 分别显示为“访问次数”和“最近访问时间”，管理界面查看详情不更新这两个统计；归档确认使用系统配置的保留期限描述，不硬编码 90 天；共享列表/详情删除接口未提供的订阅数量和复制人数，将 `ownerUserId` 显示为发布者，并删除详情中重复共享状态的“属性 / Property”项。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts` 通过（2 files，29 tests），覆盖中英文统计文案、归档提示、共享列表列数与共享/私有详情属性；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 均通过。

- [x] 9.38 来源过滤菜单只保留当前存在生产写入链路的“用户设定 / CONFIGURED”和“智能沉淀 / LEARNED”，不提供尚无生产写入入口的“系统默认 / SYSTEM_DEFAULT”；保留 `SYSTEM_DEFAULT` 显示映射以兼容接口返回值。
  验证：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、29 个测试）；`npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 均通过。

- [x] 9.39 历史阶段：新增记忆不提供类型选择，固定提交 `memoryType="USER_CHARACTERISTICS"` 并以只读“用户偏好 / User preference”标签说明默认值；该阶段编辑既有记忆仍保留类型选择，随后由 9.40 收敛为只读，最终目标态由群内确认后的 9.48 替代。
  验证：运行 `npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`，覆盖新增态无类型下拉框、只读默认标签和保存请求固定类型，并确认该阶段编辑态仍可选择既有类型；运行 `npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和限定范围的 `git diff --check`。
  验证结果（2026-07-24）：前端定向测试 2 个文件、29 个测试全部通过；前端 `npm run build` 通过；change 严格校验通过；限定范围的 `git diff --check` 通过；`nextagent-skill-review` 结论为 `PASS`，没有 `agent-contracts` 变更或待群内确认项。

- [x] 9.40 历史阶段：所有记忆均不允许用户修改类型，编辑表单删除类型选择，以只读标签展示既有类型，保存时原样保留既有记录的 `memoryType`；新增表单固定为 `USER_CHARACTERISTICS`。该阶段行为已由群内确认后的 9.48 替代，不再代表当前目标态。
  验证：前端回归测试覆盖编辑态无类型下拉框、只读展示既有类型，以及编辑保存请求保持原类型；运行相关前端测试与 build、change 严格校验、限定范围的 `git diff --check` 和 `nextagent-skill-review`。
  验证结果（2026-07-24）：先运行单用例确认旧实现因编辑态仍存在类型下拉框而失败，修改后同一用例通过；`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、29 个测试）；前端 `npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和限定范围的 `git diff --check` 均通过；`nextagent-skill-review` 结论为 `PASS`，没有 frozen core contract、架构边界、安全、OpenSpec 一致性或最小内核回归问题。

- [x] 9.41 适配平台顶部 `64px` 菜单占用后的列表高度：桌面数据行压缩为最小 `64px` 和 `4px` 垂直内边距，保留两行摘要预览，不改变 Tab、搜索、筛选、表头和分页器高度，也不在记忆页重复使用 viewport 高度扣减。
  验证：前端测试断言数据行高度、两行省略和禁止硬编码 `calc(100vh - 64px)`；运行相关前端测试与 build。
  验证结果（2026-07-26）：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、29 个测试）；`frontend/agent-web` 的 `npm run build` 通过。

- [x] 9.42 历史阶段：对管理界面创建的用户特征记忆增加 50 条容量校验，第 51 条创建返回 `LTM_WRITE_INVALID`/`VALIDATION` 并由 Channel 映射为 HTTP 400；该阶段的按类型计数语义已由 9.49 统一为所有 `CONFIGURED` 个人设定记忆共用额度。
  验证：local Gateway 测试覆盖前 50 条成功、第 51 条失败及满额后编辑成功；Channel 路由测试覆盖容量错误返回 HTTP 400；运行相关后端测试、build 和 strict OpenSpec 校验。
  验证结果（2026-07-26）：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts packages/agent-channel-web/tests/memory-routes.test.ts --reporter=dot` 通过（2 个测试文件、10 个测试），覆盖 50 条成功、第 51 条拒绝、满额编辑以及 HTTP 400 映射；`npm run lint:architecture` 通过（34 个测试文件、215 个测试）；`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过。根 `npm run build` 被本次范围外且未由本任务触达的 `packages/agent-channel-common/src/projections/ask-user-question-answer.ts` 中 `JsonObjct` 拼写错误阻断。

- [x] 9.43 历史阶段：每个可信用户、Agent 和记忆实例最多 50 条 `knowledgeSourceType=CONFIGURED` 的用户特征记忆，`ACTIVE` 和 `ARCHIVED` 均占用额度；该阶段的“用户特征”范围已由 9.49 扩展为所有记忆类型，归档与撤销归档仍不改变额度，智能沉淀和 `sharingState=SHARED` 发布记录仍不占用该额度。
  验证：local Gateway 测试覆盖满 50 条后归档仍拒绝新增、撤销归档保持 50 条、满额编辑成功、删除释放额度和智能沉淀不占用户设定额度；Channel 路由测试继续覆盖容量错误映射为 HTTP 400；运行相关后端测试和 strict OpenSpec 校验。
  验证结果（2026-07-26）：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts packages/agent-channel-web/tests/memory-routes.test.ts --reporter=dot` 通过（2 个测试文件、10 个测试）；`npm run lint:architecture` 通过（34 个测试文件、215 个测试）；`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过；`nextagent-skill-review` 结论为 `PASS`，本次修正未修改 `agent-contracts` 或 frozen core contract。

- [x] 9.44 进一步压缩默认 10 条列表高度：摘要列正文预览由两行改为单行省略，数据行最小高度由 `64px` 降为 `52px`，保持 `4px` 垂直内边距以及 Tab、筛选、表头和分页器既有高度。
  验证：前端测试断言单行省略、禁止列表正文恢复多行 line clamp 和 `52px` 数据行高度；运行相关前端测试、build 和 strict OpenSpec 校验。
  验证结果（2026-07-26）：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、29 个测试）；前端 `npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过。

- [x] 9.45 “我的记忆”和“已归档”列表不展示访问次数：保留列表接口及前端响应类型中的 `accessCount` 字段，但表头和数据行不渲染该列；详情属性继续展示访问次数和最近访问时间。
  验证：`MemoryManagePage.test.tsx` 断言“我的记忆”表头和数据行不包含访问次数、五列 Grid 与 DOM 一致，并确认详情加载后仍展示访问次数；运行前端定向测试、build、strict OpenSpec 校验和 `git diff --check`。
  验证结果（2026-07-27）：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、29 个测试）；前端 `npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过；`nextagent-skill-review` 结论为 `PASS`，未修改 `agent-contracts`、Gateway 或 REST 响应契约。

- [x] 9.46 对齐共享复制 REST 结果和幂等行为：`POST /shared/copy` 的 `data` 直接返回结果数组；首次复制创建 FORK，重复复制返回既有 FORK 且不新增记录；前端按数组读取并选中返回的副本。
  验证：Channel 测试断言 `data[0]` REST 投影；前端 service 测试断言直接解包数组；local Gateway 测试断言重复复制返回同一 `memoryId` 且只存在一条 FORK。
  验证结果（2026-07-27）：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts packages/agent-channel-web/tests/memory-routes.test.ts --reporter=dot` 通过（2 个测试文件、11 个测试）；前端 `npx vitest run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts tests/i18n.test.ts --reporter=dot` 通过（3 个测试文件、33 个测试）；`openspec validate add-ts-long-memory-manage --strict` 和 `git diff --check` 通过。记忆路由成功信封同时统一为 `errorMsg: "SUCCESS"`。后端 package build 被本次范围外的 `agent-channel-common` 既有 `JsonObjct` 拼写错误阻断。

- [x] 9.47 修复超长正文折叠预览最后一行被边框分割：预览显示六个完整文本行，line clamp 移到正文卡片的内部文本元素，边框与内边距容器保持自然高度。
  验证：前端测试断言内部文本元素使用六行 line clamp，带边框正文容器不直接承担裁剪，并运行前端 build。
  验证结果（2026-07-27）：前端定向测试通过（3 个测试文件、33 个测试），`frontend/agent-web` 的 `npm run build`、change strict validate 和 `git diff --check` 通过；`nextagent-skill-review` 结论为 `PASS`，本次未修改 `agent-contracts` 或 frozen core contract。

- [x] 9.48 经群内确认扩展手工保存契约和管理表单：新增/编辑均可修改 `memoryType` 与 `confidence`；新增默认 `USER_CHARACTERISTICS` 和 `confidence=1`，编辑回显已有值；`/manual` 在单次写入中保存两个字段，置信度越界返回 HTTP 400。
  验证：前端组件测试覆盖新增默认值、用户修改和编辑回显；Channel 测试覆盖合法字段传递与非法置信度 400；management/Gateway 测试覆盖新增及编辑原子保存类型和置信度；运行相关前后端测试、build、strict OpenSpec 校验和语义审查。
  验证结果（2026-07-27）：`openspec validate add-ts-long-memory-manage --strict` 通过；前端 `npx vitest run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts tests/i18n.test.ts --reporter=dot` 通过（3 个测试文件、34 个测试），`npm run build` 通过；后端定向测试通过（release 配置 3 个测试文件、16 个测试，contract 配置 2 个测试文件、12 个测试）；`npm run lint:architecture` 通过（37 个测试文件、229 个测试）；限定范围 `git diff --check` 通过。`agent-contracts` 冻结契约变更已取得群内确认；后端 package build 被本次范围外的 `packages/agent-channel-common/src/projections/ask-user-question-answer.ts` 既有 `JsonObjct` 拼写错误阻断。

- [x] 9.49 修复个人设定 50 条容量限制：`manualSaveLongTermMemory` 创建 `CONFIGURED` 记忆前查询同一可信 scope 和 `memoryInstance` 下 ACTIVE/ARCHIVED 的个人设定总数，不区分 `memoryType`；`当前数量 + 1 > 50` 时返回 `LTM_WRITE_INVALID`/`VALIDATION` 且不调用保存 Gateway。local Gateway 在事务内按相同语义兜底，防止跨类型和并发创建绕过；编辑不新增额度，归档不释放额度，删除才释放。
  验证：management service 测试覆盖 49+1 成功、50+1 拒绝、跨类型共用额度、编辑跳过前置计数和计数失败不写入；local Gateway 测试覆盖跨类型第 51 条拒绝及归档不释放；Channel 测试覆盖容量 SafeError 映射 HTTP 400；运行相关后端测试、build、strict OpenSpec 校验和语义审查。
  验证结果（2026-07-27）：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts packages/agent-channel-web/tests/memory-routes.test.ts --reporter=dot` 通过（3 个测试文件、18 个测试）；`npm run build -w @nextagent/agent-memory`、`npm run build -w @nextagent/agent-platform-gateway-local` 均通过；`npm run lint:architecture` 通过（37 个测试文件、229 个测试）；`openspec validate add-ts-long-memory-manage --strict` 和限定范围 `git diff --check` 通过。`nextagent-skill-review` 结论为 `PASS`：实现归属 `agent-memory`，local Gateway 只负责事务内持久化兜底，未新增或修改 frozen core contract。

- [x] 9.50 对齐手工保存表单中的记忆类型与置信度控件：两者使用相同显式高度、`border-box` 盒模型和顶部对齐；前端按 `LTM_WRITE_INVALID` 与确定的 50 条容量消息识别容量错误，使用 `memoryManagement.messages.capacityExceeded` 显示当前语言提示，其它同码错误保持原消息。
  验证：组件测试断言类型和置信度控件共享高度/盒模型规则；中文与英文测试分别断言容量错误显示本地化文案且不泄漏后端英文消息，另覆盖其它 `LTM_WRITE_INVALID` 不被误映射；运行前端定向测试、build、strict OpenSpec 校验和语义审查。
  验证结果（2026-07-27）：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、33 个测试），覆盖中英文容量提示和其它同码错误保留；`frontend/agent-web` 的 `npm run build`、`openspec validate add-ts-long-memory-manage --strict` 和限定范围 `git diff --check` 通过。真实 immersive 页面计算样式中两个控件的顶部均为 `908.4px`、高度均为 `34px`、`box-sizing` 均为 `border-box`；使用当前超过额度的数据提交后显示中文本地化容量提示且未创建记录。`nextagent-skill-review` 结论为 `PASS`：改动仅触达前端布局、错误展示和 change 文档，不修改 `agent-contracts`、frozen core contract 或长期记忆 owner 边界。

- [x] 9.51 修复智能沉淀记录编辑时来源被覆盖：新增记忆继续提交 `knowledgeSourceType=CONFIGURED`，编辑记忆提交当前记录原有来源；用户修改 `memoryType` 或 `confidence` 后，保存请求使用表单新值且不得把 `LEARNED` 改写为 `CONFIGURED`。
  验证：组件测试以 `LEARNED` 记录进入编辑态，将类型从 `FACTUAL` 修改为 `CONCEPTUAL`、置信度修改为 `0.35`，断言 `/manual` 请求同时携带新类型、新置信度和原来源；运行前端定向测试、build、strict OpenSpec 校验和语义审查。
  验证结果（2026-07-27）：`npx vitest run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts tests/i18n.test.ts --reporter=dot` 通过（3 个测试文件、37 个测试），覆盖 `LEARNED` 记录编辑后请求同时携带新类型、新置信度和原来源；`frontend/agent-web` 的 `npm run build`、`npm run build:vite:modes`、`openspec validate add-ts-long-memory-manage --strict`、`openspec validate --all --strict`（244 项）和限定范围 `git diff --check` 通过。

- [x] 9.52 修正搜索框能力提示：中英文 placeholder 只说明支持搜索摘要和正文，不再宣称支持标签搜索；保持既有 `queryText`、服务端分页和快速清除行为不变。
  验证：组件测试断言中文 placeholder 为“搜索摘要或正文”、英文 placeholder 为 “Search summaries or content”，i18n 测试断言中英文资源 key 对齐；运行前端定向测试、build、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-27）：`npx vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、33 个测试），覆盖中英文 placeholder、`queryText` 请求和快速清除；`frontend/agent-web` 的 `npm run build`、`openspec validate add-ts-long-memory-manage --strict`、`openspec validate --all --strict`（244 项）和限定范围 `git diff --check` 通过。

- [x] 9.53 历史阶段：限制三个 Tab 共用搜索框的可提交长度为 2048 个 Unicode code point；该上限已由 9.57 按后端公开接口契约收敛为 128，不再代表当前目标态。
  验证：组件测试使用 Emoji 覆盖 Unicode code point 计数，断言超限输入未被截断、错误提示随语言切换、超限内容不进入请求，并在删回合法长度后恢复请求；运行前端定向测试、build、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-27）：先运行定向测试复现旧实现会把 2051 个 Unicode code point 静默截断为 2048；修复后 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、34 个测试），覆盖中英文超限提示、保留完整输入、阻止超限请求及删回合法长度后恢复请求；`frontend/agent-web` 的 `npm run build`、`openspec validate add-ts-long-memory-manage --strict`、`openspec validate --all --strict`（244 项）和 `git diff --check` 通过。

- [x] 9.54 修复搜索输入文本与快速清除按钮重叠：搜索输入使用高于通用控件规则的选择器保留 `40px` 右侧内边距，完整覆盖按钮宽度、右侧定位和文本间距，不改变搜索控件高度。
  验证：Playwright 在真实浏览器中读取搜索框和清除按钮的计算样式与几何位置，断言右侧内边距覆盖按钮宽度和间距，且按钮位于保留区域；运行前端定向测试、build、浏览器 smoke、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-27）：先在浏览器中复现原 `.ltm-search-input` 规则被后置 `.ltm-control` 通用 padding 覆盖；修复后 Playwright smoke 通过，计算后的右侧内边距不小于清除按钮宽度加 `8px`，且按钮未进入文本区；前端定向测试、`npm run build`、strict OpenSpec 校验和 `git diff --check` 通过；`nextagent-skill-review` 结论为 `PASS`，改动仅属于前端内容视图样式和既有搜索交互验收，不修改 `agent-contracts`、后端契约、owner 边界或最小内核。

- [x] 9.55 优化搜索框超宽文本展示：在已预留清除按钮空间的基础上使用单行 `text-overflow: ellipsis`，超过可见宽度时显示省略号而不是直接裁切，且不改变实际输入值和后台搜索参数。
  验证：Playwright 在真实浏览器中输入超宽文本，断言输入值未被截断，且计算样式同时为 `overflow: hidden`、`white-space: nowrap` 和 `text-overflow: ellipsis`；运行前端定向测试、build、浏览器 smoke、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-27）：先在浏览器中复现搜索输入缺少省略号规则；修复后 Playwright smoke 通过，超宽输入值保持完整且计算样式使用单行省略号；前端定向测试、`npm run build`、strict OpenSpec 校验和 `git diff --check` 通过；`nextagent-skill-review` 结论为 `PASS`，本次仅修改浏览器内容视图的文本展示和验收，不触达 `agent-contracts`、后端查询契约、owner 边界或最小内核。

- [x] 9.56 国际化新增和编辑的安全护栏拒绝：前端仅按稳定错误码 `LTM_CONTENT_GUARD_BLOCKED` 映射中英文友好提示，不直接显示后端英文消息；失败后保持当前表单及用户输入，并保持其它错误码的既有映射。
  验证：组件测试覆盖新增/编辑与中英文四种组合，断言本地化消息、后端英文消息不泄漏、表单和值保留；负向测试覆盖 `LTM_CONTENT_GUARD_UNAVAILABLE` 和 `LTM_CONTENT_GUARD_CANCELED` 不被误映射；运行前端定向测试、build、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-27）：`npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 通过（2 个测试文件、39 个测试），覆盖新增/编辑、中英文、表单和值保留，以及不可用/取消错误不被误映射；`frontend/agent-web` 的 `npm run build`、`openspec validate add-ts-long-memory-manage --strict`、`openspec validate --all --strict`（248 项）和 `git diff --check` 通过。

- [x] 9.57 将三个 Tab 共用搜索框和 Web Channel 的三个 `queryText` 入口统一收敛为 128 个 Unicode code point：前端超限时保留输入、显示 `current/128` 中英文错误并阻止请求；GET 列表、POST 搜索和 GET 共享列表对超限输入返回 HTTP 400 且不调用 management port。
  验证：组件测试覆盖 Emoji 的 128 可提交、129 超限、语言切换和删回后恢复；Channel 路由测试覆盖三个入口的 128 成功与 129 返回 HTTP 400；运行相关前后端测试、前端 build、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-28）：`frontend/agent-web` 定向 Vitest 通过（2 个测试文件、40 个测试），覆盖 128 个 Emoji 可提交、131 个 code point 超限、本地化提示和恢复搜索；Channel 路由 Vitest 通过（1 个测试文件、7 个测试），覆盖三个入口 128 成功、129 返回 HTTP 400 且不调用 management port；前端 `npm run build`、`npm run build -w @nextagent/agent-channel-web`、`openspec validate add-ts-long-memory-manage --strict`、`openspec validate --all --strict`（250 项）和 `git diff --check` 均通过。本地后端重启后实测 `queryText` 长度 128 返回 HTTP 200、129 返回 HTTP 400。

- [x] 9.58 历史阶段：修复从记忆管理打开收藏面板时两个入口同时选中，采用先恢复会话、导航 `/`、再打开 Sidebar 收藏面板的私有状态方案。该阶段“不新增路由”的目标已由 9.86-9.87 替代；最终收藏入口导航到收藏 Function 拥有的 `/favorites` 内容路径。
  验证：Sidebar 组件回归测试从记忆激活状态点击收藏，断言导航到 `/`、收藏选中且记忆入口取消选中；Playwright 从 `/session/:sessionId` 进入记忆管理后点击收藏，断言回到新建会话主页并打开收藏面板；运行相关前端测试、build、multi-mode artifact build、strict OpenSpec 校验和限定范围 `git diff --check`。
  验证结果（2026-07-28）：第一次修复前定向用例显示 `onSelectConversation` 调用次数为 `0`；第一次修复仅恢复 Shell 会话内容但未导航到 `/`，补充路由断言后再次复现 `navigate("/")` 调用次数为 `0`。最终修复后，前端定向测试通过（2 个测试文件、46 个测试），同时覆盖非记忆视图切换收藏不改变既有路由；目标浏览器 smoke 通过（Chromium 3 个测试），其中从 `/session/session-1` 打开记忆管理再点击收藏的场景确认 URL 回到 `/immersive/#/`；`npm run build`、`npm run build:vite:modes`、change strict validate、全量 OpenSpec strict validate（250 项）和 `git diff --check` 均通过。全量 Playwright smoke 连续两次均为本次场景通过、总计 15/16，通过之外唯一失败为既有 `session-history-streaming.spec.cjs` 的 `streamRequests` 竞态计数（期望 `1`、实际 `2`），与本次 Sidebar 导航改动无关。

- [x] 9.59 历史阶段：修复从 Sidebar 私有收藏面板打开记忆管理时两个入口同时选中，采用先关闭收藏面板、再激活私有 memory view 且 URL 不变的方案。该阶段目标已由 9.86-9.87 替代；最终收藏与记忆管理由 `/favorites`、`/memory` pathname 唯一选择。
  验证：Sidebar 组件回归测试先打开收藏再点击记忆管理，断言收藏面板关闭、收藏入口取消选中且记忆入口选中；Playwright 覆盖同一反向切换并确认只显示记忆管理内容；运行相关前端测试、build、strict OpenSpec 校验和限定范围的 `git diff --check`。
  验证结果（2026-07-28）：`npm exec vitest run tests/sidebar.component.test.tsx --reporter=dot` 通过（1 个测试文件、38 个测试），新增用例覆盖收藏到记忆管理的反向切换；目标 Playwright 场景通过（Chromium 1/1），确认收藏面板关闭且记忆管理成为唯一激活内容；前端 `npm run build`、`npm run build:vite:modes`、change strict validate、全量 OpenSpec strict validate（250 项）和限定范围 `git diff --check` 均通过；`nextagent-skill-review` 结论为 `PASS`，本次仅收敛 Sidebar 自有 view state，不修改 `agent-contracts`、冻结核心契约、后端 owner 边界或最小内核。

- [x] 9.60 先补充三个 Tab 未过滤总数、指定页码跳转及非法页码不请求的组件测试，并确认当前实现至少一项失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆管理布局必须适配 Shell 内容区”“记忆列表必须支持筛选、搜索和分页” + Scenario“三个 Tab 显示未过滤总数”“输入页码直接跳转”“非法页码不触发请求”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot`；修改实现前目标用例失败，完成实现后通过。
  验证结果（2026-08-04）：修改实现前 `MemoryManagePage.test.tsx` 新增目标用例共出现 5 项失败，覆盖三个 Tab 总数、页码跳转、控件宽度、置信度和撤销归档；完成实现后该文件 50/50 通过。

- [x] 9.61 实现三个 Tab 独立计数刷新和指定页码跳转；计数请求不携带过滤条件，失败不阻断列表，非法页码不发请求。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆管理布局必须适配 Shell 内容区”“记忆列表必须支持筛选、搜索和分页” + design“本轮记忆管理问题修复设计”1-2。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot`，目标用例及既有分页、筛选、竞态用例全部通过。
  验证结果（2026-08-04）：三个计数分别通过既有活动、共享和归档列表端点以 `limit=1, offset=0` 获取未过滤 `total`，单项失败保留其它成功值；定向前端回归 4 个文件、69 个测试全部通过。

- [x] 9.62 先补充更新方式控件不遮挡、置信度最多两位小数、撤销归档省略 `archiveReason` 的前端回归测试，并确认当前实现失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆列表必须支持筛选、搜索和分页”“用户创建和编辑必须使用手工保存端点”“PATCH 端点必须按字段组执行变更” + Scenario“英文筛选菜单不超过控件宽度”“非法置信度被拒绝”“撤销归档”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot`；修改实现前目标用例失败，完成实现后通过。
  验证结果（2026-08-04）：修复前用例实际复现更新方式列宽不足、超长小数仍可保存及撤销归档发送空字符串；修复后组件测试 50/50 通过。

- [x] 9.63 实现更新方式筛选 cell 定向增宽、置信度 lexical 门禁和撤销归档请求修复，不修改后端归档校验。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”3-5。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot` 和 `npm run build`；目标用例与中英文资源键校验通过。
  验证结果（2026-08-04）：更新方式列最小宽度调整为 `136px` 并为箭头预留右内边距；置信度限制为 `0`、`1` 或最多两位小数；撤销归档 body 省略 `archiveReason`。前端定向回归通过；Channel 路由测试 8/8 通过。

- [x] 9.64 补充共享发布复用 session/chat 可信请求身份、请求 body 不含身份字段的回归验证；不得新增用户 profile、Gateway 或 REST 身份字段。
  来源：`FN-8.15 管理长期记忆` + Requirement“路由边界必须从可信身份解析器获得身份字段”“详情区共享按钮必须反映发布状态” + Scenario“从详情区发布记忆” + design“本轮记忆管理问题修复设计”6。
  验证：运行 `packages/agent-channel-web/tests/memory-routes.test.ts` 和发布组件测试，断言 memory route 使用与 session/chat 共享的 resolver 产生的 `IdentityContext`、发布 body 不含身份字段，且 Channel 拒绝客户端身份覆盖。
  验证结果（2026-08-05）：发布组件测试确认 body 仅含 `memoryInstance` 与 `reasonCode`；Channel 路由测试确认 publish command 使用共享 `identityResolver(request)` 输出的 `IdentityContext`，未新增 profile、Gateway、REST 身份字段或客户端覆盖入口。

- [x] 9.66 纠正发布身份的实现边界：不修改 `AppProviders.tsx`，不在 `agent-remote-deployment` 新增记忆专用 resolver；记忆路由直接复用 session/chat 在 `registerWebChannel` 中的 `WebChannelDependencies.identityResolver`。发布 body、management contract 和 Gateway contract 保持不变。
  来源：`FN-8.15 管理长期记忆` + Requirement“路由边界必须从可信身份解析器获得身份字段” + Scenario“发布使用 composition 提供的身份”“从详情区发布记忆” + design“本轮记忆管理问题修复设计”6。
  验证：运行 `packages/agent-channel-web/tests/memory-routes.test.ts`；断言 publish command 使用共享 resolver 输出的 `IdentityContext`、不从发布 body 读取身份字段，且身份字段无法覆盖可信 scope。
  验证结果（2026-08-05）：已撤回 `AppProviders.tsx`、`agent-app` 公共导出和 `agent-remote-deployment` 的不必要改动；Channel memory routes 9/9 通过，验证记忆发布复用 Web Channel 请求身份，发布 body 继续只含记忆操作字段。

- [x] 9.67 修复批量导入成功后 Tab 计数未刷新：当响应 `successCount > 0` 时，在恢复“我的记忆”列表的同时刷新三个未过滤计数；失败或结果未知时不推测数量变化。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆管理布局必须适配 Shell 内容区” + Scenario“导入成功后刷新我的记忆数量” + design“本轮记忆管理问题修复设计”1。
  验证：先在 `MemoryManagePage.test.tsx` 复现导入成功后计数仍为旧值，再让用例断言计数服务被重新调用且“我的记忆”显示导入后的服务端总数；运行前端定向测试、change strict 校验和限定范围 `git diff --check`。
  验证结果（2026-08-05）：修复前目标用例失败，`getLongTermMemoryTabTotals` 导入后仍仅调用 1 次且“我的记忆”为旧值；实现后 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts --reporter=dot` 通过（2 个测试文件、62 个测试），导入 2 条后计数服务调用第 2 次且 Tab 显示 `2`。

- [x] 9.68 修复新增/编辑表单记忆类型选中文本下缘被裁切：保持记忆类型与置信度控件同高和顶部对齐，只收紧记忆类型原生 `select` 的垂直内边距以扩大文本行盒空间。
  来源：`FN-8.15 管理长期记忆` + Requirement“用户创建和编辑必须使用手工保存端点” + Scenario“类型和置信度控件垂直对齐” + design“手工保存字段边界”。
  验证：先补充样式回归断言并在本地记忆管理新增表单复现选中文本下缘裁切，再运行 `MemoryManagePage.test.tsx` 并通过浏览器检查确认文字完整显示、两个控件高度与顶部位置不变。
  验证结果（2026-08-05）：修复前样式用例 1 项失败；浏览器测得记忆类型控件总高 `34px`、字号 `14px`、上下内边距各 `8px`。实现将该 `select` 的上下内边距收紧为 `5px`，保持总高 `34px`；`npm exec vitest run tests/MemoryManagePage.test.tsx tests/memoryService.test.ts --reporter=dot` 通过（2 个测试文件、62 个测试），本地 immersive 新增表单复核文字下缘完整显示且与置信度输入顶部对齐。

- [x] 9.70 先补充英文 `User preference` 在表格 Type 列与详情顶部单行显示、分页器不再渲染冗余文字控件、样式不定义或使用 `13px`/`ltm-font-sm` 的前端回归测试，并确认当前实现失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆管理布局必须适配 Shell 内容区”“记忆列表必须支持筛选、搜索和分页”“记忆详情必须展示智能体使用统计且不产生统计副作用” + Scenario“标题与 Chat 首页视觉一致”“分页器不显示冗余文字控件”“英文类型标签和操作文案不撑宽卡片”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；实现前目标用例必须失败，完成实现后通过。
  验证结果（2026-08-05）：实现前新增用例 5 项失败，分别命中 `ltm-font-sm`、Type 标签缺少单行 class 和三处自绘分页器；实现后定向测试 2 个文件、56 项全部通过。

- [x] 9.71 使用 Ant Design `Pagination` 替换自绘分页器，为表格和详情类型标签增加单行 class 并扩充 Type 列宽，删除 `ltm-font-sm` 与全部 `13px` 字号；保留现有服务端 `limit`/`offset`、筛选复位和越界回退语义。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”7。
  验证：运行前端定向测试、`npm run build`、`npm run build:vite:modes`、OpenSpec strict 校验和浏览器英文界面检查；表格与详情的 “User preference” 均为单行，分页只显示标准页码和箭头，代码和计算样式不再出现 `13px`。
  验证结果（2026-08-05）：定向测试 56/56、`build:vite:modes`、change strict 与全量 OpenSpec strict 273/273、`git diff --check` 均通过。浏览器实页确认 Ant Design 页码可切到第 2 页，分页文字仅为页码，列表与详情 Type chip 均为 `12px`、`white-space: nowrap`，记忆内容区计算样式中的 `13px` 元素为 0。前端完整 `npm run build` 仍被本分支既有且与本任务差异无关的 `processDetails.ts:1293` TS7022 阻断，该残留已由 9.65 持续跟踪。

- [x] 9.72 先补充英文详情顶部类型/状态标签组与置信度同一行、详情列稳定宽度、三个表格列宽平衡及置信度进度条不小于 `72px` 的前端回归测试，并确认当前实现失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆管理布局必须适配 Shell 内容区” + Scenario“宽内容区并排显示列表和详情”“表格列宽平衡且置信度可辨识”“英文类型标签和操作文案不撑宽卡片”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot`；实现前目标样式断言必须失败，完成实现后通过。
  验证结果（2026-08-06）：实现前目标用例 1 项失败、其余 49 项通过，失败命中旧的 `430px` 详情列；完成实现后 `MemoryManagePage.test.tsx` 50/50 通过，与 i18n 回归合并运行 56/56 通过。

- [x] 9.73 将桌面并排布局的详情列调整为 `480px`，详情身份区和标签组保持单行且置信度不可压缩；按三个 Tab 的实际字段数重新分配表格列宽，将置信度进度条扩到 `72px`，并让非摘要文本在窄列中单行省略。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”8。
  验证：运行前端定向测试、`npm run build:vite:modes`、OpenSpec strict 和浏览器并排布局检查；英文详情顶部不换行，列表摘要与其它列比例协调，置信度进度条测量宽度为 `72px`。
  验证结果（2026-08-06）：浏览器桌面内容区测得列表/详情宽度为 `708px/480px`，详情标签组与置信度同处 `22px` 高的单行，三个 Tab 的列宽分别为 `189.2/112/88/150/84px`、`154.4/112/76/76/132/78px` 和 `200.4/112/88/88/150px`，置信度进度条为 `72px`；前端定向测试 56/56、双宿主 Vite 构建、change 与全量 OpenSpec strict 校验及 `git diff --check` 均通过。

- [x] 9.74 先补充三个 Tab 的首页、尾页、指定页快速跳转和每页 `10 / 20 / 50` 条选择回归测试，并确认当前实现缺少这些控件或请求语义。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆列表必须支持筛选、搜索和分页” + Scenario“分页器提供完整跳转和页面大小能力”“首页和尾页直接跳转”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`；实现前新增目标用例必须失败，完成实现后通过。
  验证结果（2026-08-06）：实现前 `MemoryManagePage.test.tsx` 51 项中新增 2 项失败，均命中首页/尾页、快速跳转和页大小控件缺失；实现后组件与 i18n 定向回归 57/57 通过。

- [x] 9.75 扩展 Ant Design 分页区：启用快速跳页和每页条数选择，增加本地化首页/尾页按钮；页大小变化回到第一页，三个 Tab 继续按统一 `page/pageSize` 生成服务端 `limit/offset`，分页区窄时允许换行且不产生横向滚动。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”9。
  验证：运行前端定向测试、`npm run build:vite:modes`、OpenSpec strict 和浏览器分页交互检查；分别验证首页、尾页、指定页和页大小请求参数。
  验证结果（2026-08-06）：本地 immersive 实页在 56 条数据上显示首页、尾页、页码、快速跳页和 `10 / 20 / 50` 条选择；点击尾页后页码 6 与尾页禁用，快速跳转输入 3 后激活第 3 页，选择 `20 条/页` 后回到第 1 页并渲染 20 行。组件与 i18n 定向回归 57/57、双宿主 Vite 构建、change strict、全量 OpenSpec strict 273/273 和 `git diff --check` 均通过。

- [x] 9.76 先补充分页区整体居右且窄宽度换行后仍右对齐的样式回归测试，并确认当前居中实现失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆列表必须支持筛选、搜索和分页” + Scenario“分页器提供完整跳转和页面大小能力”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/MemoryManagePage.test.tsx --reporter=dot`；实现前新增目标断言必须失败，完成实现后通过。
  验证结果（2026-08-06）：实现前 `MemoryManagePage.test.tsx` 51 项中新增样式断言 1 项失败，明确命中 `.ltm-pagination` 和 `.ltm-pagination-pages` 仍为居中对齐；实现后组件与 i18n 定向回归 57/57 通过。

- [x] 9.77 将完整分页控件组在列表底部整体居右；保留窄宽度换行、首页/尾页、快速跳页、页大小及服务端分页语义。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”9。
  验证：运行前端定向测试、`npm run build:vite:modes`、OpenSpec strict 校验和浏览器实页布局检查；分页区右边缘与列表内容区对齐，窄宽度不产生横向滚动。
  验证结果（2026-08-06）：本地 immersive 实页计算样式确认分页容器和 Ant Design 页码主体均为 `justify-content: flex-end`，完整控件组末端距列表右边缘 `12px`，document 横向溢出为 `0`；组件与 i18n 定向回归 57/57、双宿主 Vite 构建、change strict、全量 OpenSpec strict 273/273 和 `git diff --check` 均通过。

- [x] 9.78 先补充共享绝对路径脱敏 helper 以及记忆列表、私有/共享详情、复制正文脱敏但编辑保留原文的回归测试，并确认当前记忆展示用例失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆只读展示必须与 Chat 使用相同敏感内容保护范围” + Scenario“私有记忆列表和详情脱敏绝对路径”“共享与归档记忆使用相同脱敏规则”“相对路径和 URL 保持不变”“复制使用脱敏内容而编辑保留原始内容”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/redactPathsInText.test.ts tests/MemoryManagePage.test.tsx tests/answerContent.test.ts --reporter=dot`；实现前记忆目标用例必须失败，完成实现后全部通过。
  验证结果（2026-08-06）：实现前两个记忆展示用例均因页面暴露原始 Unix/Windows 绝对路径而失败；实现后共享 helper、Chat 回归和记忆管理定向测试 68/68 通过，并断言 URL、相对路径和编辑表单原文不变。

- [x] 9.79 将 Chat 的绝对路径脱敏函数提取为 `agent-web` 共享展示 utility，并让 Chat 与记忆管理复用；三个 Tab 列表、私有/共享详情和复制正文使用脱敏投影，编辑、导入导出和持久化继续使用原始数据。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”10。
  验证：运行前端定向测试、`npm run build`、`npm run build:vite:modes`、OpenSpec strict 校验、限定范围 `git diff --check` 和浏览器实页检查；列表与详情不出现测试绝对路径，复制内容已脱敏，编辑输入仍为原文。
  验证结果（2026-08-06）：共享 utility 已由 Chat 回答、Chat 执行事件和记忆管理共同复用；三个 Tab、私有/共享详情及复制正文使用只读脱敏投影。双宿主 Vite 构建、change strict、全量 OpenSpec 273/273 通过；本地实页交互无回归，现有数据搜索无绝对路径样本且新增测试数据被 50 条个人设定上限拒绝，路径投影由 DOM、剪贴板和编辑表单回归测试完成实值验证。完整前端 TypeScript build 仍仅被既有 `processDetails.ts:1293` TS7022 阻断。

- [x] 9.82 先补充 Chat Markdown 与记忆纯文本对 `[REDACTED\_PATH]` 的可见结果一致性测试，以及记忆查看/复制规范化但编辑保留原值的回归测试，并确认当前记忆投影显示转义反斜杠而失败。
  来源：`FN-8.15 管理长期记忆` + 系统质量属性“安全” + Requirement“记忆只读展示必须与 Chat 使用相同敏感内容保护范围” + Scenario“Markdown 转义占位符与 Chat 显示一致” + design“本轮记忆管理问题修复设计”10。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/redaction-presentation-consistency.test.tsx tests/MemoryManagePage.test.tsx --reporter=dot`；实现前目标用例必须失败。
  验证结果（2026-08-06）：实现前一致性测试和记忆页面测试各 1 项失败；Chat Markdown 可见文本为 `[REDACTED_PATH]`，记忆列表、详情和正文仍包含 `[REDACTED\_PATH]`，复制路径尚未进入断言。失败证明两种渲染链路的占位符视觉不一致。

- [x] 9.83 在共享 `redactPathsInText` 展示 helper 中把 `[REDACTED\_PATH]` 规范化为 `[REDACTED_PATH]`，使 Chat、记忆列表、详情和剪贴板显示一致；记忆管理继续按纯文本渲染，编辑、导入导出及持久化保留原文。
  来源：`FN-8.15 管理长期记忆` + 系统质量属性“安全” + design“本轮记忆管理问题修复设计”10。
  验证：运行脱敏一致性与记忆页面定向测试、前端双宿主构建、OpenSpec strict 校验和 `git diff --check`。
  验证结果（2026-08-06）：共享 helper 已把 Markdown 转义占位符规范化为 canonical 占位符；Chat/Memory 可见文本一致，记忆列表、详情与剪贴板不再显示反斜杠，编辑表单仍保留原值。脱敏 helper、跨界面一致性、Chat 回归和记忆页面定向测试共 71/71 通过。

- [x] 9.84 先补充 Chat 与记忆对凭据赋值、Bearer/`sk-` Token、手机号、Private Key、路径和 IP 地址使用相同展示保护范围的回归测试，并确认当前记忆投影仍暴露路径以外的敏感值而失败。
  来源：`FN-8.15 管理长期记忆` + 系统质量属性“安全” + Requirement“记忆只读展示必须与 Chat 使用相同敏感内容保护范围” + design“本轮记忆管理问题修复设计”10。
  验证：在 `frontend/agent-web` 运行敏感展示 helper、Chat/Memory 一致性和 `MemoryManagePage` 定向测试；实现前新增目标用例必须失败。
  验证结果（2026-08-06）：实现前 75 项定向测试中新增目标用例 4 项失败；记忆列表和详情仍显示 `password=hunter2`、Bearer/`sk-` Token、手机号及完整 Private Key，仅绝对路径已替换，证明路径以外的 Chat 敏感类别尚未进入记忆只读投影。

- [x] 9.85 扩展共享展示 helper 覆盖 Chat 的凭据赋值、Token、手机号、路径和 Private Key 类别，保持 IP、URL、相对路径及编辑/导入导出/持久化原文不变；Chat 最终 Private Key 阻断继续由 runtime owner 负责。
  来源：`FN-8.15 管理长期记忆` + 系统质量属性“安全” + design“本轮记忆管理问题修复设计”10。
  验证：运行前端定向测试、双宿主构建、OpenSpec strict 校验、`git diff --check` 和模型语义检视。
  验证结果（2026-08-06）：共享 `redactSensitiveDisplayText` 已由 Chat 回答、Chat 事件详情和记忆管理共同使用；凭据、Token、手机号、路径和 Private Key 均使用规定占位符，IP、URL、相对路径及编辑原文保持不变。相关前端测试 138/138、限定 ESLint、双宿主 Vite 构建、change strict、全量 OpenSpec strict 273/273 和 `git diff --check` 通过；完整前端 TypeScript build 仍仅被未触达逻辑的既有 `processDetails.ts:1293` TS7022 阻断。

- [x] 9.65 完成本轮 change 严格校验、前端构建和模型语义审查；没有 P0/P1/P2 未处理问题。
  来源：proposal 目标与非目标 + design“本轮记忆管理问题修复设计”。
  验证：运行 `openspec validate add-ts-long-memory-manage --strict`、`openspec validate --all --strict`、前端定向测试、`npm run build`、`npm run build:vite:modes`、限定范围 `git diff --check`，并执行 `$nextagent-skill-review` 与 `$nextagent-code-review`，结论均为 `PASS`。
  验证结果（2026-08-06）：再次合入最新 `origin/main` 并解决记忆管理与收藏路由 OpenSpec 冲突后，change strict 与全量 OpenSpec strict（283/283）、前端 TypeScript build、双宿主 Vite build、根 workspace build、1657 项根测试、357 项 contract、281 项 architecture、161 项前端定向测试、9 项 NetAgent guard、5 项 REMOTE/Channel 定向测试和 `git diff --check` 均通过；主线 `TurnBlock.pinQuestion.test.tsx` 对只读 `userMessage` 的赋值已按不可变测试数据构造修复并通过 9 项回归。`nextagent-skill-review` 与 `nextagent-code-review` 结论均为 `PASS`，无 P0/P1/P2。
- [x] 9.86 先补充 `#/memory` 的可观察路由行为测试：覆盖 Immersive LEFT/RIGHT 入口导航、直达、刷新、重复选择、浏览器前进/后退，以及选择 session、新会话、收藏 turn 后恢复既有对话路径；在生产代码修改前运行并确认目标断言失败。
  验证：2026-07-30 在生产代码修改前运行 `npm test -- --run tests/local-favorites-navigation.test.tsx tests/immersive-routing.test.tsx`，目标路由断言按预期失败，包括专用 pathname 和浏览器历史恢复；实现后 `immersive-routing.test.tsx` 为 1 file / 16 tests passed，覆盖 LEFT/RIGHT 入口、直达和前进/后退恢复。

- [x] 9.87 将记忆管理收敛为 NextAgent Shell 拥有的 `/memory` hash pathname：LEFT/RIGHT 从 URL 派生唯一主内容和 active 反馈，保持常驻 chrome，收藏入口导航到 `/favorites`，投诉历史和最近历史继续使用临时 state；不得新增公共 API、共享 store、浏览器持久化键或绕过 Shell 的全屏记忆页面。
  验证：2026-07-30 前端定向回归为 3 files / 36 tests passed；定向 Playwright route journey 为 1 passed；前端 `npm run build` 与 `npm run build:vite:modes` 通过；`openspec validate add-ts-long-memory-manage --strict`、`openspec validate fix-agent-web-favorite-panel-navigation --strict` 和全量 strict validate（261 项）通过。真实 5174 页面确认 `#/memory` 显示记忆管理且常驻 Sidebar，切换 `#/favorites` 后记忆内容不再显示。

- [x] 9.90 回退 PR #942/#971 中强制获取真实宿主用户的规格和默认装配：移除 immersive/PIU 缺失用户时清空身份、REMOTE 默认 trusted-header resolver、`orgId`/`userId`/`userName` 优先级和 fail-closed 要求；保留产品显式注入 `webIdentityResolver`、路由拒绝 query/body 身份覆盖和发布 body 不携带身份字段的既有边界。
  来源：`FN-8.15 管理长期记忆` + Requirement“路由边界必须从可信身份解析器获得身份字段” + design“发布身份边界”。
  验证：OpenSpec 不再要求从宿主用户或特定 header 获取真实用户，`openspec validate add-ts-long-memory-manage --strict` 通过。
  验证结果（2026-08-07）：proposal、design、delta spec 和 tasks 已删除强制真实宿主用户、REMOTE 默认 trusted-header resolver、宿主 header 优先级和缺失时 fail-closed 语义；change strict 通过，全量 OpenSpec strict 289/289 通过。

- [x] 9.91 回退对应实现、公共导出、文档和测试：`AppProviders` 恢复既有默认身份投影；`agent-remote-deployment` 不再默认安装 resolver；`agent-app` 删除本轮新增的 public trusted-header factory，同时 `createTaskIdentityResolver` 保持原有 task header 行为。产品显式传入的 `webIdentityResolver` 仍可由既有 composition contract 使用。
  来源：design“发布身份边界” + PR #942/#971 identity-related diff。
  验证：前端 build、`agent-app`/`agent-remote-deployment` build、相关 Channel/REMOTE/architecture 测试、OpenSpec strict 和 `git diff --check` 通过。
  验证结果（2026-08-07）：实现前新增回归准确复现错误语义，REMOTE 定向测试 2/3 失败、前端身份测试 2/3 失败；回退后 REMOTE 3/3、Channel memory routes 9/9、前端身份 3/3、外部依赖 guard 9/9 通过。`agent-app`、`agent-remote-deployment`、前端 TypeScript、前端双宿主和根 workspace build 均通过；完整 architecture gate 46 files / 290 tests 通过。显式 `webIdentityResolver` 注入测试继续通过，发布 body、management/Gateway contract 未改变。

- [x] 9.92 先补充详情读取和编辑、设置或取消保持不变、归档、撤销归档、删除、发布或取消发布返回 HTTP 404 / `LTM_MEMORY_NOT_FOUND` 时显示本地化已删除提示、清理失效选择并刷新列表与 Tab 计数的前端失败回归；再让 `MemoryManagePage` 以稳定错误码/状态统一处理过期记录，不显示原始标识符消息，且不改变其它错误映射
  来源：`FN-8.15 管理长期记忆` + `已删除记忆的过期界面操作必须安全收敛` + “另一个页面删除后查看详情”“对已删除记录执行其它操作”；design“本轮记忆管理问题修复设计 / 过期记录失败收敛”
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/MemoryManagePage.test.tsx` 和 `npm run build`
  验证结果（2026-08-07）：生产代码修改前，详情读取和记录操作两条过期记录回归均失败；实现后 `MemoryManagePage` 58/58 定向测试和前端 TypeScript build 通过，404 / `LTM_MEMORY_NOT_FOUND` 统一显示中英文已删除提示并刷新当前列表与三个 Tab 计数，非过期错误映射保持通过；相关 OpenSpec strict 通过。
- [x] 9.93 补充远端记忆服务对已删除记录返回 `INVALID_BRAND_VALUE`（HTTP 400）时的过期记录失败回归：详情读取和记录操作均显示本地化已删除提示、清除失效选择并刷新列表与 Tab 计数，且不显示原始标识符消息
  来源：`FN-8.15 管理长期记忆` + `已删除记忆的过期界面操作必须安全收敛`；design“过期记录失败收敛”
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/MemoryManagePage.test.tsx` 定向测试和 `npm run build`
  验证结果（2026-08-08）：实现前两条 `INVALID_BRAND_VALUE` 定向回归失败；`isDeletedMemoryError` 并入该稳定错误码后，详情读取与记录操作定向测试通过，中英文已删除提示和列表/Tab 计数刷新与 404 / `LTM_MEMORY_NOT_FOUND` 一致，非过期错误映射保持通过；相关 OpenSpec strict 通过。

- [x] 9.94 先补充 Chat 回答和事件正文保留 Unix/Windows 绝对路径、记忆列表/详情/复制正文继续替换绝对路径的回归测试，并确认当前共享 helper 导致 Chat 目标用例失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“记忆只读展示必须扩展 Chat 通用敏感内容保护并单独隐藏绝对路径” + Scenario“Chat 正文保留绝对路径”“私有记忆列表和详情脱敏绝对路径”“复制使用脱敏内容而编辑保留原始内容”。
  验证：在 `frontend/agent-web` 运行 `npm exec vitest run tests/redactPathsInText.test.ts tests/answerContent.test.ts tests/processDetailsProjection.test.ts tests/MemoryManagePage.test.tsx --reporter=dot`；生产代码修改前 Chat 绝对路径目标断言必须失败，记忆目标断言必须继续通过。
  验证结果（2026-08-10）：生产代码修改前，Chat Workflow 终态回答与命令输出两条绝对路径保留断言失败，实际均显示 `[REDACTED_PATH]`；`MemoryManagePage` 67/67 通过，证明记忆路径保护有效但共享 helper 回退了 Chat 策略。

- [x] 9.95 从 Chat 与记忆共用的通用敏感内容 helper 中移除 `absolutePathPattern`，新增记忆只读投影专用的绝对路径处理并只由 `MemoryManagePage` 使用；保持通用凭据、Token、手机号、Private Key 与占位符规范化规则共享，保持 Chat 结构化安全路径字段、编辑、导入导出和持久化既有语义。
  来源：`FN-8.15 管理长期记忆` + design“本轮记忆管理问题修复设计”10。
  验证：运行前端定向测试、`npm run build`、`npm run build:vite:modes`、OpenSpec strict 校验和 `git diff --check`；Chat 回答和事件正文中的测试绝对路径保持原文，记忆列表、详情与剪贴板仍显示 `[REDACTED_PATH]`，编辑输入仍为原文。
  验证结果（2026-08-10）：通用 `redactSensitiveDisplayText` 不再应用绝对路径规则，记忆专用 `redactMemoryDisplayText` 先复用通用规则再替换绝对路径；Chat 结构化 `filePath` 投影保持既有安全截短。helper、Chat 回答、Chat 事件详情、记忆页面与跨渲染占位符测试共 187/187 通过；前端 TypeScript build、双宿主 Vite build、change strict 和 `git diff --check` 通过。全量 OpenSpec strict 中本 change 通过，仓库既有且未触达的 `fix-conversation-preview-validation`、`fix-session-list-validation`、`fix-share-validation-error-messages` 三个 active changes 仍失败。

- [x] 9.96 先补充共享复制结果的契约和可观察行为测试：Gateway 首次复制返回 `copyStatus=COPIED`，重复复制活动或归档 FORK 返回 `copyStatus=EXISTING`；Channel REST 保留该字段；前端首次复制进入“我的记忆”第一页，重复复制只显示对应 Tab 的提示并保持当前 Tab 和页码。
  来源：`FN-8.15 管理长期记忆` + Requirement“共享记忆库必须支持浏览、搜索、发布、取消发布和复制” + Scenario“复制共享记忆”“重复复制活动记忆”“重复复制已归档记忆”。
  验证：分别运行 local Gateway、memory application、Channel memory route、前端 service 和 `MemoryManagePage` 定向测试；生产代码修改前新增状态字段和分支行为断言必须失败。
  验证结果（2026-08-10）：生产代码修改前 local Gateway、memory application 和 Channel REST 三层新增断言均失败，实际结果缺少 `copyStatus`；前端新增用例覆盖 `COPIED`、活动 `EXISTING` 和归档 `EXISTING` 三条页面路径，测试选择器按现有“复制到我的记忆”可访问名称校正后纳入定向回归。

- [x] 9.97 在 Gateway 操作结果、management result、Channel REST 投影和前端 wire contract 中逐层增加必填 `copyStatus: COPIED | EXISTING`；`MemoryManagePage` 对 `COPIED` 重置到“我的记忆”第一页，对 `EXISTING` 按 `record.state` 显示本地化重复提示且不导航、不定位、不撤销归档。
  来源：`FN-8.15 管理长期记忆` + design“统一响应解包”的复制状态映射和页面行为矩阵。
  验证：运行 9.96 的全部定向测试、前端 TypeScript build、相关 package build 和 `git diff --check`；新增与重复复制的返回值及页面副作用必须分别符合矩阵。
  验证结果（2026-08-10）：local Gateway 与 memory application 定向回归 20/20、Channel route/schema 回归 12/12、前端页面/service/i18n 回归 87/87 通过；`agent-contracts`、`agent-memory`、`agent-channel-web`、`agent-platform-gateway-local` 和前端 TypeScript build 全部通过，双宿主 Vite build 与 `git diff --check` 通过。Gateway 在事务内生成状态，其余层只投影；重复复制不触发列表加载、导航或归档恢复。

- [x] 9.98 完成复制状态变更的 OpenSpec strict 校验和 `$nextagent-skill-review`，确认公共契约、Gateway/application/Channel 分层、前端行为和中英文提示一致且没有页码或索引定位字段。
  来源：proposal“目标与非目标” + design“统一响应解包” + OpenSpec 公共 contract schema 规则。
  验证：运行 `openspec validate add-ts-long-memory-manage --strict`、相关定向测试和模型语义检视；结论为 `PASS` 且无 P0/P1/P2 未处理问题。
  验证结果（2026-08-11）：同步最新 `origin/main` 后，change strict 与全量 OpenSpec strict 317/317 通过。`$nextagent-skill-review` 检查公共 contract、Function/spec 追踪、owner 边界、状态来源和测试证据后结论为 `PASS`，无 P0/P1/P2；用户已在本任务中明确确认 `agent-contracts` 的 `copyStatus` 枚举变更，未增加 `index`、页码或定位字段。

## 归档前更新基线检查（非实施任务）

归档前依据 proposal 和 design，将稳定的行为规范同步至 `openspec/specs/long-memory-web-management/spec.md`，并更新 `agent-web`、`agent-channel-web` 和 `spec-to-design-map` 的长期设计文档。
