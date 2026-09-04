# FN-8.15 管理长期记忆

> 能力域 D8 数据与记忆 · 子域 [D8.2 记忆](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-8.2](../../../features/D8-数据与记忆/D8.2-记忆/F-8.2-长期记忆.md) |
| 主规格 | `memory-core`（管理端口与批量新增 canonical）、`long-memory-web-management`（Web 管理投影） |
| 遗留规格 | `long-term-memory-management-contract` |
| 接口 | immersive/PIU Shell 内记忆管理内容区；`/api/v1/memory/long-term-mem` 下 13 个公开管理端点（含批量新增） |

## 描述

系统在 immersive/PIU 的 NextAgent Shell 内提供长期记忆管理内容区，使可信用户可以浏览、搜索、创建、编辑、归档、撤销归档、删除个人记忆，并管理共享记忆库（发布、取消发布、复制）。记忆管理复用 Shell 导航、主题与语言链路，不绕过 Shell；后端路由层委托 `LongTermMemoryManagementPort`，身份字段来自可信 channel/auth identity resolver，客户端输入不得覆盖身份或 Agent 归属。

## 前置条件

- 用户已通过可信宿主与 Channel 身份边界形成 Owner Scope，应用已选择 Agent Scope 和记忆实例。
- `LongTermMemoryManagementPort` 已由 composition root 装配并注入 Web Channel。
- immersive/PIU 模式运行；local 模式不暴露记忆管理入口。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 列表/搜索/分页条件 | 是 | `state`、`memoryType`、`knowledgeSourceType`、`isPinned`、`queryText`（≤128 Unicode code point）、`limit`/`offset` |
| 手工记忆内容 | 是 | `memoryType`、`confidence`（0..1 最多两位小数）、`briefIndex`（1..2048）、`content`（1..4000）、`labels`（≤10，每个 1..256） |
| 批量新增条目 | 批量时 | 1 至 100 个条目，每条含 `memoryType`、`knowledgeSourceType`、`briefIndex`、非空 `content`，可选 `memoryId`、`labels`、`confidence`（缺省 `1`）、`source`、`idempotencyKey`、`state`（缺省 `ACTIVE`）、`archiveReason`；条目不得携带可信 scope 字段 |
| 状态变更 | 是 | PATCH 字段组：`isPinned` 或 `targetState`+`archiveReason`，可选 `expectedVersion` |
| 共享操作 | 是 | 发布/取消发布/复制命令；`memoryInstance` 非身份字段 |

## 输出

- 三个 Tab（我的记忆/共享记忆库/已归档）的未过滤总数、分页列表、管理详情与操作反馈。
- 摘要和正文的只读投影不暴露宿主绝对文件路径（`[REDACTED_PATH]`）；Chat 正文保留绝对路径。
- Web API 输出公开 DTO 或 `LtmError { code, message, retryable }`，不泄漏 Gateway Record。
- 批量新增返回 `successCount`、`failCount` 和按输入处理顺序排列的成功 `memoryIds`，且 `successCount + failCount` 等于输入条目数、`memoryIds.length` 等于 `successCount`。
- 共享知识管理结果保留 required `ownerUserId`（稳定 `ownerSubjectId`），并为已解析发布者提供 optional `ownerUserName`（1..256 个 Unicode code point）；用户查询普通失败或用户缺失时省略 `ownerUserName` 并回退显示 `ownerUserId`，取消时终止管理请求。

## 处理过程

1. Shell 从 hash pathname `#/memory` 派生记忆主内容选择，保持 Sidebar/顶栏常驻，只替换主内容区为 `MemoryManagePage`；URL 不写入浏览器存储或后端。
2. 三个 Tab 分别调用 `listLongTermMemory`（ACTIVE/ARCHIVED）或 `listPublishedLongTermMemory`（共享），使用服务端 `total`/`limit`/`offset` 分页；`queryText` 由后端在分页前过滤摘要、正文和标签。
3. 选择记忆时调用 `GET /{memoryId}/record`（不记录访问）加载完整记录；`accessCount` 只在详情展示，列表查询不产生统计副作用。
4. 新增和编辑调用 `manualSaveLongTermMemory`（POST `/manual`），在同一次持久化写入中保存类型、置信度、摘要、正文和标签；创建前查询 ACTIVE+ARCHIVED 的 `CONFIGURED` 总数，超过 50 条拒绝写入，Gateway 事务内重复校验。
8. 批量新增 `batchCreateLongTermMemory` 对未携带 `memoryId` 的 `CONFIGURED` 条目按输入顺序执行 50 条容量预检：被拒条目计入 `failCount` 且不进入持久化调用，count 查询失败整批安全失败，无新增 `CONFIGURED` 条目的批次不做预检查询；容量执法不依赖单一持久化 gateway 实现的自愿行为（REMOTE 超剩余额度的导入条目同样被拒绝）。
5. 状态变更使用 PATCH 按字段组执行：保持状态 `isPinned`、归档 `targetState`+非空 `archiveReason`、撤销归档 `targetState=ACTIVE` 不发送 `archiveReason`。
6. 发布创建独立 SHARED 副本，前端用 `publishedMap` 追踪；取消发布用副本 ID；FORK 副本不允许再次共享。
7. 记忆只读展示在 Chat 通用敏感内容规则后单独应用绝对路径脱敏，再执行 JSON 格式化；复制使用脱敏后的原始 content。
8. 已删除记录的操作返回 404/`LTM_MEMORY_NOT_FOUND`/`INVALID_BRAND_VALUE` 时，显示本地化已删除反馈，清除失效选择并刷新列表与计数。
9. 批量新增调用 `POST /api/v1/memory/long-term-mem/batch`，服务端先整体校验 `items` 数量（1..100）和字段 allowlist，再以 trusted resolver 构造唯一可信 scope，最后按输入顺序逐条执行内容安全准入、50 条 `CONFIGURED` 容量校验和幂等写入；单项失败只计入 `failCount` 并继续后续条目，请求级 schema/scope 错误或存储不可用使整批安全失败，取消时停止处理未开始条目。
10. 共享知识列表查询成功后，对当前页面去重后的发布者标识以可信 `tenantId`、`subjectId` 和当前 `AbortSignal` 调用一次 `UserQueryGateway.queryUsers`；成功时为命中项投影 `ownerUserName`，普通 `SafeError` 或用户缺失时省略用户名并保持页面可用，category 为 `CANCELED` 时返回取消结果。空页面不发起用户查询。列表和详情优先显示 `ownerUserName`，缺失时显示 `ownerUserId`。

## 结果

- 合法操作产生可核对的记忆状态或共享结果。
- 非法输入、容量超限（50 条）、内容安全拒绝（`LTM_CONTENT_GUARD_BLOCKED`）、并发冲突和依赖失败以本地化反馈或安全错误结束。
- 不允许跨 Owner Scope 或 Agent Scope 读取和写入。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Shell 内内容视图 | `#/memory` 由既有 Shell 承载，不绕过 Shell；LEFT 保持 Sidebar、RIGHT 保持顶栏；local 模式不暴露 | `long-memory-web-management`：`长期记忆管理必须复用 immersive NextAgent Shell` |
| 布局适配 | 只拥有 Shell 主内容区；`1160px` 断点并排/纵向；标题与 Chat 同形；字号只使用 12/14/16px；无指标卡 | `long-memory-web-management`：`记忆管理布局必须适配 Shell 内容区` |
| 主题与语言 | 复用 immersive `HostSiteContext`/`AppProviders`，跟随 `site.theme`/`site.locale`，不建独立切换 | `long-memory-web-management`：`记忆管理必须跟随 immersive 宿主主题和语言` |
| 反馈定位 | Shell 提供 Ant Design `App` context message，顶部偏移=主内容区 `getBoundingClientRect().top + 12px` | `long-memory-web-management`：`记忆操作反馈必须避开常驻 Shell 顶部区域` |
| 后端路由委托 | 13 个 REST 端点（含批量新增）委托 `LongTermMemoryManagementPort`，不直接调用 Gateway；依赖缺失不注册 | `memory-core`：`长期记忆管理提供唯一 Channel 端口`、`long-memory-web-management`：`后端 HTTP 路由必须委托给记忆管理端口` |
| 身份可信来源 | identity resolver 提供 `IdentityContext`，`agentId` 来自 hosted-Agent selection；query/body 身份字段返回 4xx；`subjectId`→`userId` Web alias | `long-memory-web-management`：`路由边界必须从可信身份解析器获得身份字段` |
| SafeError 映射 | `LTM_MEMORY_NOT_FOUND`→404、`LTM_STORAGE_UNAVAILABLE`→500、`UNAVAILABLE`→503、其它→400；成功 `{ errorCode:0, errorMsg:"SUCCESS", data }` | `long-memory-web-management`：`SafeError 必须映射为 LtmError 和确定的 HTTP 状态` |
| 列表搜索分页 | `queryText` ≤128 Unicode code point，后端分页前过滤；Ant Design 分页器+首页/尾页/页码跳转/10·20·50 页大小 | `long-memory-web-management`：`记忆列表必须支持筛选、搜索和分页` |
| 详情统计 | `GET /{memoryId}/record` 不记录访问；`accessCount` 只在详情展示；JSON 正文结构化展示；复制用脱敏原始 content | `long-memory-web-management`：`记忆详情必须展示智能体使用统计且不产生统计副作用` |
| 只读敏感内容 | 复用 Chat 凭据/Token/手机号/Private Key 类别；记忆单独隐藏绝对路径；Chat 正文保留绝对路径；IP/相对路径/URL 保持原文 | `long-memory-web-management`：`记忆只读展示必须扩展 Chat 通用敏感内容保护并单独隐藏绝对路径` |
| 手工保存 | `manualSaveLongTermMemory` 原子保存类型/置信度/摘要/正文/标签；置信度 0..1 最多两位小数；`isPinned` 不可设置 | `long-memory-web-management`：`用户创建和编辑必须使用手工保存端点` |
| 个人设定容量 | 同一可信 scope+memoryInstance 下 ACTIVE+ARCHIVED 的 `CONFIGURED` 记忆合计最多 50 条，不区分 `memoryType`；归档不释放额度 | `long-memory-web-management`：`用户创建和编辑必须使用手工保存端点` |
| 批量新增边界 | 每批 1 至 100 条；未知字段、空批次或超 100 条在处理前整体拒绝；`confidence` 缺省 `1`、`state` 缺省 `ACTIVE` | `memory-core`：`长期记忆批量新增保持逐项准入和结果可核对` |
| 批量部分成功 | 单项校验、内容安全、容量或写入失败只计入 `failCount`，不阻止后续条目；请求级 scope/取消/存储不可用使整批安全失败 | `memory-core`：`长期记忆批量新增保持逐项准入和结果可核对`、`Management 调用使用可信 Scope 和取消上下文` |
| 管理端口 operation 集合 | `LongTermMemoryManagementPort` 精确定义 13 个 operation（save/list/batch create/manual save/get/delete/mutate/search/detail/publish/unpublish/list published/copy published），不增加 count/batch delete 等别名 | `memory-core`：`长期记忆管理提供唯一 Channel 端口` |
| composition 启用管理边界 | `agent-app` 是唯一 composition owner；selected Gateway bindings 可用且 application service 构造成功时才向 Web Channel 注入 management port，否则不回退直连 | `memory-core`：`Management Boundary 由 Composition 显式启用` |
| 共享按钮状态 | `publishedMap` 追踪原记忆→副本 ID；FORK 副本禁用共享按钮 | `long-memory-web-management`：`详情区共享按钮必须反映发布状态` |
| PATCH 字段组 | 保持状态 `isPinned`、归档 `targetState`+非空 `archiveReason`、撤销归档 `targetState=ACTIVE` 不发 `archiveReason` | `long-memory-web-management`：`PATCH 端点必须按字段组执行变更` |
| 共享库 | 浏览/搜索/发布/取消发布/复制；复制 `data` 直接为数组；`copyStatus=COPIED|EXISTING` 区分新建与既有 FORK；新建进入“我的记忆”第一页，既有仅提示对应集合且不定位 | `long-memory-web-management`：`共享记忆库必须支持浏览、搜索、发布、取消发布和复制` |
| 已删除收敛 | 404/`LTM_MEMORY_NOT_FOUND`/`INVALID_BRAND_VALUE` 显示本地化已删除反馈，刷新列表与计数 | `long-memory-web-management`：`已删除记忆的过期界面操作必须安全收敛` |
| composition 装配 | `create-app.ts` 用 Gateway bindings 调 `agent-memory` factory，把 management port 传给 Channel；Channel 不接收 Gateway bindings | `long-memory-web-management`：`记忆管理端口必须由 composition root 完成装配` |
| 共享知识发布者展示 | 管理结果保留 required `ownerUserId` 并提供 optional `ownerUserName`；用户名可用时优先显示，查询失败或缺失时回退 `ownerUserId`；LOCAL 默认用户名为 `${ownerUserId}-name`；用户查询普通失败不阻断共享内容，取消终止管理请求；Web response 不暴露原始查询错误 | `long-memory-web-management`：`共享知识展示发布者用户名` |
