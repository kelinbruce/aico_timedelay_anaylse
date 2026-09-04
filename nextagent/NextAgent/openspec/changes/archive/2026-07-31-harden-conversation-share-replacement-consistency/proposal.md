## Why

用户分享一轮问答后，若创建者对该轮执行 retry 或 edit，分享链接可能只剩问题、只剩回答，或者返回 `SHARE_CONTENT_DELETED`。原因是用户选择的是完整问答轮次，而分享记录冻结的是执行 `runId`；retry 可能让问题与最终回答分属不同 run，retry/edit 的可见性替换又会隐藏被分享的消息。当前分享读取只要找到任意一条匹配消息就返回成功，因此还可能静默返回残缺内容。

对话分享是跨 owner scope 的只读受控例外。系统必须在不扩大读取范围、不暴露安全隐藏内容的前提下，明确分享在 retry/edit 后的稳定结果，避免已发出的分享链接随会话投影变化而产生不可预测或不完整的内容。

跟踪 Issue：[#515 fix(session): retry/edit 后分享会话内容残缺或失效](https://gitcode.com/gdd_hw/NextAgent/issues/515)

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 用户创建的分享冻结所选执行尝试；后续 retry/edit 不改变该分享所指向的尝试内容。
- 分享读取为每个已选 `runId` 返回完整、可渲染的问答单元，不得静默返回只有问题或只有回答的部分结果。
- 普通请求、retry attempt、edit replacement 和 fork copied run anchor 使用同一套分享完整性规则。
- 分享读取继续严格使用分享创建者的 owner scope、Agent Scope 和 session，不得读取 parent session 或未选执行的回答。
- 因 retry/edit 替换而隐藏的已分享内容仍可按冻结分享读取；因安全阻断、删除或其他非替换原因不可分享的内容不得因此重新暴露。

**非目标：**

- 不为分享页新增 think、timeline event、annotation 或 active runtime state；既有 `CAPABILITY_RESULT` message 的分享投影不在本 change 中改变。
- 不改变分享 URL、有效期、权限校验、`runIds` 请求字段或 `ConversationShareRecord` 公共形状。
- 不新增分享撤销、分享版本管理或内容复制表。
- 不改变默认会话历史对 hidden message 的过滤规则。

## What Changes

- 修改分享读取结果：系统把每个冻结 `runId` 解析为一个完整分享单元。真实 retry run 的单元包含该 attempt 的回答和同一 request 的 canonical 用户问题；fork copied run anchor 的单元继续包含该 anchor 下的 copied messages。
- 修改替换可见性对分享的影响：`RETRY_REPLACED` 和 `EDIT_REPLACED` 只影响默认会话投影，不使已冻结分享丢失所选内容；安全阻断、物理删除及其他未允许的隐藏原因继续使对应内容不可分享。
- 修改完整性失败行为：任一已选 `runId` 无法解析为完整分享单元时，整个分享读取返回 `SHARE_CONTENT_DELETED`，不得返回其他 run 的部分成功结果。
- 保持分享的 owner scope 受控例外、只读性和 `runIds` attempt 精确性不变。

## Feature 影响（Features）

### 修改的 Feature

- `F-1.8 分享对话`：分享链接在源会话发生 retry/edit 后仍稳定呈现创建时选择的完整问答尝试，并对内容缺失给出一致失败结果。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.15 查看分享的会话` → `specs/shared-conversation-view/spec.md`
  - 功能边界：每个已选 `runId` 必须解析为完整问答单元；retry/edit 替换不得造成部分内容，安全隐藏不得被分享读取绕过。
  - 系统质量属性：安全。
  - 映射说明：legacy 收敛新建 canonical spec；本次触及的 legacy spec 为 `conversation-share`，只迁移“查看分享”所属 Requirements，不迁移创建、有效期、页面交互或会话清理等未触及 Requirements。目标 Requirement 继承 `add-share-ops-hash-permission` 已定义的 ops hash 等值校验最终语义。

## 影响范围（Impact）

- 已存在且仍有效的分享链接在源会话 retry/edit 后可继续显示创建时选择的问答尝试。
- 分享 API 的 URL、请求体和成功响应形状不变；内容不完整时更严格地返回既有 `SHARE_CONTENT_DELETED`。
- 分享服务需要读取执行尝试与消息可见性事实；前端继续提交 `runIds`，无需新增交互字段。
- 需要补充普通 retry/edit、fork copied run anchor、多 run 部分缺失和安全隐藏的联合验证。
- 本 change 依赖已完成但尚待归档的 `add-share-ops-hash-permission`；实施前先稳定其 ops hash 契约，再原子迁移查看分享 Requirement，避免把旧的 ops 子集语义带入新 canonical spec。
