## 当前实现基线（Current Baseline）

### 过程条目与活动判定

- `TurnBlock` 已通过 presentation helpers 生成过程条目，并用 `resolveActiveProcessEntryKey()` 选出当前活动条目。
- `ProcessPanel` 已接收 `activeProcessEntryKey`、`isLatest`、`isTerminal`、`executionDetailsPhase` 和 reduced-motion 结果。
- `useProcessEntryDisclosure` 已拥有条目自动展开与收起、用户手工覆盖和 root scope 重置。
- 当前条目行缺少稳定的活动视觉与 `aria-current`，完成条目仍延迟收起。

### 聊天视口与答案交接

- `useChatViewportController` 是聊天视口跟随状态的唯一 owner。
- `TurnBlock` 和 `ProcessPanel` 已通过回调报告内容高度变化，不需要新增元素级滚动。
- `buildAnswerContent()` 会聚合可见助手文字；执行中的普通助手文字也可能暂时出现在答案区，因此 handoff 必须同时满足 `TurnBlock.status === "COMPLETED"` 和 `hasAnswerContent`。
- canonical `QUESTION` 补充信息已由既有 `USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED` 和安全的 durable `pendingInputAnswer` projection 表达。当前 Web projection 不暴露可信 producer identity，因此本 change 只按 `kind=QUESTION`、既有 normalized envelope identity 与 `pendingInputId` 关联 presentation，不推断具体 Capability producer，不改变 Pending Input 生命周期，也不把其他 pending kind 纳入局部判断。

## 目标设计（Proposed Design）

本设计只修改 `frontend/agent-web` 的浏览器投影和本地 view state。过程事实、模型输出分类、Message/Event 持久化、Live/History 内容关联和集成披露策略均由其他 owner 负责。

### 1. 活动条目只消费既有活动判定

`ProcessPanel` 仅在以下条件全部成立时把某行标记为活动条目：

1. `isLatest=true`；
2. `isTerminal=false`；
3. `activeProcessEntryKey === entry.key`；
4. 同一个 composed presentation 中不存在顺序晚于该条目最后活动位置的可见助手文字。

活动行 wrapper 投影 `aria-current="step"` 和稳定测试属性。既有 14px 图片图标置于固定 20px 圆形节点 wrapper 内；活动节点使用现有主题 token 和静态底色，标题使用 primary text 和 500 字重。允许动态效果时，固定节点 wrapper 使用约 2 秒一轮的 `ease-in-out` 外圈呼吸，只改变 `box-shadow` 的扩散半径与透明度，不改变节点尺寸、位置或内容。浅色主题使用清晰但克制的 primary 外圈；深色主题复用深色 primary token 并缩小最大扩散半径、降低光晕面积，避免霓虹感。`prefers-reduced-motion: reduce` 生效时不运行呼吸 keyframe，保留静态节点底色、外圈、标题层级和 `aria-current`。非活动节点保持透明且不运行动画。

不得替换、重绘、着色或重新分类 Think、Skill/Tool、过程完成、最终完成和子标题图标。活动状态不得改变列宽、标题起点、连接线、行高、条目顺序、toggle 命中区域或焦点。

运行中的可见助手文字顺序晚于当前活动条目时，该条目立即结束视觉活动：移除呼吸、静态活动外圈、标题强调和 `aria-current`，并按第 4.1 节收起自动管理的 detail。该交接只改变浏览器 presentation，不修改条目的 `isFinal`、持久化事实、标题或图标；若同一条目或新条目随后产生顺序更晚的过程活动，则按上述四项条件重新选择唯一活动条目并恢复主题感知的活动提示。

### 2. 新条目反馈使用 run-scoped 本地记录

`rootMessageId + displayRunId` 组成 appearance scope；缺少 `displayRunId` 时以 `rootMessageId` 兼容。`ProcessPanel` 在 committed render 后记录已经呈现的 entry key：

| 条件 | 行为 |
|---|---|
| scope 首次 render | 当前 key 建立基线，不运行动画 |
| live run 后续出现新 key | 仅首次执行 200ms opacity + 4px transform |
| detail 更新、rerender、panel reopen | 不重放 |
| scope 改变 | 新 scope 建立基线，不重放 |
| terminal、history、reduced-motion | 直接显示最终状态 |

记录只属于组件 view state，不进入 Event、Message、store 或日志。

### 3. 视口 owner 保持不变

不新增 `scrollIntoView`、元素定位、ProcessPanel 私有 following state 或恢复按钮。活动 key/sequence 的变化接入 TurnBlock 现有 follow-bottom layout effect；调用前实时读取 following 状态。

```text
ProcessPanel ResizeObserver
→ TurnBlock processPanelHeight / activity signature
→ onRequestScrollToBottom
→ useChatViewportController
```

用户离开底部后不请求滚动，继续使用既有 reading anchor 与恢复入口。

### 4. Disclosure 使用无延迟自动交接

未被用户手工覆盖的条目从 running 进入 final 时，当前 committed render 直接移除 detail：

- 不等待 800ms；
- 不执行自动 height transition；
- 下一活动条目从稳定位置开始呈现；
- 用户仍可通过单条 toggle 查看 detail。

手工状态由 `Map<entryKey, boolean>` 表达展开或收起，并在 `rootMessageId + displayRunId` scope 内优先。切换 run 时清除上一 run 的状态。

成功完成面板重新打开时，只显示步骤标题与状态；自动管理 detail 全部收起。系统自动收束的面板进入失败时恢复过程目录，并由既有 Turn 级失败提示承担失败原因说明；用户手工收起面板或条目的状态始终优先。存在未解决的 canonical `QUESTION` 补充信息时，只把对应 supplemental entry key 交给 disclosure hook，只自动显示这些非 final 待处理 detail，不展开其他未完成或已完成条目。不得用标题字符串或未投影的 producer identity 推断异常状态。

#### 4.1 公开助手文字只结束此前步骤的视觉活动

`TurnBlock` 从同一个 composed `aiEvents` presentation 中读取最新可见助手文字的活动位置；过程条目构建在同一个 presentation 中记录其最后一次过程活动的位置，并把这两个同域顺序事实交给 `ProcessPanel`。活动位置优先按 normalized envelope 的 `createdAt` 排列，同一时间使用稳定数组顺序；若当前 presentation 存在缺失或非法时间，则整体回退到稳定数组顺序。这样 accumulated assistant snapshot 即使在原数组槽位原地替换，后续 delta 仍能作为晚于新思考的活动。该位置只属于当前浏览器 presentation，不复用 timeline sequence、history ordinal、Message sequence 或持久化契约。`ProcessPanel` 和 `useProcessEntryDisclosure` 不读取或推断 `stageNote`、`final`、Provider `finishReason` 或文字含义。

运行阶段中，当一个非 final 过程条目的最后活动位置早于最新可见助手文字位置时，该条目只进入“视觉上已被后续公开输出接替”的自动 disclosure 状态：

- 若条目未被用户手工覆盖，立即收起其 detail；
- 不改变条目的持久化事实、`isFinal`、标题、状态图标或历史内容；
- 不收起整个 ProcessPanel，也不触发 completed-answer handoff；
- 若同一条目随后收到展示位置更晚的过程更新，且仍未被用户手工覆盖，则恢复为当前自动展开条目；
- 若出现新的思考、工具或系统过程条目，继续使用既有活动判定和首次进入反馈；
- canonical `QUESTION` 补充信息的自动显示仍具有更高优先级。

该判断只表达“当前视觉焦点已经从上一过程 detail 转移到更晚的公开输出”，不表达公开文字的业务类别。阶段说明后继续调用工具时，上一 detail 保持收起，新工具步骤正常出现并展开；最终答案流式输出时也使用相同规则。成功完成后的整个面板收束仍只由第 5 节定义的 Turn 终态 handoff 决定。

### 5. 已完成答案与视觉 handoff

`TurnBlock` 只用现有 presentation 事实计算：

```text
hasCompletedAnswerPresentation =
  status === "COMPLETED" && hasAnswerContent
```

该判断不读取 Web 流中不存在的 `payload.final`，不判断 stage note，也不根据文字、长度、时长或 Provider `finishReason` 猜测语义；`buildAnswerContent()` 及答案区域保持不变。

当已完成答案存在、视口跟随底部、面板和条目均未被用户手工展开，且 run 不存在未解决的 canonical `QUESTION` 补充信息时，ProcessPanel 在该 committed render 收束为摘要行，并把当前 run 的自动面板模式锁存为 `auto-collapsed`。后续 viewport following 变化或稳定重渲染不重新展开、不二次收束；只有用户主动展开或失败恢复可以改变该状态。

用户离开底部时保持过程布局；任一手工展开或收起状态优先。系统自动收束的面板进入 failed 时重新打开过程目录；未解决的 `QUESTION` 补充信息重新显示对应待处理 detail。公开文字交接和补充信息关联都只按既有 normalized envelope identity、`pendingInputId` 与 composed presentation 顺序计算，MUST NOT 把 timeline sequence、history ordinal 或 Message sequence 当作同一全局序列比较或重排：`USER_INPUT_REQUIRED` 开始等待，matching `USER_INPUT_RECEIVED`、有效 durable `pendingInputAnswer`、`USER_INPUT_TIMEOUT` 或 `USER_INPUT_CANCELED` 结束等待；非 `QUESTION` kind 不进入该例外路径。等待判断与条目标题、final 状态 MUST 共用同一个 supplemental state，不分别解释 timeout/cancel。

### 6. 三宿主共享

所有改动只落在共享 chat workspace。local、immersive 和 collaborative 不增加宿主分支、宿主 CSS 或独立状态 owner。

### 7. 失败与降级

- 缺少活动 key 时不猜测替代行。
- 不支持 `ResizeObserver` 时只使用已有 layout effect，不增加轮询。
- reduced-motion 下取消非必要动画，但保留活动节点、标题层级和 `aria-current`。
- Turn 尚未成功完成或没有可见答案时不触发答案 handoff。
- 运行中公开助手文字只允许收起顺序更早且未被手工覆盖的步骤 detail；不得据此改变条目事实或收起整个面板。
- 缺少滚动回调时不直接操作 DOM 滚动。
- `QUESTION` 补充信息缺少有效 `pendingInputId` 时 fail closed；root/run 关联复用既有 normalized envelope identity，不新增第二套关联规则。matching timeout/cancel 结束等待并把同一条目置为 final，其他 pending kind 保持由其既有 owner 呈现。

## 质量属性与验证

| 属性 | 设计结论 | 验证 |
|---|---|---|
| 安全 | 不读取隐藏 Message，不新增 API、配置、内容存储或输出策略 | architecture review |
| 性能 | 线性 key 比对；进入动画只用 opacity/transform | component + E2E |
| 可靠性 | 活动、disclosure、viewport、Turn 终态各有唯一 owner | scope/negative tests |
| 可访问性 | 状态不依赖动画，焦点不迁移 | component tests |
| 三宿主 | 共用 ProcessPanel/TurnBlock | modes build + Playwright |

验证至少覆盖：

- 活动行唯一、终态/history 移除、原图标不变；
- 浅色与深色主题的活动节点使用无布局位移的外圈呼吸，深色主题光晕范围受控，reduced-motion 退化为静态提示；
- 更晚的可见助手文字开始输出时，上一步立即移除呼吸、静态活动强调与 `aria-current`，后续过程活动可恢复唯一活动提示；
- 新行只反馈一次、history/reduced-motion 不反馈；
- following、暂停和恢复；
- 自动完成条目无延迟收起，手工状态跨后续步骤保持；
- 包含 PIU 结构化内容的 detail 自动收起、用户主动展开和再次收起保持可用，且测试不锁定其挂载策略；
- local mock 使用固定的 `network-diagnostic@1.0.0/render` 开发测试 renderer 呈现可交互 PIU 卡片，用于手工观察 PIU detail 自动收起、重新展开和重新挂载；该 renderer 不注册公共契约、不替代真实 PIU 包，未知 PIU 保持既有 no-op 行为；
- local mock 额外提供 `piu-answer` 用例，按 `ANSWER/TEXT → ANSWER/PIU → LLM_CONTENT_DELTA` 顺序展示前置说明、答案区 PIU 和后续模型总结，用于验证结构化答案与普通文本遵循同一 composed answer 顺序；
- 执行中的 content 不 handoff，已完成且有可见答案才 handoff；
- 离开底部和手工展开不被自动收束；
- 自动收束后的 failed 恢复过程目录、手工收起保持、未解决 `QUESTION` 恢复对应 detail；
- `QUESTION` 的 received、durable answer、timeout、cancel 和非 `QUESTION` negative cases；
- 成功面板重开为折叠目录；
- 三宿主一致。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-1.1-查看会话消息流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-process-panel/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
