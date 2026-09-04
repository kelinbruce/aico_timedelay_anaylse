## 1. 契约与投影

- [x] 1.1 定义 `CAPABILITY_RESULT_DELTA.payload.safeResult` 为 safe、bounded 的 stream 投影。
  验证：OpenSpec 校验与 stream projection 测试。
- [x] 1.2 确保 `safeResult` 不包含隐藏 tool 参数、原始命令/代码输入、runtime id 或任意 metadata。
  验证：negative stream projection 测试。
- [x] 1.3 确保 `safeSummary` 是具体的 safe 摘要，且 `text`/`content` 包含 safe 详情文本或空字符串，绝不是通用占位文本。
  验证：stream projection 测试。

## 2. 前端执行详情

- [x] 2.1 将 tool 条目渲染为 `tool · status`，摘要由 `safeResult` 派生或回退到 `safeSummary`。
  验证：process detail unit 测试。
- [x] 2.2 二级结果详情只从 allowlisted 的 `safeResult` 字段或 safe 的 `text`/`content` 回退渲染。
  验证：process detail unit 测试。
- [x] 2.3 将文件读取的选中范围和续读提示从 `offset`/`limit`/`nextOffset` 渲染为面向用户的文本，而不是原始参数标签。
  验证：process detail unit 测试与 stream projection 测试。
- [x] 2.4 将命令 `CODE: message` 形式的 stderr 渲染为分离的 error code 和 safe error 信息，policy 拦截显示为被拦截的命令结果。
  验证：process detail unit 测试与 stream projection 测试。
- [x] 2.5 执行详情面板展开/收起使用动画，并在过渡期间裁剪内容，避免与流式回答正文重叠。
  验证：TurnBlock 组件测试。
- [x] 2.6 历史失败 capability 摘要使用用户可读的失败原因渲染，同时把 code/category 保留在二级详情中。
  验证：process detail unit 测试。
- [x] 2.7 只有当 terminal content 不是 safe failure 占位文本时，才保留来自历史的失败 turn 部分回答回退。
  验证：answer content/session projection/failed TurnBlock 测试。
- [x] 2.8 刷新后对历史加载、timeline 支撑的 process 事件保持全流程入口可用，同时排除仅有会话 message 的 capability result。
  验证：detail 入口 unit 测试与浏览器刷新验证。
- [x] 2.9 对聊天视口和侧边栏 session 列表应用同一套主题化滚动条样式，包括暗色模式的 gutter/track 颜色。
  验证：layout/sidebar 测试与浏览器暗色模式视觉检查。
- [x] 2.10 将侧边栏 session 列表展开偏好持久化到 sessionStorage，并使用恢复的状态选择初始 session 列表请求 limit。
  验证：sidebar 组件与聊天页 route-state 测试，覆盖存储与请求参数。
- [x] 2.11 在 sessionStorage 中按 session 缓存 normal 模式 composer 草稿，切回该 session 时恢复。
  验证：composer controller/组件测试。
- [x] 2.12 跨 mount、request 控制和 stream 恢复刷新保持当前 session 列表历史窗口，同时不把侧边栏 UI 细节泄漏进请求或 stream 代码。
  验证：session store、sidebar 组件和聊天页 route-state 测试，覆盖默认刷新窗口行为。
- [x] 2.13 将 session 列表偏好 helper 移到前端 local-state 边界，使 ChatPage 不导入 sidebar 私有模块。
  验证：import 扫描与前端 build。
- [x] 2.14 将本地 view-state 需求中的 composer 草稿恢复和成功提交清理从 SHOULD 收紧为 MUST。
  验证：OpenSpec 校验与 composer 草稿缓存测试。
- [x] 2.15 防止路由/session 切换把离开 session 的可见 composer 输入发布为进入 session 的草稿。
  验证：MessageInput 回调变更回归测试与 ChatPage route-state session 切换测试。
- [x] 2.16 将执行详情摘要行与展开详情面板之间的间距设为 12px。
  验证：TurnBlock 组件间距与动画测试。
- [x] 2.17 对历史加载的会话 capability-result envelope 做净化，使原始存储 message 内容不会成为执行详情的 `text`/`content`。
  验证：针对历史未知 payload 和历史 `safeSummary` 回退的 process detail 投影测试。

## 3. 验证

- [x] 3.1 运行聚焦的后端/前端测试。
- [x] 3.2 为本 change 运行 OpenSpec 校验。
- [x] 3.3 启动应用并在浏览器中验证执行详情，附截图证据。
- [x] 3.4 检视最终 diff 的 OpenSpec、投影、前端、安全与验证一致性。
- [x] 3.5 针对session 列表与 composer 本地状态行为重新运行 OpenSpec 校验和聚焦前端测试。
- [x] 3.6 针对session 列表刷新窗口、helper 边界和 composer 草稿清理重新运行 OpenSpec 校验和聚焦前端测试。
- [x] 3.7 针对session 绑定的 composer 输入切换重新运行 OpenSpec 校验和聚焦前端测试。
- [x] 3.8 针对执行详情间距重新运行 OpenSpec 校验和聚焦 TurnBlock 测试。
- [x] 3.9 针对净化后的历史 capability-result envelope 重新运行 OpenSpec 校验和聚焦 process detail 测试。
