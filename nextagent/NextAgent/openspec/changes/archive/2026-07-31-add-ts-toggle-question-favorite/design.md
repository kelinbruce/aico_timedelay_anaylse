# Design: add-ts-toggle-question-favorite

## 设计范围

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| FN-1.19 收藏问题 | 问题收藏图标由单向添加改为收藏/取消切换，并新增收藏态可视化；移除专用 pin 端点 | `high-frequency-question-ui`（MODIFIED「用户消息『添加到常问』图标」）、`frequent-question-api`（REMOVED「Pin API 端点」） | 见下 |

## 存量 Requirement 迁移方案

无迁移。被触及的「用户消息『添加到常问』图标」Requirement 原位 MODIFIED，不跨 spec 移动；`high-frequency-question-ui` 中其他 Requirements 完全未触及，原位保留。

说明一处既有映射事实：FN-1.19 长期文档当前记录的主 spec 为 `user-question-activity`，但该 spec 承载的是问题活动存储（frequency/`is_pinned`）的后端契约，与本次触及的浏览器 UI 交互 Requirement 黑盒边界不匹配。本次以 `high-frequency-question-ui` 作为该 UI Requirement 的最高匹配 spec 原位修改，不新增 Function 与 spec 的映射关系；FN-1.19 的 canonical spec 收敛留待后续专门处理。

## FN-1.19 收藏问题

### 目标与规范依据

问题气泡悬浮操作区的收藏图标按当前收藏状态执行收藏或取消收藏，图标、tooltip 与提示文案随状态区分；失败后状态回滚。

本 Function 的目标 Requirements：

- canonical spec：`high-frequency-question-ui`（针对本次 UI 交互边界，理由见"存量 Requirement 迁移方案"）
- MODIFIED：用户消息「添加到常问」图标

### 当前实现

- `TurnBlock.tsx` 的 `handlePinQuestion` 写死 `isQuestionFavorited: true`，只收藏不取消。
- 用户消息气泡的 `BubbleActions` 不接收标注状态，收藏图标恒为 `FolderAddOutlined`，tooltip 恒为收藏文案；assistant 气泡的标注操作区已存在"按 `annotationState` 切换填充/线框图标 + 变色"的模式（如 `StarFilled`/`StarOutlined`）。
- `TurnBlock` 已持有 `currentAnnotation.isQuestionFavorited`（来自会话标注列表 + 乐观更新），`callAnnotationApi` 已实现乐观更新、失败回滚与错误提示。
- 后端 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 的 upsert 已支持 `isQuestionFavorited=false` 取消收藏及全空行清除；常用问题与输入联想的收藏层数据来源于标注存储的 `listQuestionFavoriteTurns`，取消后自动不再返回。
- 专用路由 `POST /api/v1/user-questions/pin` 写死 `isQuestionFavorited=true`，前端无调用方；其请求体 schema（`schemas/user-question-pin.ts`）只被该路由引用，`api-contract.ts` 清单包含对应条目。

### GAP 分析

1. 前端缺少取消收藏路径：`handlePinQuestion` 不写 `false`。
2. 用户消息气泡缺少收藏态可视化：`BubbleActions` 拿不到 `isQuestionFavorited`，图标与 tooltip 无状态。
3. 缺"取消收藏"相关 i18n 文案（`zh-CN`/`en-US`）。
4. 专用 pin 路由是无调用方的死路径，为同一收藏语义保留了第二条写入口。
5. stable spec 描述与实现脱节的两处在本次 MODIFIED 中一并修正：点击调用的 API（实现走 annotations upsert，非专用 pin 路由）、"前端截断后发送问题文本"（实现不发送文本，截断由后端读取投影时完成）。

### 修改方案

唯一实现路径，全部位于 `frontend/agent-web`：

1. `BubbleActions` 增加可选入参 `questionPinned?: boolean`（默认 `false`）。`bubble="user"` 且 `onPin` 存在时：`questionPinned=true` 渲染高亮 `FolderFilled` + tooltip "取消收藏"，否则渲染 `FolderOutlined` + tooltip 收藏文案。`FolderAddOutlined` 不再使用。
2. `TurnBlock` 渲染用户消息 `BubbleActions` 处传入 `questionPinned={currentAnnotation?.isQuestionFavorited ?? false}`；`handlePinQuestion` 改为写入 `isQuestionFavorited: !base.isQuestionFavorited`，成功提示按目标态区分"已添加至常用问题"/"已取消收藏"。乐观更新与失败回滚复用既有 `callAnnotationApi`，不新增状态管理。
3. i18n：`turn.pinQuestion` 文案保留（未收藏 tooltip）；新增 `turn.unpinQuestion`（已收藏 tooltip）与 `turn.unpinQuestionSuccess`（取消成功提示），`zh-CN`/`en-US` 同步。
4. 移除 pin 端点（`agent-channel-web`）：删除 `routes/requests.ts` 中 `user-questions/pin` 路由块及 `userQuestionPinBody` import，删除 `schemas/user-question-pin.ts`，从 `schemas/api-contract.ts` 清单移除 `POST /api/v1/user-questions/pin` 条目；`frequent-question-routes.test.ts` 移除 pin 的 204/400 用例，改为断言 `POST /api/v1/user-questions/pin` 返回 404（端点已移除的 negative case）。

质量属性影响：无新增黑盒质量目标。可测试性关注点是收藏态渲染与双向切换的组件级行为验证，由验证策略承载。

### 备选方案

- 保留 pin 路由作为收藏专用写入口：会为同一语义（写 `isQuestionFavorited`）保留两条写路径，违反同形同策，且无前端调用方。未选择。
- 新增 `POST /api/v1/user-questions/unpin` 专用路由：同样制造平行 API；既有 annotations upsert 已完整承载取消语义。未选择。

## 验证策略

- spec 行为（图标两态渲染、点击收藏、点击取消、失败回滚、仅用户消息显示、无写权限不显示）：`frontend/agent-web` 组件测试，断言用户可观察的图标、tooltip、提示文案与 API 请求体。
- negative case：assistant 气泡不渲染收藏图标、无写权限不渲染，由组件测试显式断言。
- pin 端点移除的 negative case：`agent-channel-web` 路由测试断言 `POST /api/v1/user-questions/pin` 返回 404。
- 后端无行为变更，不新增后端测试；既有 `conversation-annotation` 取消收藏语义已有 contract 测试覆盖。
- `openspec validate --all --strict` 验证 spec delta 与基线合并。

## 长期基线刷新计划

- stable spec：`openspec/specs/high-frequency-question-ui/spec.md` 合并 MODIFIED「用户消息『添加到常问』图标」；`openspec/specs/frequent-question-api/spec.md` 移除「Pin API 端点」。
- Function：`FN-1.19 收藏问题` 刷新处理过程、结果与接口字段（接口由 `POST /api/v1/user-questions/pin` 修正为 annotations upsert）。
- Feature：`F-1.9 智能问题推荐` 补充"用户可取消问题收藏"的用户价值描述。
- overview：`openspec/overview.md` 高频问题段落中"通过 `POST /api/v1/user-questions/pin` 主动收藏（无 unpin API、FIFO 淘汰）"的描述刷新为标注收藏语义。
- architecture：无。modules：`openspec/designs/modules/agent-channel-web.md` 中 pin 路由设计段落移除。ADR：无。
- spec-to-design-map：`high-frequency-question-ui` 与 `frequent-question-api` 导航行不变。
- 开发者文档：`docs/apis/`（openapi、validation 清单）、`docs/developer/10-api-reference.md`、`docs/frontend/user-workflows.md`、`docs/NextAgent测试特性树.md` 中 pin 端点条目同步移除或修正。

## 风险与取舍

- 并行 active change `migrate-question-pin-to-annotation` 对「Pin API 端点」持有 MODIFIED delta（改为 `{ sessionId, runId }` + annotation upsert）。本 change 的 REMOVED 是其目标态的进一步收敛：无论归档顺序如何，最终态均为端点移除；若本 change 先归档，`migrate-question-pin-to-annotation` 归档时需丢弃其「Pin API 端点」MODIFIED delta，该协调点已记录于此。
- 移除 `POST /api/v1/user-questions/pin` 是 BREAKING API 变更；前端无调用方，风险限于未知外部集成方，缓解方式是 Migration 说明（改用 annotations upsert）。
- 取消收藏后该问题从常用问题/联想收藏层消失依赖标注存储查询，无额外同步动作；该行为已有后端语义保证，风险低。

## 待确认问题

无。
