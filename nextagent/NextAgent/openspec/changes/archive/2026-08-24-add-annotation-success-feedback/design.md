## 设计决策（Design Decisions）

### 成功提示由操作入口决定

`TurnBlock.callAnnotationApi` 继续作为唯一标注写入和乐观回滚路径，不感知具体控件。三个回答标注入口在调用时传入本次操作的成功文案：

- 点赞：`turn.likeSuccess` / `turn.likeRemoved`
- 点踩：`turn.dislikeSuccess` / `turn.dislikeRemoved`
- 收藏：`turn.favoriteSuccess` / `turn.favoriteRemoved`

写入成功后由 `callAnnotationApi` 调用一次 `message.success`。写入失败、请求被拒绝或返回空状态时不展示成功提示，保留既有错误提示和回滚行为。

该方案避免根据响应 diff 反推用户意图，也不影响问题收藏已有提示路径。

### 国际化与多宿主一致

文案只进入 zh-CN / en-US i18n 资源，`TurnBlock` 通过 `t` 读取。组件逻辑不包含硬编码文案，local、immersive、collaborative/PIU 共享同一路径。

### 验证策略

组件测试以 mock 的 annotation service 分别驱动六种成功路径，断言 `message.success` 收到对应 i18n 文案；同时保留既有失败回滚测试，确认失败时不出现成功提示。执行前端定向测试和 TypeScript build。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/conversation-annotation-controls/spec.md`：合并成功提示行为。
- `openspec/designs/functions/D1-会话与流式交互/D1.3-对话标注与分享/FN-1.12-标注对话.md`：归档前补充成功反馈规格摘要。
- 其他 overview、architecture、module、ADR、spec-to-design-map：无。
