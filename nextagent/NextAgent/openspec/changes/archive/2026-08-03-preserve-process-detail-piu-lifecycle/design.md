## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.6 前端定制` | Process Detail 的 PIU 在视觉折叠期间保留交互实例，owner 移除时结束容器生命周期 | `agent-web-process-panel` | `FN-10.6 前端定制` |

## Canonical Requirement 归属

| Canonical spec / Requirement | 所属 Function | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `agent-web-process-panel` / `Automatic process disclosure preserves the next visual focus` | `FN-10.6` | 原位 `MODIFIED` | 保留该 Requirement 的自动 disclosure、手工覆盖和 run-scope reset 行为；其他 Requirements 原位不变 | 本文 `FN-10.6 前端定制` 修改方案 | stable spec 保留并补充 Function 元数据；`FN-10.6` 将其登记为主规格；其他 specs 保持当前职责；spec-to-design-map 仅刷新生命周期摘要，不退役导航 |

该 Requirement 与过程面板 disclosure 黑盒边界完全匹配，因此选择同 spec 原位 canonicalize，不创建新的平行 spec。当前 active changes 中没有其他 change 修改该 Requirement。

## `FN-10.6 前端定制`

### 目标与规范依据

本设计使视觉折叠不再等同于已挂载 PIU 的 owner 销毁，同时保持普通 Detail 的既有卸载和过程面板 disclosure 行为。

#### 本 Function 的目标 Requirements

canonical spec：`agent-web-process-panel`

- `MODIFIED`：`Automatic process disclosure preserves the next visual focus`

### 当前实现

- `ProcessPanel` 将 `ProcessDisplayEntry.structuredSegments` 交给 `AnswerSegments`；`toolMessageType: "PIU"` 由 `PiuMessage` 渲染。
- `useProcessEntryDisclosure` 用 `expandedKeys`、`visibleKeys` 和 `renderedKeys` 同时管理语义展开、视觉过渡和 React render membership。自动收起、手工收起与 reduced-motion 收起最终都会从 `renderedKeys` 删除条目。
- `ProcessPanel` 在整个面板收起完成后把 `isProcessPanelRendered` 设为 `false`；完成答案交接会立即停止渲染面板子树。
- `PiuMessage` 挂载后的 effect 调用 `Prel.autoLoad`，随后调用 `piu.emit`。effect 没有取消迟到加载结果或清空容器的 cleanup，且 `content` 对象 identity 变化会重复执行 effect。
- `buildProcessEntries` 会预判 `CAPABILITY_COMPLETED` 是否提供 canonical safe result，但当前把 `"<toolName> completed"` 这类纯 lifecycle text 也视为 canonical body，导致 message-derived PIU entry 在自动 disclosure 前被 generic completion entry 替换。
- 现有 disclosure tests 断言普通 Detail 折叠后离开 `renderedKeys`；结构化渲染 tests 只覆盖单次挂载 emit，没有覆盖折叠、重新展开或 owner 移除。
- `PIU` host contract 只有 `attach` 和 `emit`，没有通用 `dispose`/`destroy` API；现有 `PiuRenderer` 的可用清理模式是取消迟到 emit 并在 unmount 时清空容器 DOM。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 已挂载 PIU Detail 折叠时保持同一实例 | Entry 和整个面板折叠都会卸载 React 子树 | disclosure 缺少 PIU-only 的 persistent render membership |
| 折叠期间不可见且不可交互 | 当前卸载自然移除交互；保留挂载后仅有高度/透明度不足以阻止焦点进入 | 保留子树时需要同时设置 `aria-hidden` 和 `inert` |
| 折叠/展开不重复初始化 | `PiuMessage` effect 依赖解析后 `content` 对象 identity | 需要按 PIU 内容值稳定 effect，而不是按临时对象 identity |
| generic completion 后仍有同一 PIU owner | canonical completion 预判没有排除 lifecycle-only text | 需要复用现有 generic completion 判定，只让真实 safe body 替换 structured PIU entry |
| owner 移除结束容器生命周期 | `PiuMessage` 没有 cleanup | 需要取消迟到 emit 并清空容器 DOM |
| 普通 Detail 和未查看 PIU 不增加驻留成本 | 全部 key 共用同一个 render-removal 策略 | 必须只保留已进入 `renderedKeys` 的 PIU key，不得预挂载或全局 pin |

### 修改方案

`frontend/agent-web` 是唯一实现 owner。修改沿用现有 `ProcessPanel → useProcessEntryDisclosure → AnswerSegments → PiuMessage` 路径，不新增 store、context、public contract 或后端状态。

1. `buildProcessEntries` 的 canonical completion 预判复用既有 `isGenericCapabilityCompletionText`：显式 `safeResult`、`safeSummary`、`contentUnavailable` 或非 lifecycle-only 的 `content`/`text` 仍替换 message-derived structured entry；`completed`、`capability completed`、`<toolName> completed` 等纯状态文本不得替换 PIU owner。
2. `ProcessPanel` 从当前 `processDisplayEntries` 派生 `persistentDetailKeys: ReadonlySet<string>`。只有 `structuredSegments` 中至少一个 structured segment 的 `toolMessageType` 为 `PIU` 时，entry key 才进入该集合。该集合是当前投影的可信 view data；scope 改变或 entry 移除会自然删除 key。
3. `useProcessEntryDisclosure` 接收 `persistentDetailKeys`。收起操作仍删除 `expandedKeys` 和 `visibleKeys`；若 key 已在 `renderedKeys` 且属于 persistent 集合，则取消已有 removal timer 并保留 render membership。key 尚未进入 `renderedKeys` 时不添加它，因此折叠 PIU 不会被预挂载。`retainValidKeys` 继续在 entry 移除时删除所有失效 key。
4. `ProcessPanel` 只要 `renderedKeys ∩ persistentDetailKeys` 非空，就保留整个面板 React 子树，即使面板视觉状态已收起或完成答案交接。外层面板和 entry detail 在不可见时设置 `aria-hidden` 与 `inert`，高度、透明度和过渡仍由既有状态控制。重新展开复用相同 keyed entry 和 `PiuMessage` 实例；承载 entries 的内容根节点以 `rootMessageId + displayRunId` 为 React key，确保 scope 替换时即使 entry key 相同也先卸载旧 PIU owner。
5. `PiuMessage` 为容器增加 ref。effect 按 JSON-safe PIU 内容值生成稳定 dependency；相同内容因父组件重渲染产生新对象时不重新加载或 emit，内容值真正变化时仍执行既有更新路径。cleanup 标记当前加载为 cancelled 并清空捕获的容器 DOM；迟到的 `autoLoad` resolve 检查 cancelled 后直接返回。
6. 不向 `PIU` interface 增加 `dispose`，也不发送未定义的 `destroy` event。当前 host contract 下，前端保证只覆盖自己拥有的异步回调和 DOM 容器；外部 PIU 自身创建且脱离容器的资源仍由外部 PIU 管理。

私有集合语义如下：

| entry 条件 | 当前是否已 rendered | 收起后的 `renderedKeys` | 结果 |
|---|---:|---:|---|
| 不含 PIU | 是 | 删除 | 保持既有卸载行为 |
| 含 PIU | 否 | 不添加 | 不提前挂载 |
| 含 PIU | 是 | 保留 | 只隐藏并禁止交互 |
| entry/scope 移除 | 任意 | 删除 | React unmount 并执行容器 cleanup |

#### 备选方案（Alternatives Considered）

- 保留所有 Process Detail：实现更短，但长会话会持续保留 Markdown、RAG、DSL 与普通文本 DOM，扩大容量风险，因此不采用。
- 允许卸载并用全局 registry 抑制重复 emit：可以减少调用，但不能保留 PIU 内部 DOM、焦点、表单和外部组件状态，因此不满足目标。
- 新增通用 PIU `dispose` contract：能治理更多外部资源，但当前 host 没有该契约，修改会扩大为跨系统公共协议 change；本次只采用已有容器 ownership 能保证的 cleanup。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由功能性 Requirement 的实例复用与 owner cleanup 派生 | PIU-only persistent keys、迟到加载取消、容器 cleanup | 折叠/展开保持节点 identity 和状态；unmount 后不 emit |
| 性能/容量 | 无新增黑盒质量目标；由功能性 Requirement 的非 PIU 卸载边界派生 | 只保留已经挂载的 PIU Detail，不预挂载、不 pin 普通 Detail | 非 PIU 仍按 timer/reduced-motion 退出 render tree；未查看 PIU 不调用 loader |
| 可测试性 | 无新增黑盒质量目标；由功能性 Requirement 的可观察调用与 DOM 状态派生 | 将 PIU 判断保持为纯派生集合，复用现有 disclosure hook 和 fake-clock tests | 自动、手工、面板级、reduced-motion、scope replacement 都有确定断言 |

## 验证策略（Verification Strategy）

- hook unit tests 覆盖 persistent key 的自动、手工和 reduced-motion 收起，以及普通 key 继续卸载、失效 key 被清除。
- ProcessPanel component tests 用真实 `AnswerSegments`/`PiuMessage` 和 mock host 覆盖 entry/面板折叠后 DOM 节点 identity、交互值、`inert` 与 loader/emit 次数。
- PiuMessage component tests 覆盖相同内容重渲染不重复 emit、内容变化仍更新、unmount 前未完成加载不会迟到 emit、容器 DOM 被清空。
- process projection tests 覆盖 lifecycle-only completion text 保留 message-derived PIU，而真实 canonical safe body 继续替换 live structured detail。
- negative tests 覆盖未查看 PIU 不预加载、普通 Detail 不被持久保留、最终答案和 Expand Panel 路径不受 persistent key 规则影响。
- 前端 TypeScript build、受影响 Vitest 集合与 OpenSpec strict validation 共同覆盖实现和规范一致性；语义 review 检查 browser view-state ownership 未越界。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-process-panel/spec.md`：归档时合并修改后的 Requirement，并补充 `FN-10.6` 主规格元数据。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：刷新 Process Detail PIU 生命周期结果和主规格导航。
- `openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.6-前端定制.md`：补充用户可依赖的 PIU 折叠状态保持保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-ui-state.md`：补充 stateful Process Detail 的 visibility 与 render membership 分离边界。
- `openspec/designs/modules/agent-web.md`：补充 `ProcessPanel` 对 PIU-only persistent render membership 和 `PiuMessage` container cleanup 的职责。
- `openspec/designs/adr/`：无；本 change 沿用既有 browser view-state owner，无需新增长期决策记录。
- `openspec/designs/spec-to-design-map.md`：刷新 `agent-web-process-panel` 的 PIU disclosure 生命周期摘要与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 已查看的 PIU 在当前 run scope 内会比普通 Detail 驻留更久，增加少量 DOM/内存占用。通过 PIU-only、首次挂载后才保留、entry/scope 移除即卸载控制范围。
- `inert` 依赖当前支持的浏览器能力；TypeScript build 和三宿主浏览器 smoke 是兼容门禁。样式仍使用既有高度/透明度路径，因此不改变视觉过渡。
- host 没有通用 dispose contract，容器外资源无法由本前端强制回收。当前实现取消迟到 emit 并清空 owner DOM；若未来 host 提供正式 dispose，需要独立 contract change。

## 待确认问题（Open Questions）

无。
