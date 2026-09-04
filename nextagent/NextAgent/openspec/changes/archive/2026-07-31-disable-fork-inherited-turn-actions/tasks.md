## 1. Runtime 标记写入

- [x] 1.1 `agent-runtime` 在 `copyForkMessage` 组装 copied message 时为 metadata 注入 `forkInherited: true`（在 `remapForkMetadata` 之后写入，避免被 remap 流程影响）；不改变其他任何 fork 行为。
  验证：`npm test -- ...agent-runtime` fork 测试：每条 copied message 的 `metadata.forkInherited === true`；metadata 不含任何 source session/message/request/run id。
  来源：specs/session-fork-from-message「fork 成功写入继承标记」；design D1。
- [x] 1.2 fork 边界负例测试：child session 新 submit 的 root user message 不携带标记；递归 fork 的 grandchild 全部 copied messages 携带标记；既有 retry/edit not-found 负例测试保持通过（后端边界不变）。
  验证：上述测试实际触发并断言各分支。
  来源：specs/session-fork-from-message「继承标记随 conversation 读取透出」「递归 fork 重新写入标记」「标记缺失不改变后端权威边界」；design D2/D4。

## 2. 前端 projection 标记

- [x] 2.1 `frontend/agent-web` 在 `TurnBlock` 增加可选字段 `forkInherited?: boolean`；`buildSessionProjection` 从 historyMessages 的 `metadata.forkInherited === true` 计算继承 root message id 集合，并标记对应 historical TurnBlock。
  验证：`frontend/agent-web` `npm test -- ...buildSessionProjection`：携带标记的历史消息生成 `forkInherited: true` 的 block；无标记消息不受影响。
  来源：specs/request-retry「Agent Web 禁用继承 latest turn 的 retry 入口」；design D1。

## 3. 前端禁用态与提示

- [x] 3.1 `TurnBlock.tsx` 在 `block.forkInherited` 时将 retry/edit 按钮渲染为禁用态（`not-allowed` 光标、opacity 0.45、aria-disabled、点击不触发），Tooltip 展示原因文案；新增 i18n key（zh-CN/en-US）。`useChatComposerController` 的 `canRetryLatest`/`canEditLatest` 在 latestTurnBlock 携带标记时为 `false`。
  验证：`frontend/agent-web` `npm test -- ...TurnBlock` 与 composer controller 测试：继承 latest turn 按钮禁用且 Tooltip 文案正确、点击不发起请求；对照组（无标记 latest turn）按钮正常。
  来源：specs/request-retry「继承 latest turn 的 retry 按钮禁用并提示」「新提问后的 latest turn retry 正常」；specs/request-edit-resubmit「继承 latest turn 的 edit 按钮禁用并提示」；design D3。

## 4. 整体验证

- [x] 4.1 运行验证门禁并记录结果。
  验证：仓库根目录 `npm run build`、`npm test -- ...agent-runtime`、`npm run test:contract`、`npm run lint:architecture`；`frontend/agent-web` `npm run build` 与相关 `npm test -- ...`；`openspec validate --all --strict`。说明未运行项及理由。
  来源：AGENTS.md 验证门禁。

归档前更新基线检查（非实施任务）：归档前按 proposal/design 的「归档前更新基线」将行为契约合并到 `openspec/specs/` 对应 capability。
