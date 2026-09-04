## Why

长期记忆的 gateway contract 已在 `agent-contracts/gateway` 中定义（`LongTermMemoryStoreGateway` 6 方法、`LongTermMemoryRetrieverGateway` 2 方法、`LongTermMemorySharingGateway` 4 方法，共 12 个操作）。远端环境基于 V2 API 提供完整的长期记忆管理接口。但目前 `agent-channel-web` 没有暴露任何 memory 管理的 HTTP 路由，前端也没有可在 NextAgent 现有应用外壳内使用的记忆管理内容区。用户需要在保留现有导航外壳的前提下浏览、搜索、创建、编辑、归档、删除长期记忆，以及管理共享记忆库（发布、取消发布、复制），避免进入记忆管理时丢失左侧菜单和当前会话导航上下文。

当前管理界面还存在可观察缺陷：共享与归档 Tab 缺少数量、分页不能直接指定页码、更新方式筛选值被箭头遮挡、置信度输入可用超长小数绕过前端校验、撤销归档发送空 `archiveReason` 被后端拒绝，以及英文 `User preference` 在表格和详情顶部换行、自绘分页器文案过多、界面混用 `13px` 非标准字号。初次单行修复后，英文详情顶部的类型/状态标签组与置信度仍会因右侧卡片过窄而分成两行；表格摘要列占比过大，置信度等信息列和进度条过窄。记忆列表和详情还会直接展示摘要、正文中的宿主绝对文件路径。Chat 正文当前明确保留绝对路径，但记忆路径保护接入后，Chat 回答和事件正文也被错误替换，导致既有 Chat 展示策略回退。多个管理页面同时打开时，一处删除记忆后，另一处基于旧列表继续读取详情或执行操作还会暴露底层标识符错误。这些问题会降低日常记忆治理效率，并可能导致用户无法完成合法操作或在界面中暴露宿主路径。

## 目标与非目标

- 三个 Tab 均显示各自未过滤全集的总数；分页器支持首页、尾页、标准页码、指定页跳转和每页 `10 / 20 / 50` 条选择，完整分页控件在列表底部整体居右，并继续使用服务端 `limit/offset`；筛选控件完整显示当前值；英文详情顶部的类型/状态标签与置信度保持同一行，表格列宽均衡且置信度进度条清晰可辨；记忆页字号只使用 `12px`、`14px` 或 `16px`。
- 手工保存置信度只接受 `0`、`1` 或最多两位小数的 `0..1` 值；撤销归档可成功恢复活动状态。
- 记忆发布复用 Web Channel 已配置的身份边界形成 `IdentityContext`；客户端不得通过发布 body 提交或覆盖身份字段。本 change 不规定 REMOTE 部署必须从宿主用户或特定请求头获取真实用户信息，也不新增记忆专用身份链路。
- 记忆摘要和正文的只读展示与 Chat 使用同一敏感内容保护范围；列表、详情和复制正文不得暴露凭据赋值、Bearer/`sk-` Token、手机号、Private Key 或 Unix/Windows 绝对文件路径，IP 地址继续按电信网络业务内容保留，编辑和持久化内容保持原值。
- 多页面并发操作导致当前列表项已被删除时，详情及该记录上的后续操作显示本地化“该记录已被删除”反馈，并刷新当前列表，不暴露底层标识符校验消息。
- 共享复制结果明确区分新创建与既有副本；新创建后进入“我的记忆”第一页，既有副本只提示其位于“我的记忆”或“已归档”，不执行分页定位、重复创建或自动撤销归档。
- 本次不新增用户目录、`UserProfileRecord`、发布者昵称公共 DTO 或 Gateway 字段；其他用户的展示名称查询留待独立用户画像能力定义。

## What Changes

- 新增前端 `MemoryManagePage` 内容区，在 immersive/PIU 的现有 NextAgent shell 内展示；使用 Shell 内部 hash 内容路径 `#/memory` 支持直达、刷新和浏览器历史恢复，但不新增绕过 Shell 的独立全屏页面。
- 新增 `memoryService.ts` 服务层，封装 12 个 V2 API 端点调用，响应统一解包 `{ errorCode, errorMsg, data }`。
- 在 `ImmersiveApp.tsx` 中由 shell-owned hash pathname 在聊天内容与记忆管理内容之间切换；默认 LEFT 布局保持 Sidebar 常驻，RIGHT 布局保持既有顶栏常驻，点击记忆入口导航到 `#/memory` 并只替换主内容区；收藏与记忆管理入口使用各自内容路径且保持互斥，选择会话、新会话、收藏 turn 或搜索结果时返回既有对话路径。
- 页面采用适配 NextAgent 主内容区的响应式布局，包含与 Chat 首页同形的简洁标题和分隔线、三个 Tab（我的记忆、共享记忆库、已归档）、列表、搜索、筛选、分页、详情查看、CRUD 和共享管理；桌面并排布局中，列表数据行与详情卡片分别在内容超过可用高度时独立纵向滚动，Tab、筛选、表头和分页器保持可见，不把滚动传递给页面外层；不展示独立品牌图标或无接口支撑的指标卡。
- 记忆管理内容区复用 Chat 在 immersive 中的宿主主题和语言传播链路：跟随 `site.theme` 动态切换明暗主题，跟随 `site.locale` 动态切换简体中文和英文；不新增页面内独立切换状态或设置入口。
- Chat 与记忆继续使用相同的凭据赋值、Token、手机号、Private Key 和历史占位符规范化等通用敏感内容保护；Unix/Windows 绝对文件路径仅在记忆只读展示和复制中替换为 `[REDACTED_PATH]`，Chat 回答和事件正文保留绝对路径。IPv4/IPv6、相对路径和 URL 保持不变，编辑、导入导出及持久化数据不被改写。
- 三个 Tab 分别展示“我的记忆”“共享记忆库”“已归档”的未过滤总数；新增、导入、删除、归档、撤销归档及共享关系变更成功后自动刷新计数。分页器支持首页、尾页、标准页码、上一页/下一页、指定页跳转及每页 `10 / 20 / 50` 条选择；更新方式筛选控件为选中值和原生下拉箭头预留足够宽度。
- 由 LEFT/RIGHT Shell 布局提供基于 Ant Design `App` context 的反馈消息实例，按照主内容区的实际 viewport 顶部定位；记忆页不再调用静态全局 `message`，避免 RIGHT 顶栏遮挡成功、警告和错误提示。
- 新增后端 HTTP 路由层 `agent-channel-web/src/routes/memory.ts`，在 `/api/v1/memory/long-term-mem` 下注册 12 个 REST 端点，将前端请求委托给 `agent-contracts/channel` 的 `LongTermMemoryManagementPort`。Channel 不直接调用长期记忆 Gateway。
- 在 `WebChannelDependencies` 中新增可选 `longTermMemoryManagement` 依赖，通过 `WebChannelRegistrationContext` 由 `agent-app` 传递 management port。
- REST wire type 与远端 V2 API YAML 字段对齐：Channel 将可信 `IdentityContext.subjectId` 投影为 REST alias `userId`；`SafeError` 映射为 `LtmError { code, message, retryable }`。
- 前端类型 `contracts.ts` 对齐公开管理视图：`sourceMemoryId`、`lastAccessedAt` 为可选字段，不复用或泄漏 Gateway Record。
- 收敛管理交互与接口约束：手工新增和编辑均允许用户选择 `memoryType` 并设置 `confidence`；新增表单默认 `memoryType=USER_CHARACTERISTICS`、`confidence=1`、`knowledgeSourceType=CONFIGURED`，编辑表单回显已有类型和置信度，并在保存时保留记录原有 `knowledgeSourceType`。类型与置信度控件在双列表单中使用相同的显式高度和盒模型，保持垂直对齐。`POST /manual` 在同一次持久化写入中保存类型、置信度、摘要、正文和可选标签，不补发 PATCH；置信度只接受 `0`、`1` 或最多两位小数的 `0..1` 值。标签允许为空且最多 10 个；摘要、正文和单个标签按公开接口长度约束校验并展示中英文提示；同一可信用户、Agent 和记忆实例下最多存在 50 条来源为 `CONFIGURED` 的个人设定记忆，不区分记忆类型，活动和归档状态均占用额度。新增时 management service 先查询当前数量，若 `当前数量 + 1 > 50` 则拒绝写入；Gateway 在持久化事务内重复校验以防并发绕过；Channel 返回 HTTP 400。前端识别确定的容量错误和 `LTM_CONTENT_GUARD_BLOCKED` 安全护栏拒绝，使用当前 locale 的友好提示，不直接显示后端英文诊断消息。非法请求稳定返回 4xx，不得被包装为 500。
- 撤销归档时只发送 `targetState=ACTIVE` 和 `expectedVersion`，不发送空 `archiveReason`；记忆发布使用 Web Channel 已配置的 `IdentityContext`，发布 body 不新增身份或画像字段。
- 管理详情使用不记录使用行为的 `GET /{memoryId}/record`；列表摘要接口继续返回当前 `accessCount`，但“我的记忆”和“已归档”表格不展示或消费该字段，访问统计只在详情中展示。列表和管理详情查询均不增加使用次数，`accessCount` 只由智能体实际使用记忆的链路维护；“我的记忆”“已归档”和“共享记忆库”搜索从 REST query 到管理查询统一使用 `queryText`，由后端在分页前过滤并返回搜索后的 `total`，不增加字段映射；公开 Web API 与搜索框统一以 128 个 Unicode code point 为可提交上限，超限时保留用户输入并显示中英文校验错误，不得进入 debounce 或请求；列表使用服务端 `limit`/`offset` 分页；共享复制响应的 `data` 直接使用结果数组，每项通过 `copyStatus=COPIED|EXISTING` 区分新建与既有 FORK，重复复制返回既有 FORK 而不新增记录；FORK 副本不允许再次共享；移除置信度筛选。
- 详情读取或基于旧列表项的操作返回 HTTP 404 / `LTM_MEMORY_NOT_FOUND` 时，前端统一显示中英文已删除提示，清除失效选择并刷新当前列表与三个 Tab 计数；其它错误保持既有安全映射。

## Function 影响（OpenSpec Capabilities）

### 新增 Function
- `FN-8.15 管理长期记忆`：对应主规格 `long-memory-web-management`，提供长期记忆列表、搜索、详情、CRUD、共享管理及可信用户归属；本轮补齐数量统计、指定页码跳转、输入边界、撤销归档、发布身份归属和记忆专用只读路径脱敏验收。系统质量属性为身份不可伪造、跨用户隔离、记忆界面宿主绝对路径不暴露与管理操作可靠可恢复。

### 修改的 Function
- 无。

## Feature 影响

- **修改** `F-8.2 长期记忆`：Function 组成增加 `FN-8.15 管理长期记忆`，使用户可以通过 Web 界面治理个人和共享长期记忆；既有检索、写入、提取和老化行为不变。

## 影响范围（Impact）

- `frontend/agent-web/src/pages/MemoryManagePage.tsx`：新增，作为 NextAgent shell 的记忆管理内容区。
- `frontend/agent-web/src/pages/MemoryManagePage.css`：新增，约束内容区自适应、内部滚动和列表/详情响应式布局。
- `frontend/agent-web/src/i18n/resources/zh-CN.ts`、`frontend/agent-web/src/i18n/resources/en-US.ts`：修改，新增记忆管理界面的中英文资源并保持 key 对齐。
- `frontend/agent-web/src/services/memoryService.ts`：新增，V2 API 调用封装。
- `frontend/agent-web/src/state/contracts.ts`：新增记忆相关的 TypeScript 类型定义。
- `frontend/agent-web/src/app/ImmersiveApp.tsx`：修改，在现有 shell 内通过 `/memory` hash pathname 选择记忆管理内容，并保持 `/shared/:shareId` 为唯一绕过 shell 的全屏路由。
- `frontend/agent-web/src/app/useShellFeedbackTop.ts`：新增，根据主内容区实际位置计算反馈消息顶部偏移，并在窗口或 Shell 尺寸变化后重新计算。
- `frontend/agent-web/src/features/sidebar/components/Sidebar.tsx`：修改，通过显式选择 callback 导航到记忆管理、收藏或会话内容，并展示由当前 pathname 派生的 active 状态；Sidebar 不持有平行的收藏或记忆主内容状态。
- `frontend/agent-web/src/services/apiClient.ts`：新增 `patch` 方法。
- `packages/agent-channel-web/src/routes/memory.ts`：新增，12 个 REST 端点委托给 `LongTermMemoryManagementPort`。
- `packages/agent-channel-web/src/schemas/memory-dto.ts`：修改，统一三个记忆搜索入口的 `queryText` 长度边界。
- `packages/agent-contracts/src/gateway/index.ts`、`packages/agent-contracts/src/channel/index.ts`：修改，列表摘要契约携带当前 `accessCount`。
- `packages/agent-memory/src/long-term-memory-management.ts`：修改，将 Gateway 列表摘要中的 `accessCount` 投影到管理视图。
- `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts`：修改，从长期记忆记录投影列表摘要的当前 `accessCount`。
- `packages/agent-channel-web/src/routes/requests.ts`：修改，新增 `longTermMemoryManagement` 依赖和路由注册调用。
- `packages/agent-channel-web/src/index.ts`：修改，导出 `registerMemoryRoutes`。
- `packages/agent-app/src/composition/composition-contracts.ts`：修改，`WebChannelRegistrationContext` 新增 `longTermMemoryManagement: LongTermMemoryManagementPort` 字段。
- `packages/agent-app/src/composition/channel-composition.ts`：修改，传递 `longTermMemoryManagement` 到 `registerWebChannel`。
- `packages/agent-app/src/composition/create-app.ts`：修改，使用 selected Gateway bindings 调用 `agent-memory` factory，只把 `LongTermMemoryManagementPort` 传入 Channel；`agent-app` 仅负责 composition/wiring。
