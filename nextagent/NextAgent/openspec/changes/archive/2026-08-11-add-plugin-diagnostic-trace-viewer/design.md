## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.33 查看插件诊断轨迹` | 新增离线导入、精确分轨、稳定排序、局部降级和只读呈现能力 | `plugin-diagnostic-trace-viewer` | `FN-10.33 查看插件诊断轨迹` |

## `FN-10.33 查看插件诊断轨迹`

### 目标与规范依据

本设计满足 proposal 中“无需启动 NextAgent 或上传诊断内容，即可按会话与请求复盘本地 NDJSON”的黑盒目标，并保持查看能力与插件运行时装载边界分离。

#### 本 Function 的目标 Requirements

canonical spec：`plugin-diagnostic-trace-viewer`

- `ADDED`：`查看器按会话和请求区分执行轨迹`
- `ADDED`：`查看器以确定顺序呈现轨迹事件`
- `ADDED`：`查看器按事件阶段展示核心指标`
- `ADDED`：`单行错误只降级当前记录`
- `ADDED`：`查看过程保持本地只读边界`
- `ADDED`：`查看器作为本地运行包的插件伴随文件交付`

### 当前实现

- `@nextagent/agent-plugin-sdk/developer-hook-trace` 已提供 `createDeveloperHookTracePluginArtifact`，生成 `plugin.json` 和自包含的 `index.js`，并返回固定文件清单。
- `scripts/pack-local-runtime.mjs` 通过上述 helper 把官方调测插件生成到本地运行包的 `config/plugins/developer-hook-trace`；当前没有独立查看器资产或 companion 文件复制步骤。
- 插件 manifest 只声明 `index.js` 为 `main`；plugin loader 只读取 manifest 和主入口源码，不读取同级任意 HTML 文件。
- 当前没有消费 developer diagnostic artifact NDJSON 的独立界面，也没有对应浏览器行为测试。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 导入本地 NDJSON 并按精确坐标区分全部轨迹 | 只有 NDJSON writer 和人工文本阅读路径 | 缺少独立解析、分组、选择与流程呈现能力 |
| 稳定显示事件时序、阶段核心指标和完整原始记录 | 已显示三个目标 stage 的基础摘要，但模型结果只突出 Tool 调用 | 缺少首次反馈时延、模型端到端时延和 provider usage 的核心展示 |
| 非法行局部降级 | 无查看器输入校验 | 缺少逐行错误分类和无合法轨迹状态 |
| 离线、只读且不接入运行时 | 当前插件 artifact 仅有运行时文件 | 缺少自包含 companion HTML 及其安全边界验证 |
| 本地运行包交付查看器 | 打包 composition 只调用既有 helper，插件目录固定只有两个运行时文件 | 缺少独立查看器资产及其 companion 文件复制、打包断言 |

### 修改方案

唯一实现路径如下：

1. `agent-plugin-sdk/assets` 是独立查看器静态资产的 owner，直接保存完整 UTF-8 `developer-hook-trace-viewer.html`。该文件不被 `developer-hook-trace` TypeScript 源码导入，也不建立新的 package export、公共类型或运行时 API。
2. `createDeveloperHookTracePluginArtifact`、`DeveloperHookTracePluginArtifactResult`、`pluginManifest()`、`index.js` 和插件 factory host contract 全部保持不变；既有 helper 仍只生成并枚举 `plugin.json`、`index.js`。
3. `scripts/pack-local-runtime.mjs` 在既有 helper 完成后，从明确的 repo asset 路径把 HTML 复制到同一个目标插件目录。打包 composition 是运行时插件文件与 companion 文件发生组合的唯一位置，不增加资产发现或第二个插件生成器。
4. HTML 使用内联 CSS 和内联原生 JavaScript，不引用 CDN、字体、图片或 source map。Content Security Policy 禁止默认外部资源和网络连接，仅允许本文件的内联样式与脚本执行。
5. 页面使用 `<input type="file">` 与 `File.text()` 读取一份文件。解析状态只存在页面内存，不使用 `localStorage`、`sessionStorage`、IndexedDB、Cache API、cookie 或 service worker。
6. 每个非空输入行先执行 `JSON.parse`，再依次验证 object、顶层 `sessionId`、顶层 `requestId`。失败记录保存 `{ lineNumber, reason }`；合法记录保存 `{ lineNumber, value, timestamp }`。页面不修改输入对象，也不回写原文件。
7. 内部分组键使用嵌套 `Map<sessionId, Map<requestId, Trace>>`，避免字符串拼接碰撞。轨迹列表使用首次出现顺序，初始轨迹为第一个合法记录所属轨迹。
8. 每条轨迹复制事件数组后执行稳定比较：两个有效时间按毫秒升序，再按行号升序；只有一个时间有效时有效者在前；均无有效时间时按行号升序。相邻耗时只在当前事件和前一个有效时间事件均有时间时计算，负差值以 `0 ms` 显示，其他情况显示不可用。
9. 页面只通过 `textContent` 和 DOM element API 写入导入内容，不使用 `innerHTML`、`insertAdjacentHTML` 或动态脚本执行。原始详情使用 `JSON.stringify(value, null, 2)` 后赋给 `<pre>.textContent`。
10. 事件节点在渲染阶段调用单一 `coreMetricsOf(value)` 映射函数。函数先复用最终显示 stage，再只读取该 stage 对应的 `payload.boundary` 路径：`BEFORE_PLANNING` 读取 `flowVariables.input_question`；`AFTER_MODEL_RESULT` 按固定顺序读取 `firstContentLatencyMs`、`modelE2ELatencyMs`、`usage`、`toolCalls`；`BEFORE_CAPABILITY_INVOKE` 读取 `capabilityId`。每个缺失值独立返回“不可用”，其他 stage 返回空指标列表。时延数值追加 ` ms`，array/object 使用 `JSON.stringify` 后通过 `textContent` 呈现。

不修改 `agent-dev-workbench`、`frontend/agent-web`、plugin loader、manifest schema、host externals、developer diagnostic writer 或公共 `agent-contracts`。查看器不是插件 contribution，也不因与插件同目录而获得运行时权限。

#### 私有数据结构

| 对象 | 字段 | 约束与来源 | owner 与生命周期 |
|---|---|---|---|
| `TraceEvent` | `lineNumber: number`、`value: object`、`timestamp: number \| null` | 行号从 1 开始；`value` 来自该行 JSON object；只有 `recordedAt` 可被 `Date.parse` 解析时保存毫秒时间 | 查看器页面；每次导入整体替换，页面关闭即释放 |
| `Trace` | `sessionId: string`、`requestId: string`、`events: TraceEvent[]` | 两个 ID 均来自顶层非空字符串；events 只含精确同坐标记录 | 查看器页面；内存态 |
| `ImportIssue` | `lineNumber: number`、`reason: enum` | reason 为 `INVALID_JSON`、`NOT_OBJECT`、`MISSING_SESSION_ID`、`MISSING_REQUEST_ID` 之一，按校验顺序选择 | 查看器页面；内存态 |

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `查看过程保持本地只读边界` | CSP、无外部资源、无网络 API、无持久存储、所有导入文本经 `textContent` 呈现 | 在本地文件上下文导入含 HTML 字符串的 fixture，断言不执行且无网络请求和存储写入 |
| 可靠性/恢复 | `单行错误只降级当前记录` | 逐行独立解析和稳定原因分类；新导入原子替换前一次页面状态 | 混合合法/非法行仍呈现合法轨迹；全非法输入显示明确空状态 |
| 可维护性 | 无新增黑盒质量目标 | 解析、分组、排序、DOM 呈现按单一职责函数分离；打包 composition 是 companion 组合的唯一入口 | 源码语义检视确认插件实现和 helper 零 diff，未引入平行运行时路径 |
| 可测试性 | 无新增黑盒质量目标 | 真实静态 HTML 作为浏览器测试对象，既有 helper 回归与本地包边界分别断言 | unit/浏览器/integration 三层验证同一静态资产 |
| 审计/可追溯性 | `查看器以确定顺序呈现轨迹事件`、`查看器按事件阶段展示核心指标` | 节点保留原始行号和完整 JSON；阶段摘要使用确定路径映射且不改写原记录 | 验证排序与详情一致，并以真实边界 shape 断言三个 stage 的摘要值及缺失降级 |

## 验证策略（Verification Strategy）

- unit 层验证静态 HTML 自包含约束，并以既有插件 SDK 测试确认 artifact helper 仍返回和生成原来的两个文件。
- 浏览器行为层直接打开 repo 静态资产的 `file://.../developer-hook-trace-viewer.html`，导入包含多轨迹、乱序、非法行、三个目标 stage 核心指标和 HTML 字符串的 fixture，验证精确分轨、切换、排序、阶段摘要、局部降级、原始详情与无脚本执行。
- 浏览器安全负例通过请求监听和页面状态检查确认导入流程没有网络访问，源码约束确认不引用浏览器持久存储 API。
- integration 层验证本地运行包 staging 后三个文件同级存在；既有 plugin loader contract test 继续证明未声明 HTML 不参与装载。
- architecture 和人工语义检视确认没有修改 `agent-dev-workbench`、前端产品 owner、插件 manifest/host contract 或诊断 writer。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/plugin-diagnostic-trace-viewer/spec.md`：新增 `FN-10.33` 的稳定行为契约。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.33-查看插件诊断轨迹.md`：新增 Function 导航、黑盒输入输出和关键规格。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.2-装配插件.md`：把 `FN-10.33` 纳入组成 Functions，并补充离线复盘用户价值。
- `openspec/overview.md`：补充官方调测插件产物可离线复盘的长期产品能力。
- `openspec/designs/architecture/agent-plugin-composition.md`：记录 companion 文件不属于 plugin contribution、loader 不读取的边界。
- `openspec/designs/modules/agent-plugin-sdk.md`：记录独立自包含查看器资产及其不进入插件实现/helper 的边界。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：新增 `plugin-diagnostic-trace-viewer` 到 `FN-10.33`、模块、架构和验证入口的唯一导航。

## 风险与取舍（Risks / Trade-offs）

- 单文件 HTML 体积较大；以插件实现零改动和直接离线使用为优先，将其保留为独立静态资产，并由唯一打包 composition 复制。
- 浏览器一次性读取整个文件会受可用内存限制；本 change 不承诺超大文件流式解析，避免在首版引入 worker、分块协议和可取消状态机。
- developer diagnostic artifact 可能包含敏感调测内容；查看器通过纯本地处理降低扩散面，但文件本身的访问控制与保留仍由既有产物边界负责。

## 待确认问题（Open Questions）

无。
