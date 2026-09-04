## 1. `FN-1.22 展示会话消息正文`

- [x] 1.1 为三个稳定复现场景建立失败回归测试：`A.1.a` 保持在列表项内、任务列表显示受控状态且原始输入不可交互、GFM 表格对齐传递到全部 th/td。
  来源：`FN-1.22` + `点分标识符保持所属正文结构` / `列表项保留点分标识符`、`任务列表以受控不可交互状态展示` / `展示选中和未选中任务`、`不可信输入元素保持不可交互`、`GFM 表格保留列对齐语义` / `表头和数据使用同一列对齐`、`整理后的表格保留对齐`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/markdownFormatting.test.ts tests/TurnBlock.test.tsx tests/markdown-gfm-table.test.tsx`；实施前新增断言必须失败并对应三个现有缺陷。
  执行记录：2026-08-10 运行扩展后的 focused suite，新增断言共触发 8 个预期失败，分别覆盖点分标识符、任务状态、表格 alignment/style、Sidebar breakpoint 和 floating overlay 位置；既有 151 个断言通过。

- [x] 1.2 修改 Markdown 预处理、任务状态 renderer 与 sanitizer，使点分标识符和真实列表边界同时正确，任务状态不可交互且原始 input/event/script 继续 fail closed。
  来源：`FN-1.22` + `点分标识符保持所属正文结构` 的全部 Scenarios；`FN-1.22` + 系统质量属性“安全” + `任务列表以受控不可交互状态展示` 的全部 Scenarios；design `FN-1.22 展示会话消息正文 / 修改方案` 第 1–2 项
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/markdownFormatting.test.ts tests/TurnBlock.test.tsx`；全部通过，DOM 不包含 task-list 标签字符串、可交互 input 或事件处理器。
  执行记录：2026-08-10 作为 focused suite 的一部分运行，`markdownFormatting.test.ts` 11/11、`TurnBlock.test.tsx` 93/93 通过；原始 input/script 以及伪造 checkbox class/role 的 negative case 均未生成交互或受控状态节点，只有 renderer 生成的 GFM task state 可进入允许列表。

- [x] 1.3 扩展 `TableSegment` 和 `TableBlock`，保存并投影 divider alignment，异常表格修复与追加行保持同列对齐。
  来源：`FN-1.22` + `GFM 表格保留列对齐语义` 的全部 Scenarios；design `FN-1.22 展示会话消息正文 / 修改方案` 第 3–4 项
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/markdown-gfm-table.test.tsx`；左、右、居中和默认列的 th/td 及整理后表格断言全部通过。
  执行记录：2026-08-10 运行 `markdown-gfm-table.test.tsx`，12/12 通过；普通表格与空行追加行均保持 alignment。

- [x] 1.4 调整消息样式和共享布局，使表格后续标题保持 `16px`、窄表格内部滚动、Sidebar 在 `720px` 以下自动收起，浮动置底入口拥有不覆盖正文的安全区域。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` 的全部 Scenarios；design `FN-1.22 展示会话消息正文 / 修改方案` 第 4–7 项
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.test.tsx tests/markdown-gfm-table.test.tsx tests/sidebar.component.test.tsx tests/right-pane-layout.scroll-shell.test.tsx`；样式、断点和 overlay inset 断言全部通过。
  执行记录：2026-08-10 运行包含上述文件的 focused suite，相关 148 个 component/style 断言全部通过；Sidebar 窄屏为 48px，floating overlay 右对齐并预留 72px bottom inset。

- [x] 1.5 使用 session `session-d50d99ff-49e8-45fb-9848-2b59baa5899f` 的最新模型消息，在相同宽屏和 `600px` 窄屏下完成修改前后截图与 DOM 几何对比。
  来源：`FN-1.22` + `点分标识符保持所属正文结构`、`任务列表以受控不可交互状态展示`、`GFM 表格保留列对齐语义`、`消息正文在宽窄视口保持可读`；design `验证策略`
  验证：浏览器检查 `A.1.a`、任务状态、表格对齐、表格到后续标题 `16px`、窄屏 Sidebar `48px`、无页面级横向溢出且置底入口不覆盖正文，并保存修改后截图和视觉对比 verdict。
  执行记录：2026-08-10 宽屏实测列对齐为 `left/right/center/start`，表格至后续标题为 `16px`；任务状态为两个禁用 `role=checkbox` 节点且无 input；600px 下 Sidebar 为 `48px` 且页面溢出为 `0px`；360px 下表格容器 `233px`、内容 `259px`，仅容器内部横向滚动；置底入口与消息滚动区重叠为 `0px`。视觉 verdict 为 96/100 PASS，前后截图已保存。新增 Playwright 用例 `assistant-markdown-rendering.spec.cjs` 使用浏览器计算样式和 `getBoundingClientRect()` 自动锁定上述语义与几何不变量，Chromium 1/1 通过。

- [x] 1.6 为第二轮可读性优化建立失败回归测试：窄屏表格和 Mermaid 内容宽度至少 `560px`。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` / `窄视口保留表格列结构`、`窄视口保留 Mermaid 标签可读性`、`宽视口使用共享消息列宽度`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/markdown-gfm-table.test.tsx tests/lazy-mermaid.component.test.tsx` 和 Playwright `assistant-markdown-rendering.spec.cjs`；实施前新增断言必须对应现有压缩行为失败。
  执行记录：2026-08-10 实施前 focused tests 证明表格 `min-width` 仍为 `100%`、Mermaid 没有内部滚动和 `560px` 内容宽度；同时试验过 prose `820px` 边界，随后依据用户明确反馈由任务 1.11 移除。

- [x] 1.7 仅修改共享消息展示样式，使表格与 Mermaid 在窄视口保留 `560px` 内容宽度并内部滚动。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` 的三项新增 Scenarios
  验证：组件测试和 Playwright 几何断言通过；页面级横向溢出保持 `0px`。
  执行记录：2026-08-10 使用三个具名样式常量完成共享路径修改；实际复测发现 Mermaid 居中 flex 会让左侧溢出不可达，随后将已渲染图形切换为起始侧排列并增加完整滚动范围断言。focused tests 18/18、Playwright Chromium 1/1 通过。

- [x] 1.8 使用 session `session-d50d99ff-49e8-45fb-9848-2b59baa5899f` 在 `1280px` 与 `360px` 相同视口复测并保存修改后截图，输出表格行高、内部内容宽度、Mermaid 宽度和普通正文宽度的前后对比。
  来源：design `验证策略`
  验证：同会话、同视口的截图和 DOM 几何测量均证明三项布局不变量成立，并保存视觉 verdict。
  执行记录：2026-08-10 最终方案不设置 `820px max-width`。1280px 实际会话在当前侧栏状态下 `.markdown-content`、prose、表格、代码和 Mermaid 外层均为 `950.8px`，自动化夹具下均为 `1016px`，prose 计算样式均为 `max-width: none`；360px 表格由 `259px` 增至 `560px`，最长行高由约 `401px` 降至约 `89px`；Mermaid SVG 由约 `209px` 增至 `560px`，完整内部滚动范围为 `584px`；页面级溢出均为 `0px`。三组前后截图已保存。

- [x] 1.9 为浮动置底入口建立失败回归测试：入口在正文列水平居中，正文滚动视口使用完整 overlay 实际高度作为 bottom inset。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` / `浮动置底入口不覆盖正文`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/right-pane-layout.scroll-shell.test.tsx`；实施前断言必须证明旧实现仍为右对齐并使用固定 `72px`。
  执行记录：2026-08-10 新增回归断言后，旧实现因 `justify-content: flex-end` 与固定 `72px` bottom inset 失败，证明问题可稳定复现。

- [x] 1.10 移除浮动入口右对齐和固定安全区估算，改为正文列水平居中并测量完整 overlay layer 高度；使用实际 session 在宽窄视口复测无遮挡。
  来源：design `FN-1.22 展示会话消息正文 / 修改方案` 第 7 项
  验证：组件测试、Playwright 几何断言和实际会话截图证明按钮中心对齐偏差不超过 `1px`，scroll viewport 与 overlay 不重叠。
  执行记录：2026-08-10 改为 `useLayoutEffect` 在首帧同步测量完整 overlay layer，并用 `ResizeObserver` 跟踪后续高度变化；360px 实际会话中按钮与浮动正文列中心完全一致，overlay 高 `183.6px`，scroll viewport 与 overlay 重叠为 `0px`，页面级横向溢出为 `0px`。

- [x] 1.11 移除 prose segment 的 `820px max-width`，确保正文、表格、代码和 Mermaid 外层都只复用共享消息列的响应式宽度。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` / `宽视口使用共享消息列宽度`
  验证：组件测试断言 prose 不含固定 `max-width`，Playwright 在 `1280px` 断言正文、表格、代码和 Mermaid 外层与 `.markdown-content` 宽度差不超过 `1px`。
  执行记录：2026-08-10 已移除 prose 的固定最大宽度；1280px 实际会话在当前侧栏状态下正文、表格、代码和 Mermaid 外层均为 `950.8px`，自动化夹具下均为 `1016px`，两种状态与各自 `.markdown-content` 差值均为 `0px`，prose 计算样式为 `max-width: none`。

- [x] 1.12 为 composer 可见外边界与共享 footer 内容列对齐建立失败回归测试。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` / `Composer 对齐共享 footer 内容列`
  验证：Playwright 在 `1280px` 和 `360px` 断言 composer 可见外边界与共享 footer 内容列的左右偏差和宽度差均不超过 `1px`；实施前诊断断言必须证明既有两侧各 `4px` 缩进。
  执行记录：2026-08-10 实施前诊断断言失败，DOM style 实测为 `0px 4px`，对应 composer 可见外边界左右各缩进 `4px`；最终回归改为浏览器几何断言，避免把私有 style shape 固化为黑盒契约。

- [x] 1.13 删除 `chat-composer-dock` 的 padding，并在实际会话宽窄视口确认 composer 仍由共享 footer 列约束且 overlay 不覆盖消息。
  来源：design `FN-1.22 展示会话消息正文 / 修改方案` 第 10 项
  验证：浏览器几何回归通过；composer 可见外边界与共享 footer 内容列同宽，页面级溢出和 scroll viewport/overlay 重叠均为 `0px`。
  执行记录：2026-08-10 删除唯一 dock padding 声明；1280px 与 360px 实际会话中 composer 可见外边界均与共享 footer 内容列对齐。360px 下二者均为 `265px`，宽度差为 `0px`；页面级横向溢出和 scroll viewport/overlay 重叠均为 `0px`。

- [x] 1.14 为完整 main viewport、footer surface bottom safe area 和 Skill/footer 遮罩建立失败回归测试，明确取代任务 1.9–1.10 的 viewport bottom inset 策略。
  来源：`FN-1.22` + `消息正文在宽窄视口保持可读` / `完整滚动 viewport 与动态底部安全区`、`浮动置底入口不遮挡可读正文`、`Skill 选择区域不透出历史消息`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/right-pane-layout.scroll-shell.test.tsx` 与 Playwright `assistant-markdown-rendering.spec.cjs`；实施前断言必须证明 viewport 底边随 overlay 高度上移、浮动入口出现时 client height 减少且 Skill/composer 所在区域为透明背景。
  执行记录：2026-08-11 实施前组件回归 5 项中 2 项失败，确认 viewport 未覆盖完整 main 且没有按 footer surface 高度提供内容安全区；实际会话基线中 main 高 `637.6px`，viewport 高仅 `453.6px`，浮动入口出现后 `clientHeight` 降为 `454px`。

- [x] 1.15 恢复 scroll viewport 对完整 main 的覆盖，只把 footer surface 实际高度迁移为滚动内容 bottom safe area，并为 Skill/composer surface 增加不透明页面背景遮罩；浮动置底入口保持独立透明浮层。
  来源：design `FN-1.22 展示会话消息正文 / 修改方案` 第 7 项
  验证：组件测试与 Playwright 证明 viewport/main 四边一致，浮动入口显隐不改变 viewport client height、scrollHeight 或 safe area，内容 safe area 跟随 footer surface 实际高度，Skill 到 composer 的 surface 背景不透明且不显示历史文字。
  执行记录：2026-08-11 `right-pane-layout.scroll-shell.test.tsx` 5/5 通过；Playwright 注入并选中 Skill 后 1/1 通过。实际会话中 viewport 与 main 四边一致且 `clientHeight=638px`，内容 `padding-bottom=128px` 跟随 `127.6px` footer surface；浮动入口 wrapper 保持透明，footer surface 复用聊天页面不透明背景。

- [x] 1.16 使用 session `session-d50d99ff-49e8-45fb-9848-2b59baa5899f` 在滚到底后回滚约一个置底按钮高度，保存修改前后截图和 DOM 几何对比。
  来源：design `验证策略`
  验证：截图与几何测量证明 viewport 底边从 overlay 上方恢复到 main 底边，浮动入口出现前后 viewport client height 与 scrollHeight 保持稳定，按钮周围不形成全宽遮罩带，最后内容可滚到 footer surface 上方且 Skill/composer 空隙无历史文字透出。
  执行记录：2026-08-11 已保存修改前后截图；修改后回滚 `48px` 时 viewport/main 底边均为 `685.6px`，`clientHeight=638px`、`scrollHeight=4085px`，浮动入口为 `44px` 高独立透明层，footer surface 从入口底边 `558px` 开始遮挡历史正文，右侧保留 `15px` scrollbar gutter。

## 2. Change 整体验证

- [x] 2.1 运行 OpenSpec、前端 focused/full build 和三宿主 artifact 门禁，确认没有新增依赖、公共契约或 host-specific Markdown 分叉。
  来源：proposal `影响范围` + design `验证策略`
  验证：`openspec validate refine-agent-web-markdown-semantic-fidelity --strict`、在 `frontend/agent-web` 运行 `npm run build`、相关 `npm test -- ...`、`npm run build:vite:modes`；命令均退出 0。
  执行记录：2026-08-10 本 change 严格校验通过；focused suite 5 个文件、159 个测试通过；Playwright Chromium 几何回归 1/1 通过；前端 TypeScript build 与 `build:vite:modes` 均退出 0。仓库级 `openspec validate --all --strict` 同时确认本 change 通过，但仍报告 3 个与本次范围无关的既有 active change 失败。

- [x] 2.2 运行第二轮样式优化的 OpenSpec、前端 focused tests、TypeScript build 和三宿主 artifact 门禁。
  来源：proposal `影响范围` + design `验证策略`
  验证：`openspec validate refine-agent-web-markdown-semantic-fidelity --strict`、相关 Vitest、Playwright、`npm run build`、`npm run build:vite:modes` 均退出 0。
  执行记录：2026-08-10 目标 change 严格校验通过；受影响 Vitest 6 个文件、165 个测试通过；Playwright Chromium 1/1 通过；前端 TypeScript build 与 `build:vite:modes` 均退出 0。Vite 仅保留既有 Ant Design `use client` 与非 module script 警告。

- [x] 2.3 运行 composer dock padding 删除后的 OpenSpec、前端 focused test、浏览器几何回归、TypeScript build 和三宿主 artifact build。
  来源：proposal `影响范围` + design `验证策略`
  验证：`openspec validate refine-agent-web-markdown-semantic-fidelity --strict`、相关 Vitest、Playwright `assistant-markdown-rendering.spec.cjs`、`npm run build` 与 `npm run build:vite:modes` 均退出 0。
  执行记录：2026-08-10 受影响 Vitest 6 个文件、165/165 通过，其中 `right-pane-layout.scroll-shell.test.tsx` 5/5 通过；Playwright 在 1280px 和 360px 均校验 composer 左右偏差及宽度差不超过 1px，Chromium 1/1 通过；目标 change 严格校验、前端 TypeScript build 和三宿主 artifact build 均退出 0。完整 `chat-page.route-state.test.tsx` 运行仍有 5 个与 padding 无关的既有异步/跨用例失败，涉及 pending input、历史执行详情、fork、附件和 submit。仓库级 `openspec validate --all --strict` 确认本 change 通过，但仍报告 3 个与本范围无关的既有 active change 失败。

- [x] 2.4 运行 viewport/footer overlay 修正后的 OpenSpec、前端 focused tests、浏览器几何回归、TypeScript build 和三宿主 artifact build。
  来源：proposal `影响范围` + design `验证策略`
  验证：`openspec validate refine-agent-web-markdown-semantic-fidelity --strict`、相关 Vitest、Playwright `assistant-markdown-rendering.spec.cjs`、`npm run build` 与 `npm run build:vite:modes` 均退出 0。
  执行记录：2026-08-11 受影响 Vitest 3 个文件、26/26 通过，其中 scroll shell 5/5；Playwright Chromium 1/1 通过；目标 change 与仓库全量 OpenSpec 严格校验分别通过（全量 246/246）；前端 TypeScript build 和三宿主 artifact build 均退出 0，仅保留既有 Vite/Ant Design 警告。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、Feature、module 和 spec-to-design-map；实施阶段不直接修改这些长期基线。
