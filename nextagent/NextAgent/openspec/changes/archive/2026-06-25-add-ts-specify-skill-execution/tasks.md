## 1. 后端 Contract 定义

- [x] 1.1 在 `agent-contracts/runtime` 新增 `SkillCatalogSummaryEntry`、`SkillCatalogQueryRequest`、`SkillCatalogQueryResult` 和 `SkillCatalogQueryPort` 类型定义
  验证：`npm run build` 通过；`agent-contracts` 导出新类型且 TypeScript strict 无错误
  来源：spec `web-skill-catalog` Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill；design D1、D2

- [x] 1.2 确认 `SkillCatalogQueryPort.listSkills` 接收 `AbortSignal` 参数
  验证：类型定义中 `listSkills(request: SkillCatalogQueryRequest, signal?: AbortSignal): Promise<SkillCatalogQueryResult>`；`npm run build` 通过
  来源：spec `web-skill-catalog` Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill；design D1

## 2. 后端 Web channel 路由实现

- [x] 2.1 在 `agent-channel-web` 新增 `GET /api/v1/skills` 路由，接受 `pageNum`、`pageSize`、`keyword` 查询参数，通过注入的 `SkillCatalogQueryPort` 查询并返回响应 DTO
  验证：Fastify inject 测试：默认分页返回 pageNum=1/pageSize=50；自定义分页返回正确切片；`npm run build` 通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询 API 端点

- [x] 2.2 在 `agent-channel-web` 新增查询参数 schema 和响应 DTO schema（TypeBox），包含 `total`、`pageNum`、`pageSize`、`skills` 数组，每个 skill summary 包含 `capabilityId`、`displayName`、`description`、`providerKind` 和可选 `version`
  验证：Fastify inject 测试：响应 JSON 符合 DTO schema；`npm run build` 通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询响应 DTO

- [x] 2.3 在 `WebChannelDependencies` 中新增 `skillCatalog: SkillCatalogQueryPort` 依赖
  验证：`npm run build` 通过；`agent-channel-web` 类型导出更新
  来源：spec `web-skill-catalog` Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill

- [x] 2.4 实现关键字模糊搜索逻辑：当 `keyword` 提供时，过滤 `displayName` 或 `capabilityId` 包含关键字子串（忽略大小写）的 Skill；空关键字等同于无关键字
  验证：contract test：keyword 匹配 displayName、匹配 capabilityId、无匹配返回 total=0、空关键字返回全部
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询关键字搜索

## 3. 后端 App Composition 实现

- [x] 3.1 在 `agent-app/src/composition/create-app.ts` 实现 `SkillCatalogQueryPort`，内部调用 `CapabilityCatalog.listAvailable()` 获取全部 SKILL descriptor，投影为 `SkillCatalogSummaryEntry[]`，执行关键字过滤和分页切片
  验证：`npm run build` 通过；composition 返回的 port 调用 `listAvailable` 后返回正确 DTO
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询的 Scope 与来源聚合；design D3、D4、D5

- [x] 3.2 将实现的 `SkillCatalogQueryPort` 注入 `registerWebChannel` 的 dependencies
  验证：`npm run build` 通过；Web channel 能通过注入的 port 响应 `GET /api/v1/skills`
  来源：spec `web-skill-catalog` Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill

## 4. 后端 Contract 测试

- [x] 4.1 编写 `GET /api/v1/skills` contract test：默认分页、自定义分页、非法参数（pageNum=0、pageSize=0、pageSize=200）返回 400
  验证：`npm test` -- skill-catalog contract test suite 通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询 API 端点

- [x] 4.2 编写响应 DTO 安全断言 test：响应不包含 `inputSchema`、`outputSchema`、`compatibility`、`metadata`、credential reference 或文件路径
  验证：`npm test` -- skill-catalog DTO 安全断言通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询响应 DTO

- [x] 4.3 编写 scope 和来源聚合 test：LOCAL 模式返回 `BUNDLED` + `LOCAL_DIRECTORY` Skill；disabled provider 的 Skill 不出现；未授权的 agent-owned Skill 不返回
  验证：`npm test` -- skill-catalog scope 聚合测试通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询的 Scope 与来源聚合

- [x] 4.3a 编写 builtin-skills 来源验证 test：LOCAL 模式下 `GET /api/v1/skills` 结果 MUST 包含 `providerKind=BUNDLED` 的 Skill（如 `telecom-domain-qa`）；builtin-skills 与 local Skill 同时出现在结果中
  验证：`npm test` -- builtin-skills 来源断言通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询的 Scope 与来源聚合；design D15

- [x] 4.3b 编写 agent-owned Skill 授权 test：`local-skills-agent-owned` provider 的 Skill 在未通过 agent-owned source authorization 时 MUST NOT 出现在结果中；授权通过时 MUST 出现在结果中
  验证：`npm test` -- agent-owned 授权场景断言通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询的 Scope 与来源聚合；design D16

- [x] 4.4 编写关键字搜索 test：keyword 匹配 displayName、匹配 capabilityId、无匹配、空关键字等同于无关键字
  验证：`npm test` -- skill-catalog keyword 搜索测试通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询关键字搜索

- [x] 4.5 编写安全 test：未认证请求返回 401；catalog unavailable 返回 503 safe error；错误响应不暴露 raw error 或 stack trace
  验证：`npm test` -- skill-catalog 安全测试通过
  来源：spec `web-skill-catalog` Requirement: Skill 列表查询安全与可观测

- [x] 4.6 编写 architecture test：`agent-channel-web` 不直接 import `agent-capability` 或 `CapabilityCatalog`/`AssemblyRegistry`
  验证：`npm run lint:architecture` 或 source-level import 断言通过
  来源：spec `web-skill-catalog` Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill；design D1

- [x] 4.7 编写取消安全 test：客户端断开连接时 `AbortSignal` 被 abort，查询安全终止
  验证：`npm test` -- skill-catalog cancel 测试通过
  来源：spec `web-skill-catalog` Requirement: Web channel 通过 SkillCatalogQueryPort 查询 Skill

## 5. 后端 REMOTE 模式验证

- [x] 5.1 在 test composition 中验证 REMOTE deployment mode 下 Skill 列表 API 返回 `BUNDLED` + `LOCAL_DIRECTORY` + `SKILL_HUB` Skill 之和
  验证：`npm test` -- REMOTE 模式 skill-catalog 测试通过（需 REMOTE 模式 test composition 或 mock）

## 6. 前端 Skill 选择栏组件

- [x] 6.1 实现 Skill 选择栏组件，渲染在输入框上方 16px 处，宽度与输入框齐平；无可用 Skill 时不渲染
  验证：前端组件测试：有 Skill 时渲染栏且宽度匹配；无 Skill 时不渲染且无空白间距
  来源：spec `skill-selector-ui` Requirement: Skill 选择栏组件位置

- [x] 6.2 实现 Skill chip 单行渲染逻辑：尽可能多地渲染 chip，溢出时行末显示"全部"按钮，不溢出时不显示
  验证：前端组件测试：Skill 少时全展示无"全部"按钮；Skill 多时显示"全部"按钮且未展示的不出现
  来源：spec `skill-selector-ui` Requirement: Skill 栏 Chip 展示行为

- [x] 6.3 实现 chip hover tooltip 展示 Skill `description`
  验证：前端组件测试：悬浮 chip 时显示 description tooltip
  来源：spec `skill-selector-ui` Requirement: Skill 栏 Chip 展示行为

- [x] 6.4 实现 chip 统一中性色和选中色：未选中态使用 `--color-composer-border`/`--color-composer-bg`/`--color-text-secondary`，选中态使用 `--color-bg-active`/`--color-primary`；MUST NOT 按 index 分配色彩
  验证：前端组件测试：所有未选中 chip 颜色一致；选中 chip 使用 active/primary 色
  来源：spec `skill-selector-ui` Requirement: Skill 栏 Chip 展示行为；design D9

- [x] 6.5 实现 chip 最大宽度 400px 和 `flexShrink: 0`：防止超长名称撑开容器，防止 flex 压缩导致测量失真
  验证：前端组件测试：超长名称 chip 被截断；chip 不被 flex 压缩
  来源：spec `skill-selector-ui` Requirement: Skill 栏 Chip 展示行为；design D11

- [x] 6.6 实现"全部"按钮流式排列：不使用 `marginLeft: auto`，跟随 chip 排列
  验证：前端组件测试：全部按钮与最后一个 chip 保持相同 gap
  来源：spec `skill-selector-ui` Requirement: Skill 栏 Chip 展示行为；design D12

## 7. 前端全部 Skill Modal

- [x] 7.1 实现"全部"Modal 组件：328px 宽，右下角与"全部"按钮右上角右侧对齐，标题"全部skill"，包含搜索框和可滚动 Skill 列表
  验证：前端组件测试：Modal 宽度、定位、标题正确
  来源：spec `skill-selector-ui` Requirement: 全部 Skill 列表 Modal

- [x] 7.2 实现 Modal 高度限制：最小高度和最大高度，超出时列表垂直滚动
  验证：前端组件测试：Skill 少时不低于最小高度；Skill 多时不超过最大高度且出现滚动条
  来源：spec `skill-selector-ui` Requirement: 全部 Skill 列表 Modal

- [x] 7.3 实现 Modal 搜索防抖（300ms）和服务端关键字搜索（调用 `GET /api/v1/skills?keyword=xxx`）
  验证：前端组件测试：连续输入不立即发请求；停止后 300ms 发起请求
  来源：spec `skill-selector-ui` Requirement: Modal 搜索与分页加载；design D7

- [x] 7.4 实现无限滚动分页加载：滚动到底部时请求下一页（pageSize=50），结果追加到列表；关键字变化时重置到第 1 页
  验证：前端组件测试：滚动到底部加载下一页且无重复；关键字变化清空列表并重置 pageNum
  来源：spec `skill-selector-ui` Requirement: Modal 搜索与分页加载

- [x] 7.5 实现 Modal 关闭逻辑：点击外部或 Escape 关闭，关闭后不清除已选中 Skill
  验证：前端组件测试：点击外部关闭 Modal；Escape 关闭 Modal；关闭后选中 chip 仍存在
  来源：spec `skill-selector-ui` Requirement: 全部 Skill 列表 Modal

- [x] 7.6 实现 Modal 打开时自动聚焦搜索输入框
  验证：前端组件测试：Modal 打开后搜索框获得焦点
  来源：spec `skill-selector-ui` Requirement: 全部 Skill 列表 Modal；design D10

- [x] 7.7 实现 Modal 标题字号 14px 和标题与搜索框 12px 间距
  验证：前端组件测试：标题字号和间距符合 spec
  来源：spec `skill-selector-ui` Requirement: 全部 Skill 列表 Modal

- [x] 7.8 实现 Modal 列表项无左侧色条和统一选中色
  验证：前端组件测试：列表项无 borderLeft；选中项使用 `--color-bg-active`/`--color-primary`
  来源：spec `skill-selector-ui` Requirement: 全部 Skill 列表 Modal；design D9

- [x] 7.9 实现 Modal 键盘导航：ArrowUp/ArrowDown 循环移动焦点，Enter 确认选择，焦点项自动滚动到可视区域
  验证：前端组件测试：ArrowDown 移到下一项并循环；ArrowUp 移到上一项并循环；Enter 选中并关闭 Modal；空列表时无效
  来源：spec `skill-selector-ui` Requirement: Modal 键盘导航；design D10

## 8. 前端选中 Skill Chip 与请求集成

- [x] 8.1 实现选中 Skill 后在输入框内显示圆角 chip（带 x 按钮），位于输入文字前方，不遮挡输入功能
  验证：前端组件测试：选中后显示 chip；chip 在文字前方；输入功能正常
  来源：spec `skill-selector-ui` Requirement: 选中 Skill 在输入框内展示

- [x] 8.2 实现选中替换逻辑：同一时间最多一个 chip，选中新 Skill 替换旧 Skill
  验证：前端组件测试：选中第二个 Skill 后 chip 更新，只有一个 chip
  来源：spec `skill-selector-ui` Requirement: 选中 Skill 在输入框内展示

- [x] 8.3 实现 x 按钮取消选中：点击 x 后 chip 消失，state 置 null
  验证：前端组件测试：点击 x 后 chip 消失，state 为 null
  来源：spec `skill-selector-ui` Requirement: 选中 Skill 在输入框内展示

- [x] 8.4 实现请求集成：选中 Skill 时提交 body 包含 `routingConstraints: { targetSkill: "<capabilityId>" }`；未选中时 body 不包含 `targetSkill`
  验证：前端组件测试 + E2E：选中提交 body 含 targetSkill；未选中提交 body 不含 targetSkill
  来源：spec `skill-selector-ui` Requirement: Skill 选中状态与请求集成

- [x] 8.5 实现提交后 state 保持：提交请求后选中 Skill state 保持不变，后续请求继续携带 targetSkill
  验证：前端组件测试：提交后 state 不变，后续请求仍携带 targetSkill
  来源：spec `skill-selector-ui` Requirement: Skill 选中状态与请求集成

- [x] 8.6 清理 `skillColors.ts` 和 `skillSelectionStore.colorIndex` 的 dead code：确认 `getSkillColorScheme` 和 `colorIndex` 不被产品路径调用，移除或标注为 deferred
  验证：diff 检查无未使用 import/函数/变量；`rg getSkillColorScheme` 确认无产品路径调用
  来源：AGENTS.md 实现质量门禁；design D9

- [x] 8.7 `statusFor` 全局错误映射扩展作为 Web error contract 变更：新增 `UNAVAILABLE -> 503` 和 `LOCAL_AUTH_REQUIRED -> 401` 映射；`UNAVAILABLE -> 503` 会改变现有 attachment 路由的错误状态码（400->503）
  验证：后端测试套件全量通过；现有路由的 `UNAVAILABLE` 错误（如 attachment）在新映射下返回 503 而非 400；新增 regression test 覆盖现有路由的 UNAVAILABLE 场景
  来源：design D14

- [x] 8.8 确认 `WebChannelRegistrationContext` 新增 `catalog` 和 `assemblyRegistry` 字段不影响现有 composition 路径
  验证：后端测试套件全量通过
  来源：design D13

## 9. 验证和收尾

- [x] 9.1 运行全量后端验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 全部通过
  验证：所有命令退出码 0
  来源：design 验证映射

- [x] 9.2 运行 OpenSpec 验证：`openspec validate --all --strict` 通过
  验证：命令退出码 0
  来源：AGENTS.md 验证门禁

- [x] 9.3 运行前端验证：前端组件测试和 E2E 测试通过
  验证：前端测试套件退出码 0
  来源：design 验证映射

- [x] 9.4 清理实现产生的临时 fixture、debug logging 或重复 schema
  验证：diff 检查无临时 fixture、debug logging 或重复实现
  来源：AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/web-skill-catalog/spec.md` 和 `openspec/specs/skill-selector-ui/spec.md`。
- 按需更新 `openspec/overview.md`。
- 按需更新 `openspec/designs/architecture/web-channel-api-surface.md`。
- 按需更新 `openspec/designs/modules/agent-channel-web.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
