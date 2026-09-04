## 背景与问题（Why）

NextAgent 前端输入框上方当前只有 Skill 选择栏（`skill-selector-ui`）。电信网络运维场景下，用户经常需要快速选择常见问题类别（如"查库存"、"查销量"、"查异常"）并发送对应预设问题。当前没有分类问题推荐机制——用户必须手动输入完整问题，或依赖 AI 动态生成的 `question-recommendation`（仅出现在回答完成后，且是模型推断的追问，不是面向业务场景的静态预设问题）。

需要一个与 Skill 同形同策的静态分类问题资源发现机制：分类问题数据以 JSONL 文件形式部署在 `agents/{agentId}/resource/` 目录下，运行时加载到内存，通过 Web API 暴露给前端。前端在输入框上方以与 Skill chip 完全一致的渲染逻辑展示一级分类 chip，点击后弹出 modal 展示该分类下的具体问题，用户点击问题块后直接写入输入框。

本次 change 为后续高频问题组件和输入联想能力奠定数据基础（`fixed` 字段、问题 hash 标识），但本次不建数据库表、不做高频问题和输入联想。

## 变更范围（What Changes）

**新增资源发现层**：
- 在 `agent-capability` 中新增 `CategoryQuestionResourceDiscovery`，复用 `AgentPackageSourceLocator` 定位 `agents/{agentId}/resource/` 目录，读取 `category-question-{locale}.jsonl` 文件
- JSONL 结构：每行一个 JSON 对象，包含 `category`（一级分类名）、`questions`（直接问题列表）或 `records`（二级分类列表，二级分类只有 `questions`），`questions` 和 `records` 互斥
- 产出 readiness evidence（同 skill discovery 模式）
- 生成内存 `CategoryQuestionCatalog`，按 agent-scoped + locale 维度组织

**新增 Port 契约**：
- 在 `agent-contracts/runtime` 中新增 `CategoryQuestionPort`，定义 `listCategoryQuestions(agentId, locale)` 方法
- 返回 `CategoryQuestionTree` DTO，包含 `locale` 和 `categories` 数组

**新增 Web API**：
- `GET /api/v1/category-questions?locale=zh-CN`，通过 identity resolver 解析 owner scope，使用 trusted agent scope
- 返回 `CategoryQuestionTree` DTO，包含一级分类、二级分类（如有）和问题条目（`text` + `fixed`）
- 不暴露问题 hash（hash 仅为内部使用，为未来 DB 持久化预留）

**新增前端组件**：
- 输入框上方区域参数化为可切换组件容器（`SkillArea`），默认渲染分类问题组件
- 分类问题 chip 区域复用 Skill chip 完全相同的渲染逻辑（图标 + 文字、选中态、"全部"按钮）
- 点击一级分类 chip 后在输入框上方 4px 弹出 modal（`padding: 16px`、`border-radius: 16px`、`max-height: 516px`、宽度与输入框等长）
- Modal 内含 tabs（第一个为"全部"，其后为各一级分类），tab 可横向滚动
- Tab content 区域展示问题块（`height: 64px`、`border-radius: 12px`），每块左侧 icon、右侧上方二级分类名（如有）、下方问题文本
- immersive/local 模式下每行 2 列；collaborative 模式下输入框宽度 < 1080px 时 1 列，>= 1080px 时 2 列
- 点击问题块将问题文本写入输入框

**locale 映射**：
- 前端从 `site.locale`（如 `zh-cn`）传入 API
- 后端 normalize：取 `-` 前的 language part（`zh-cn` → `zh`），匹配文件后缀 `category-question-zh.jsonl`
- 本地开发默认 `zh-cn`

## Capability 影响（Capabilities）

### 新增 Capability
- `category-question-source`: 分类问题静态资源发现——从 `agents/{agentId}/resource/category-question-{locale}.jsonl` 加载分类问题目录，校验 JSONL 结构，产出内存 Catalog 和 readiness evidence
- `category-question-api`: 分类问题查询 Web API——`GET /api/v1/category-questions?locale=zh-CN`，通过 `CategoryQuestionPort` 返回 `CategoryQuestionTree` DTO，owner scope + agent scope 双重校验
- `category-question-ui`: 分类问题前端组件——chip 区域（复用 Skill chip 渲染）、modal（tabs + 问题块）、点击写入输入框、响应式列数

### 修改的 Capability
- `skill-selector-ui`: 输入框上方区域参数化为可切换组件容器，允许通过参数控制渲染 Skill 选择栏或分类问题组件

## 影响范围（Impact）

**后端代码**：
- `packages/agent-capability/src/`：新增 `CategoryQuestionResourceDiscovery`、JSONL 解析器、内存 Catalog 模型、readiness evidence 类型
- `packages/agent-contracts/src/runtime/`：新增 `CategoryQuestionPort`、`CategoryQuestionRequest`、`CategoryQuestionResult`、`CategoryQuestionTree` 及相关 DTO 类型
- `packages/agent-app/src/composition/`：新增 `CategoryQuestionService` 实现 `CategoryQuestionPort`，在 `create-app.ts` 中组装
- `packages/agent-channel-web/src/`：新增 `GET /api/v1/category-questions` 路由、响应 DTO schema、在 `WebChannelDependencies` 中注入 `CategoryQuestionPort`

**前端代码**：
- 输入框上方区域重构为参数化 `SkillArea` 容器
- 新增分类问题 chip 组件（复用 Skill chip 渲染逻辑）
- 新增分类问题 modal 组件（tabs + 问题块 + 响应式布局）
- 新增分类问题 API 调用和状态管理

**测试**：
- JSONL 解析和校验的 contract 测试
- Discovery readiness evidence 测试
- Web API scope 校验和响应 DTO 测试
- 前端组件渲染和交互测试

**部署**：
- `agents/{agentId}/resource/category-question-{locale}.jsonl` 文件部署到 agent package 目录
- 无数据库变更
- 无配置文件变更

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/category-question-source/spec.md`：新增
- `openspec/specs/category-question-api/spec.md`：新增
- `openspec/specs/category-question-ui/spec.md`：新增
- `openspec/specs/skill-selector-ui/spec.md`：修改（输入框上方区域参数化）

长期背景：
- `openspec/overview.md`：新增分类问题推荐机制的背景和目标摘要

设计视图：
- `openspec/designs/modules/agent-capability.md`：新增 `CategoryQuestionResourceDiscovery` 模块设计
- `openspec/designs/modules/agent-channel-web.md`：新增 `category-questions` 路由设计
- `openspec/designs/architecture/`：无需新增跨模块设计（复用现有 skill discovery 架构模式）

验证入口：
- JSONL 解析 contract 测试
- Discovery readiness evidence 单元测试
- Web API scope 校验和 DTO 响应测试
- 前端组件渲染和交互 e2e 测试
