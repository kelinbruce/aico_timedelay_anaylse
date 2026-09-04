## 1. 内存模型与 Port 契约

- [x] 1.1 在 `agent-contracts/src/runtime/` 中新增 `CategoryQuestionPort`、`CategoryQuestionRequest`、`CategoryQuestionResult` 及相关 DTO 类型（`CategoryL1Dto`、`CategoryL2Dto`、`CategoryQuestionEntryDto`），DTO 不包含 hash 字段
  验证：`npm run build` 通过；`agent-contracts` 包导出新类型
  来源：spec category-question-api "分类问题查询响应 DTO"、design D4

- [x] 1.2 在 `agent-capability/src/local/` 中新增分类问题内存模型类型（`CategoryQuestionCatalog`、`CategoryL1`、`CategoryL2`、`QuestionEntry`），`QuestionEntry` 包含内部 `hash` 字段（SHA-256）
  验证：`npm run build` 通过；类型编译无错误
  来源：spec category-question-source "问题 Hash 内部标识"、design D3

## 2. JSONL 解析与校验

- [x] 2.1 在 `agent-capability/src/local/` 中实现 JSONL 解析器，读取 `category-question-{locale}.jsonl` 文件，逐行解析为内存模型。校验规则：`questions` 和 `records` 互斥；二级分类只有 `questions`，无 `records`；`question` 对象必须包含 `question` 和 `fixed` 字段。校验失败的单行跳过并产出 evidence
  验证：contract 测试覆盖正常解析、questions/records 同时非空、二级分类含 records、question 缺字段等场景
  来源：spec category-question-source "JSONL 文件结构与校验"

- [x] 2.2 实现 locale 规范化逻辑：BCP 47 locale → language part（小写）。`zh-CN` → `zh`，`en-US` → `en`。请求 locale 文件不存在时回退到 `zh`，`zh` 也不存在时返回空列表
  验证：单元测试覆盖 zh-CN、en-US、不存在的 locale、回退场景
  来源：spec category-question-source "Locale 规范化"

## 3. 资源发现与 Readiness Evidence

- [x] 3.1 在 `agent-capability/src/local/` 中实现 `CategoryQuestionResourceDiscovery`，复用 `AgentPackageSourceLocator` 定位 `{agentPackageRoot}/resource/` 目录，读取 JSONL 文件生成内存 Catalog。按 `agentId` + `locale` 维度组织，不同 agent 数据隔离
  验证：单元测试注入自定义 resourceRoot，验证 Catalog 加载和 agent scope 隔离
  来源：spec category-question-source "分类问题资源目录定位"、"内存 Catalog 与 Agent Scope 隔离"

- [x] 3.2 实现 readiness evidence 产出，包含 outcomeCode（`CATEGORY_QUESTION_SOURCE_UNAVAILABLE`、`CATEGORY_QUESTION_ENTRY_INVALID`、`CATEGORY_QUESTION_REGISTERED`）、`providerId`、`sourceScope`、`agentId`、`message`。通过 structured logging 记录，日志不包含问题文本
  验证：单元测试验证 evidence 产出；断言日志不包含 question 文本或 category 名称
  来源：spec category-question-source "Readiness Evidence 产出"

- [x] 3.3 Negative: 验证 resource 目录不存在时不抛异常、不阻断启动，产出 `CATEGORY_QUESTION_SOURCE_UNAVAILABLE` evidence
  验证：单元测试注入不存在的 resourceRoot，断言返回空 Catalog 且无异常抛出
  来源：spec category-question-source "分类问题资源目录定位" Scenario "resource 目录不存在"

- [x] 3.4 Negative: 验证 resource 路径不可被外部请求覆盖
  验证：code review 检查 `CategoryQuestionResourceDiscovery` 仅接受 `AgentPackageSourceLocator` 解析的路径，无外部路径注入入口
  来源：spec category-question-source "分类问题资源目录定位" Scenario "资源路径不可被外部覆盖"

## 4. Port 实现与 Composition 组装

- [x] 4.1 在 `agent-app/src/composition/` 中实现 `CategoryQuestionService`，实现 `CategoryQuestionPort`。接收 `agentId` 和 `locale`，调用 `CategoryQuestionResourceDiscovery` 查内存 Catalog，返回 `CategoryQuestionResult`。支持 `AbortSignal`
  验证：单元测试注入 mock discovery，验证 Service 返回正确的 DTO
  来源：spec category-question-api "Web channel 通过 CategoryQuestionPort 查询"、design D4

- [x] 4.2 在 `agent-app/src/composition/create-app.ts` 中组装 `CategoryQuestionService`，注入 `AgentPackageSourceLocator`，将 `CategoryQuestionPort` 暴露给 Web channel
  验证：`npm run build` 通过；code review 确认 port 注入到 `WebChannelDependencies`
  来源：design D5、proposal 影响范围

## 5. Web API 路由

- [x] 5.1 在 `agent-channel-web/src/schemas/` 中新增 `category-question-query.ts`，定义请求 querystring schema 和响应 DTO schema（TypeBox），响应不包含 hash 字段
  验证：`npm run build` 通过；schema 编译无错误
  来源：spec category-question-api "分类问题查询响应 DTO"

- [x] 5.2 在 `agent-channel-web/src/routes/requests.ts` 中新增 `GET /api/v1/category-questions` 路由。通过 identity resolver 解析 owner scope，使用 `activeAgentId` 作为 agent scope，调用 `CategoryQuestionPort.listCategoryQuestions()`，投影为 HTTP 响应 DTO。支持请求取消
  验证：contract 测试通过 Fastify inject 验证正常响应、空结果响应、未认证 401
  来源：spec category-question-api "分类问题查询 API 端点"、"分类问题查询的 Scope 校验"

- [x] 5.3 在 `agent-channel-web/src/index.ts` 的 `WebChannelDependencies` 中新增可选 `categoryQuestions?: CategoryQuestionPort` 字段
  验证：`npm run build` 通过
  来源：design D5

- [x] 5.4 Negative: 验证 API 响应不包含 hash 字段
  验证：contract 测试断言响应 JSON 中无 `hash` 字段
  来源：spec category-question-api "分类问题查询响应 DTO" Scenario "响应不暴露 hash"

- [x] 5.5 Negative: 验证未认证请求返回 401 且不暴露内部信息
  验证：contract 测试发送无认证请求，断言 401 状态码和 safe error 响应
  来源：spec category-question-api "分类问题查询的 Scope 校验" Scenario "未认证请求被拒绝"

- [x] 5.6 验证日志不包含问题文本和分类名称
  验证：contract 测试捕获 structured log，断言日志仅包含 low-cardinality 字段
  来源：spec category-question-api "分类问题查询安全与可观测"

## 6. 测试 JSONL Fixture

- [x] 6.1 在 `packages/agent-capability/tests/` 中创建测试用 JSONL fixture 文件，覆盖：一级分类直接问题、一级分类带二级分类、混合场景
  验证：fixture 文件被 contract 测试正确加载和解析
  来源：spec category-question-source "JSONL 文件结构与校验"

## 7. 前端组件容器参数化

- [x] 7.1 将输入框上方区域重构为参数化 `SkillArea` 容器组件，接收参数控制渲染 Skill 选择栏或分类问题组件，默认渲染分类问题组件
  验证：前端组件测试验证默认渲染分类问题组件、参数切换渲染 Skill 选择栏
  来源：spec skill-selector-ui (MODIFIED) "Skill 选择栏组件位置"

## 8. 前端分类问题 Chip 组件

- [x] 8.1 实现分类问题 chip 组件，复用 Skill chip 完全相同的渲染逻辑（图标选择 index%4、chip 样式、选中态、"全部"按钮）。调用 `GET /api/v1/category-questions?locale={site.locale}` 获取数据
  验证：前端组件测试验证 chip 渲染、图标、样式与 Skill chip 一致
  来源：spec category-question-ui "分类问题 Chip 渲染复用 Skill Chip 逻辑"

- [x] 8.2 实现点击 chip 后在输入框显示选中分类名称（样式与 Skill 选中态一致），再次点击清除选中
  验证：前端组件测试验证选中态显示和清除
  来源：spec category-question-ui "分类问题 chip 选中态写入输入框"

- [x] 8.3 Negative: 验证无分类问题数据时 chip 区域不渲染且不保留空白
  验证：前端组件测试模拟 API 返回空数组，断言 chip 区域不渲染
  来源：spec category-question-ui "分类问题 Chip 区域组件位置" Scenario "无分类问题时不渲染"

## 9. 前端分类问题 Modal 组件

- [x] 9.1 实现点击 chip 后弹出的 modal：`padding: 16px`、`border-radius: 16px`、`max-height: 516px`、宽度与输入框等长、位于输入框上方 4px、标题"分类问题推荐"。chip 区域在 modal 打开时被覆盖或消失
  验证：前端组件测试验证 modal 布局和尺寸
  来源：spec category-question-ui "点击 Chip 后弹出 Modal"

- [x] 9.2 实现 modal 内 tab 组件：第一个 tab 为"全部"，其后为各一级分类 name。tab 支持鼠标滚轮横向滚动。content 区域支持 vertical scroll
  验证：前端组件测试验证 tab 顺序、横向滚动、纵向滚动
  来源：spec category-question-ui "Modal Tab 结构与滚动"

- [x] 9.3 实现问题块：`height: 64px`、`border-radius: 12px`，左侧 icon，右侧上方二级分类名（如有）、下方问题文本。点击问题块将问题文本写入输入框并关闭 modal
  验证：前端组件测试验证块布局、有/无二级分类的展示、点击写入输入框
  来源：spec category-question-ui "问题块展示与交互"

- [x] 9.4 实现问题块响应式列数：immersive/local 模式 2 列 gap 8px；collaborative 模式输入框宽度 < 1080px 时 1 列，>= 1080px 时 2 列 gap 8px
  验证：前端组件测试验证各模式下列数和 gap
  来源：spec category-question-ui "问题块响应式列数"

## 10. 集成验证

- [x] 10.1 运行 `npm run build` 确认全量编译通过
  验证：`npm run build` exit code 0
  来源：proposal 影响范围

- [x] 10.2 运行 `npm test` 确认所有测试通过
  验证：`npm test` exit code 0
  来源：所有 spec requirements

- [x] 10.3 运行 `openspec validate --all --strict` 确认 OpenSpec 校验通过
  验证：`openspec validate --all --strict` exit code 0
  来源：AGENTS.md 验证门禁

- [x] 10.4 运行 `npm run lint:architecture` 确认架构规则通过
  验证：`npm run lint:architecture` exit code 0
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/category-question-source/spec.md`、`openspec/specs/category-question-api/spec.md`、`openspec/specs/category-question-ui/spec.md`
- 修改 `openspec/specs/skill-selector-ui/spec.md`（输入框上方区域参数化）
- 更新 `openspec/overview.md`（分类问题推荐机制背景）
- 更新 `openspec/designs/modules/agent-capability.md`（`CategoryQuestionResourceDiscovery` 模块设计）
- 更新 `openspec/designs/modules/agent-channel-web.md`（`category-questions` 路由设计）
- 更新 `openspec/designs/spec-to-design-map.md`（新增 3 个 spec 到 design 的导航）
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义
