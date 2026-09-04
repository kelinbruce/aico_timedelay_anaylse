## Why

最终用户将问题收藏到常用问题后无法取消：问题气泡悬浮操作区的收藏图标始终显示同一图标，点击只会重复执行收藏，且用户无法从图标判断该问题是否已收藏。已收藏的问题会持续出现在常用问题列表和输入联想的收藏层中，用户没有自助移除手段，只能任由收藏内容累积。

当前行为由既有规格明确规定（图标不区分已收藏/未收藏状态、图标状态不得因点击改变、重复点击仍提示收藏成功），因此这不是实现缺陷，而是需要修订规格并升级交互。后端的收藏事实已支持取消语义，本次只放开前端交互与状态可视化。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户可从问题气泡的收藏图标直观区分该问题"已收藏"与"未收藏"。
- 未收藏时点击完成收藏，已收藏时点击完成取消收藏；两种操作都有明确的成功反馈；操作失败时图标状态回滚并提示失败。
- 取消收藏后，该问题不再出现在常用问题列表与输入联想的收藏层。

**非目标：**

- 不在常用问题面板、输入联想列表中新增收藏或取消收藏入口；收藏/取消入口仍然只有问题气泡悬浮操作区一处。
- 不改动回答收藏（`isFavorited`）、情绪标注（`sentiment`）等其他标注交互。
- 不引入问题收藏数量上限或淘汰策略。
- 不改动后端 API 与持久化语义；标注 upsert 的 `isQuestionFavorited=false` 取消收藏语义及全空行清除行为均已存在，不在本 change 变更范围内。

## What Changes

**修改：**

- 问题气泡悬浮操作区的「添加到常问」图标由单向添加改为收藏态切换交互：图标随该问题的收藏状态切换，未收藏显示 `FolderOutlined`，已收藏显示高亮的 `FolderFilled`；tooltip 与操作成功提示区分"收藏"与"取消收藏"两种动作。
- 点击行为由"始终执行收藏"改为"按当前收藏状态执行收藏或取消收藏"，统一通过既有标注 upsert API 写入 `isQuestionFavorited` 目标值。
- 规格修正：既有规格中"图标不区分状态、图标状态不得因点击改变、重复点击仍提示收藏成功"的约束被收藏态切换语义取代；点击调用的 API 描述由专用 pin 接口修正为前端实际使用的标注 upsert 接口，并移除已不成立的"前端截断后发送问题文本"描述（问题文本截断由后端在读取投影时完成）。

**移除：**

- **BREAKING** 移除 `POST /api/v1/user-questions/pin` 端点。问题收藏的写路径已与回答收藏、点赞/点踩统一为标注 upsert API，该端点无任何前端调用方，属于死路径。仍有调用的外部集成方需改用 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 的 `isQuestionFavorited` 字段。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.9 智能问题推荐`：用户可以取消问题收藏并直观识别收藏状态，常用问题列表与输入联想收藏层的内容由用户自助管理。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.19 收藏问题` → `specs/user-question-activity/spec.md`
  - 功能边界：问题收藏的前端交互由单向添加变更为收藏/取消双向切换，并新增收藏状态可视化；专用 pin 端点移除，问题收藏写路径统一为标注 upsert API；收藏事实的 upsert、取消与全空行清除等持久化语义不变。
  - 系统质量属性：可测试性（收藏态渲染与双向切换的组件级行为验证）。
  - 映射说明：canonical spec 为 `user-question-activity`；本 change 实际触及两个 legacy specs：`high-frequency-question-ui` 的「用户消息『添加到常问』图标」Requirement（MODIFIED，其黑盒边界是浏览器 UI 交互，与该 spec 匹配度最高，原位修改不迁移），以及 `frequent-question-api` 的「Pin API 端点」Requirement（REMOVED，端点整体移除）。

## 影响范围（Impact）

- 代码：`frontend/agent-web` 的问题气泡悬浮操作区（收藏态图标渲染、点击切换、提示文案）与 i18n 资源（`zh-CN`、`en-US`）；`agent-channel-web` 的 pin 路由、请求体 schema、API 清单条目。
- API：移除 `POST /api/v1/user-questions/pin`；复用 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 的既有 `isQuestionFavorited` 字段，该端点行为不变。
- 测试：`frontend/agent-web` 组件测试（未收藏/已收藏态渲染、点击收藏、点击取消、失败回滚、无写权限不渲染）；`agent-channel-web` 路由测试（pin 端点移除后返回 404）。
- 配置/运维：无新增配置，无运维变更。
