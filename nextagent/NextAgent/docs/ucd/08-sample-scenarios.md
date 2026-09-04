# 典型场景样例（界面渲染视角）

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md`。当前事实必须与 stable/active OpenSpec、public contracts、当前代码和测试交叉核对；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。
>
> 本文从**最终渲染结果视角**呈现（只看界面长什么样，不看系统内部实现）：UCD 设计人员无需运行系统，直接查看每个场景下界面**期望渲染成什么样**。样例数据基于 `frontend/agent-web-mock-server` 的确定性输出。渲染样式用 Markdown 模拟，实际视觉样式（颜色/间距/图标）由 UCD 设计人员根据 `05-component-specs/` 决定。
>
> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：当前事实由 owning stable/active OpenSpec、代码和测试交叉确认；active change 尚待归档时会明确标注。任务准入以 owning spec 与 roadmap 为准。

## 阅读约定

- **用户消息气泡**用 `> 🧑 用户` 引用块表示。
- **助手消息气泡**用 `> 🤖 助手` 引用块表示。
- **思考过程**用 `<details>` 折叠块表示；live 可显示增量，history 可由 Event history 恢复已完成 thinking，但不恢复未完成 delta。
- **能力卡片**用表格 + 状态标签表示。
- **Pending input 卡片**用引用块 + 按钮链接表示。
- **降级提示**用 `> ⚠️ 降级` 引用块表示。
- **压缩通知**用 `> 📦 压缩` 引用块表示。
- **附件指示**用 `📎` 行内标签表示。
- **终态指示**用 `✅已完成` / `❌失败` / `⏹️已取消` / `🔁被取代` 表示。
- **live vs history**：Message history 与 Event history 共同重建完成的持久化事实；streaming 瞬态和未完成 delta 不重建。
- **mockup 格式**：场景 1-9 与 14-15 用 Markdown 引用块直接呈现；场景 10-13、16-23 因含大量 ASCII 框图，用 ``` 代码块包裹以保持等宽对齐。两种格式语义相同，UCD 设计人员应关注内容而非渲染方式。

## 旅程对应关系

本文档的 27 个场景与 [`01-user-journeys.md`](01-user-journeys.md) 的 27 个用户旅程对应关系如下（完整映射表见 `01-user-journeys.md` 末尾"旅程与场景对应表"）。场景 27 是面向多条旅程的长会话非功能验收场景。

| 场景 | 对应旅程 | 关系说明 |
|---|---|---|
| 1：正常路径 | 旅程 1（首次提问到答案输出） | 直接对应；旅程 6（上下文压缩）的压缩通知元素嵌入此场景 |
| 2：失败路径 | 旅程 1 的失败子路径 | 旅程 1 L6/L14 提到失败分支 |
| 3：Pending Input 全 kind 矩阵 | 旅程 3（Pending input 应答） | 一对多 |
| 4：附件上传 | 旅程 2（附件上传） | 直接对应 |
| 5：断线重连 | 旅程 4（断线重连） | 直接对应 |
| 6：路径被策略拒绝 | 旅程 7（路径被策略拒绝） | 直接对应 |
| 7：多轮思考与工具调用 | 旅程 12（多轮思考与工具调用） | 直接对应 |
| 8：多会话后台 run | 旅程 13（多会话后台 run） | 直接对应 |
| 9：长时运行 | 旅程 14（长时运行能力） | 直接对应 |
| 10：请求被取代（Supersede） | 旅程 8（编辑重发）+ 旅程 17（执行中发新消息） | 合并；两种触发路径共享 SUPERSEDED 终态 |
| 11：取消与重试 | 旅程 9（取消）+ 旅程 10（重试） | 合并 |
| 12：会话搜索与管理 | 旅程 15（会话搜索与管理） | 直接对应 |
| 13：分享与派生 | 旅程 11（从已完成 turn 派生） | 合并 |
| 14：Sub-agent 委派 | 旅程 16（Sub-agent 委派） | 直接对应 |
| 15：页面关闭与重开 | 旅程 18（页面关闭与重开） | 直接对应 |
| 16：Run Graph 完整执行流程 | 旅程 19（查看 Run Graph 完整执行流程） | 直接对应 |
| 17：右侧展开面板——地图故障分布 | 旅程 20（查看右侧展开面板的富内容） | 直接对应 |
| 18：打开 OSS 配置——导航卡片与集成方页面跳转 | 旅程 21（从对话通知集成方打开系统页面） | 直接对应 |
| 19：下载区域列表模板 | 旅程 22（下载 Agent 生成的文件） | 直接对应 |
| 20：在扩展面板中审核修改节能配置 | 旅程 23（在扩展面板中审核修改配置并保存） | 直接对应 |
| 21：开启节能自治——端到端复合场景 | 旅程 1+3+22+2+20+23+3+14 | 串联多个旅程 |
| 22：后台分离执行与任务追踪 | 旅程 24（监控后台任务执行） | 直接对应 |
| 23：创建和管理 Cron 定时任务 | 旅程 25（管理定时任务） | 直接对应 |
| 24：上下文压缩——长对话中的上下文窗口管理 | 旅程 6（上下文压缩） | 直接对应 |
| 25：宿主页面触发 AI 提问（sendQuestionToLui） | 旅程 26（宿主页面触发 AI 提问） | 直接对应；仅协作式（PIU）模式 |
| 26：并行工具调用 | 旅程 27（并行工具调用） | 直接对应 |

> 旅程 5（历史对话浏览）横切所有场景——每个场景均包含 history 视图。

---

## 场景 1：正常路径 [A 核心对话与任务执行]

**用户输入**：`网络健康诊断`

> ⚠️ **关于降级提示和压缩通知的说明**：本场景中的降级提示（`OBSERVABILITY_SAMPLE_REDACTED`）和压缩通知（`CONTEXT_COMPACTED`）是 mock server **为了测试覆盖**而每次都发送的事件，**不代表真实后端正常路径的必然行为**。在真实后端中，当所有子系统正常运行时，正常路径**不会有降级提示**，也**不必然有压缩通知**（仅当上下文窗口超限时才压缩）。UCD 设计人员应将降级提示和压缩通知视为**可选元素**，而非每次对话的必经流程。最简正常路径仅包含：USER 消息 → 过程面板（思考 + 能力调用）→ ASSISTANT 回复，无降级、无压缩。

### 思考过程是否需要显示？

`[已实现-主干]` `LLM_THINKING_DELTA` 是 stream-visible live 事件，前端会在过程面板渲染。当前 payload 没有 `metadata.visibility=user-visible-execution-summary` 这一可信标记，producer 可直接传 provider `reasoningContent`；因此 event type 或 `metadata.accumulated` 都不能证明内容已安全筛选。字段级 thinking 安全 owner/过滤仍为 B17 Clarify。

### 思考过程的呈现方式

思考内容通过 **过程面板（Process Panel）** 内的 **思考条目（think entry）** 呈现，不是独立消息气泡：

- **图标**：💭 think 图标（区别于 🔧 skill 图标、✅ process-complete 图标、🎯 final-complete 图标）
- **渲染格式**：`contentType = PLAIN_TEXT`，**按纯文本渲染，不做 Markdown 解析**（不渲染标题、表格、代码块）
- **增量方式**：累计快照（`metadata.accumulated = true`），每个 delta 包含完整当前文本，前端用 **replace** 而非 append
- **折叠行为**：
  - run 活跃时（status = `ACCEPTED`/`QUEUED`/`PLANNING`/`EXECUTING`）：**auto-expanded**（自动展开）
  - run 终态时（status = `COMPLETED`/`FAILED`/`CANCELED`/`SUPERSEDED`）：**auto-collapsed**（自动折叠，若视口在底部）
  - 用户手动点击可切换为 `user-expanded` / `user-collapsed`，覆盖 auto 行为
  - 新 run 开始时从 `auto-collapsed` 恢复为 `auto-expanded`

### 思考过程的约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **History 可见 `[已实现-主干]`** | 每次模型调用最后一条 completed 累计 snapshot 持久化并通过 Event history 恢复；中间 delta 保持 LIVE_ONLY | `conversation-process-history.md`；B16 |
| **安全边界 `[Clarify]`** | 当前无可信 visibility 标记；不得声称该事件天然不是 raw reasoning。B17/B18 必须定义 authoritative safe projection、fail-closed 与 live/history/share 一致性 | redaction roadmap change |
| **纯文本渲染** | `contentType = PLAIN_TEXT`，不做 Markdown 解析 | `stream-envelope.ts` 的 `projectStreamPayload` |
| **累计快照 replace** | 每个 delta 是完整当前文本，前端 replace 不 append | `stream-envelope.ts` 的 `metadata.accumulated = true` |
| **结构字段最小化** | 投影只复制 thinking 文本字段与累计标记，不附带 raw prompt、credential、file path 或 tool args；这不替代对文本内容本身的 B17 安全决策 | `stream-envelope.ts`；B17 |
| **过程面板内** | 思考条目在过程面板内，不混入助手消息气泡正文 | `ProcessPanel.tsx` 的 4 种 icon 类型 |

---

### 阶段 1.1：请求已受理，思考开始（auto-expanded）

run status = `ACCEPTED` → `executionDetailsPhase = running` → 过程面板 **auto-expanded**

---

> 🧑 **用户**
>
> 网络健康诊断

> 🤖 **助手** · 已受理 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 **思考** · ⏳ 进行中
>
> ```
> 阶段一：建立可见执行计划
> 本次请求会先按会话上下文确认目标网络、设备范围和用户希望看到的输出粒度。
> ```
>
> *(思考内容持续增长中……)*

**思考内容增长过程**（累计快照，每次 replace 完整文本。⚠️ sequence 编号与渲染文本为近似值，mock server 的思考内容输出非确定性——取决于 token 切分逻辑，实际 sequence 和文本片段可能略有差异）：

| sequence | 渲染内容 |
|---|---|
| seq 2 | `阶段一：建` |
| seq 3 | `阶段一：建立可见执行` |
| seq 4 | `阶段一：建立可见执行计划\n本次` |
| seq 5 | `阶段一：建立可见执行计划\n本次请求会先按` |
| ... | *(逐步增长)* |
| seq 12 | `阶段一：建立可见执行计划\n本次请求会先按会话上下文确认目标网络、设备范围和用户希望看到的输出粒度。系统` |
| ... | *(继续增长到 6 个阶段完整文本)* |

> ℹ️ "阶段一/阶段二"不是独立条目，是**同一个思考条目**内逐步增长的纯文本。前端每次用最新 delta 的完整文本 replace 之前的内容。

---

### 阶段 1.2：能力调用开始（思考条目仍可见，新增能力条目）

run status = `EXECUTING` → `executionDetailsPhase = running` → 过程面板 **auto-expanded**

---

> 🧑 **用户**
>
> 网络健康诊断

> 🤖 **助手** · 执行中 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 **思考** · ✅ 已完成
>
> <details><summary>展开查看思考内容</summary>
>
> ```
> 阶段一：建立可见执行计划
> 本次请求会先按会话上下文确认目标网络、设备范围和用户希望看到的输出粒度……
>
> 阶段二：确认数据来源
> mock 后端会模拟读取核心交换、汇聚交换、防火墙、DHCP 地址池……
>
> 阶段三：规划能力调用
> 模拟能力调用会覆盖拓扑发现、日志聚合、KPI 统计、配置核查和地址池检查……
>
> 阶段四：准备最终回复
> 最终回复会包含中文长报告、Markdown 表格、代码块、Mermaid 图……
>
> 阶段五：扩大长流覆盖面
> 本次默认计划会尽量接近一千个 stream event……
>
> 阶段六：确认英文空格语义
> 英文 token 会包含带前导空格的片段……
> ```
>
> </details>
>
> ---
>
> 🔧 **能力调用：networkDiagnostic** · ⏳ 执行中
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `networkDiagnostic` |
> | 工具调用 ID | `tool-req-...-network-diagnostic` |
> | 状态 | 执行中 |

---

### 阶段 1.3：能力结果返回 + 降级 + 压缩（过程面板仍 auto-expanded）

> ℹ️ 本阶段的降级提示和压缩通知为 mock server 测试覆盖行为。真实后端中，这两个事件仅在特定条件满足时才出现（见 `degradation-notice.md` 触发场景、`conversation-ui-state.md` 第 1 节 `CONTEXT_COMPACTED`）。

---

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 **思考** · ✅ 已完成（已折叠，点击可展开）
>
> 🔧 **能力调用：networkDiagnostic** · ✅ 已完成
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `networkDiagnostic` |
> | 状态 | ✅ 已完成 |
>
> <details><summary>能力结果预览（CAPABILITY_RESULT_DELTA 增量投递）</summary>
>
> ```
> # Capability Result: network-diagnostic-suite
>
> ## 1. Collection Window
> - Time range: 2026-06-01 09:00:00 to 09:15:00
> - Tenant scope: local-demo-tenant
>
> ## 2. Device Health Summary
> Core-SW-01    Core switch    NORMAL      42%  58%  0.01%
> Edge-RTR-02   Edge router    DEGRADED    88%  74%  0.18%
> Access-SW-02  Access switch  UNREACHABLE  n/a  n/a   n/a
> ```
>
> </details>
>
> ---
>
> ⚠️ **降级提示**
>
> 已隐藏原始 provider 诊断细节，仅保留安全摘要。
> （`code: OBSERVABILITY_SAMPLE_REDACTED`）
>
> 📦 **上下文已压缩**
>
> 已压缩较早上下文以继续处理当前长回复。
> （`reason: CONTEXT_WINDOW_POLICY`，压缩 6 条，剩余 3600 tokens）

> ℹ️ 降级提示与压缩通知在过程面板内作为独立条目呈现，**不混入助手消息气泡正文**。

---

### 阶段 1.4：回复完成（auto-collapsed）

run status = `COMPLETED` → `executionDetailsPhase = settled` → 过程面板 **auto-collapsed**（若视口在底部）

---

> 🧑 **用户**
>
> 网络健康诊断

> 📋 **过程面板**（auto-collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开查看完整过程；展开后每个条目各占一行，可逐条展开详情)*

> 🤖 **助手** · ✅ 已完成
>
> # 网络诊断联调长回复
>
> ## 1. 摘要
>
> 本次诊断结论是：当前网络整体仍可用，但边界路由器 Edge-RTR-02 出现持续 CPU 压力，Access-SW-02 存在短时离线，Wireless-DHCP 地址池已经接近耗尽，需要按优先级处理。
>
> ## 2. 关键发现
>
> | 编号 | 对象 | 现象 | 影响 | 建议 |
> |:--|:--|:--|:--|:--|
> | F-01 | Edge-RTR-02 | CPU 持续高于 85%，峰值达到 91% | 可能导致控制面延迟、路由刷新变慢 | 先确认高 CPU 进程，再调整同步窗口 |
> | F-02 | Access-SW-02 | 最近 8 分钟无心跳 | 局部接入用户可能离线 | 检查电源、上联端口和维护窗口 |
> | F-03 | Wireless-DHCP | 地址池使用率 96% | 新终端可能无法获取地址 | 扩容地址池并回收长期租约 |
> | F-04 | FW-01 | 丢包率下降，策略命中正常 | 暂无直接异常 | 不建议重启防火墙 |
>
> ## 3. 事件解释
>
> 系统首先接受用户请求，然后输出可见执行状态，随后模拟调用网络诊断能力。能力输出会保存在执行详情区域，最终回复只展示面向用户的结论和建议。
>
> ## 4. 推荐处置顺序
>
> 1. **优先处理 Edge-RTR-02**：CPU 持续 88%，需排查路由进程。
> 2. **验证 Access-SW-02**：最后心跳在 8 分钟前，建议带外管理核查。
> 3. **准备 DHCP 地址池扩容**：当前 96%，下一个忙时前需处理。
>
> ```text
> display cpu-usage slot 0
> display interface brief | include GE0/0/0
> display ip pool name Wireless-DHCP
> display alarm active | include Edge-RTR-02
> ```

> ℹ️ 助手回复内容是 `LLM_CONTENT_DELTA`（`contentType = MARKDOWN`），**做 Markdown 解析渲染**——这与思考过程的 `PLAIN_TEXT` 不同。

---

### 阶段 1.5：用户手动展开过程面板（user-expanded）

用户点击折叠的过程面板标题栏 → `user-expanded`，覆盖 auto-collapsed：

---

> 📋 **过程面板**（user-expanded ▼）
>
> 💭 **思考** · ✅ 已完成
>
> <details><summary>展开查看完整思考内容（6 个阶段）</summary>
>
> ```
> 阶段一：建立可见执行计划
> ……
> 阶段六：确认英文空格语义
> ……
> ```
>
> </details>
>
> 🔧 **能力调用：networkDiagnostic** · ✅ 已完成
>
> *(能力结果详情可见)*
>
> ⚠️ **降级提示**
>
> 📦 **上下文已压缩**

> ℹ️ 用户展开后，即 使视口在底部也不会自动折叠；只有新 run 开始时才恢复 `auto-expanded`。

---

### 场景 1 的历史对话浏览视图（history 模式）

> ℹ️ `[已实现-主干]` history 可重建能力结果、降级提示、压缩通知、completed thinking 和助手终态内容，但不重建 streaming 瞬态或未完成 thinking delta。过程面板默认折叠，可展开查看已持久化条目。
>
> **thinking 状态边界**：未完成的 `LLM_THINKING_DELTA` 为 LIVE_ONLY；每次模型调用最后一条 completed 累计 snapshot 已持久化并在 history 中恢复。下方带 think 的 history mockup 是当前完成态；think/answer 字段级安全过滤仍见 B17。

**`[UCD目标]` history 渲染（主干实际渲染需省略 💭 think 条目）**：

---

> 🧑 **用户**
>
> 网络健康诊断

<details>
<summary>📋 过程面板（collapsed ▶）— 已完成</summary>

<details>
<summary>💭 思考 · ✅ 已完成</summary>
阶段一：建立可见执行计划……
</details>

| 🔧 capability | 状态 |
|---|---|
| networkDiagnostic | ✅ 已完成 |

<details>
<summary>🔧 能力结果预览</summary>
# Capability Result: network-diagnostic-suite
</details>

> ⚠️ **降级提示**
>
> 已隐藏原始 provider 诊断细节，仅保留安全摘要。
> （`code: OBSERVABILITY_SAMPLE_REDACTED`）

> 📦 **上下文已压缩**
>
> 已压缩较早上下文以继续处理当前长回复。
> （`reason: CONTEXT_WINDOW_POLICY`，压缩 6 条，剩余 3600 tokens）

</details>

> 🤖 **助手** · ✅ 已完成
>
> # 网络诊断联调长回复
>
> ## 1. 摘要
>
> 本次诊断结论是：当前网络整体仍可用，但边界路由器 Edge-RTR-02 出现持续 CPU 压力……

（过程面板默认折叠，展开后可见 completed thinking 与其他已持久化条目；未完成 delta 不进入 history。）

---

## 场景 2：失败路径 [A 核心对话与任务执行]

**用户输入**：`测试：失败`

### 阶段 2.1：失败终态

---

> 🧑 **用户**
>
> 测试：失败

> 🤖 **助手** · ❌ 失败

<details>
<summary>💭 思考过程</summary>
（思考内容已折叠）
</details>

> ⚠️ **降级提示**
>
> 模型输出超过安全限制，已停止本次请求。
> （`code: MODEL_OUTPUT_LIMIT_EXCEEDED`）

> 🤖 **助手回复（部分）**：
>
> 本次请求在生成过程中被安全终止，以下是已生成的部分内容……

> ❌ **请求失败**
>
> Request failed safely
> （`reason: MODEL_OUTPUT_LIMIT_EXCEEDED`）

---

### 场景 2 的历史对话浏览视图（completed thinking 可恢复）

---

> 🧑 **用户**
>
> 测试：失败

<details>
<summary>📋 过程面板（collapsed ▶）— 已失败</summary>

<details>
<summary>💭 思考 · ✅ 已完成</summary>
（思考内容已折叠）
</details>

> ⚠️ **降级提示**
>
> 模型输出超过安全限制，已停止本次请求。
> （`code: MODEL_OUTPUT_LIMIT_EXCEEDED`）

</details>

> 🤖 **助手** · ❌ 失败
>
> 本次请求在生成过程中被安全终止，以下是已生成的部分内容……

> ❌ **请求失败**
>
> Request failed safely

（上方 completed thinking 可由 Event history 恢复。若 ASSISTANT content 是 `Request failed` / `Request failed: ...` / `Request failed safely: CODE` / `Request failed safely: CODE during local runtime recovery` 等 safe failure placeholder，则 **MUST NOT** 渲染为助手回复内容，仅渲染失败卡片。）

---

## 场景 3：Pending Input 全 kind 矩阵 [E 交互输入与上下文]

**用户输入**：`测试：补充输入`（触发 `confirmation` kind）；其他 kind 为设计规格示例。

说明：本场景覆盖 4 种已实现契约 pending input kind。`confirmation` 为 mock 驱动，展示完整生命周期（等待→应答→超时）；`question`、`authorization`、`human-handoff` 为设计规格，展示视觉差异。`workflow-interrupt` 前端尚未实现，本场景不覆盖。所有 kind 共享同一生命周期（`USER_INPUT_REQUIRED` → `RECEIVED`/`TIMEOUT`/`CANCELED`），下文以 `confirmation` 为详细示例。

### 阶段 3.1：CONFIRMATION kind — 等待用户确认

---

> 🧑 **用户**
>
> 测试：补充输入

> 🤖 **助手** · 执行中 ⏳（等待用户输入）

<details>
<summary>💭 思考过程</summary>
（思考内容已折叠）
</details>

> 🔧 **能力调用：networkDiagnostic** · ✅ 已完成

> 📝 **需要确认**
>
> 检测到模拟高风险操作，是否继续执行边界路由器流量调度建议？
>
> 风险等级：🟡 中
>
> ⏰ 超时时间：2026-07-07 15:04:40（⚠️ 此超时时间为示例值，非 mock server 确定性输出。mock server 不生成确定性超时时间戳，实际测试时以 pending input 事件中的 `timeoutAt` 字段为准。）
>
> **[继续执行]** &nbsp;&nbsp; **[暂不执行]**

---

### 阶段 3.2：CONFIRMATION kind — 用户应答后

---

> 🧑 **用户**
>
> 测试：补充输入

> 🤖 **助手** · ✅ 已完成

<details>
<summary>💭 思考过程</summary>
（已折叠）
</details>

> 🔧 **能力调用：networkDiagnostic** · ✅ 已完成

> 📝 **需要确认** · ✅ 已应答
>
> 检测到模拟高风险操作，是否继续执行边界路由器流量调度建议？
>
> 你的选择：**继续执行**

> 🤖 **助手回复**：
>
> 已确认执行边界路由器流量调度建议。以下是操作计划……

---

### 阶段 3.3：CONFIRMATION kind — 超时未应答（替代路径）

> ⚠️ 超时/取消终态适用于所有 kind，非 `confirmation` 专属。

---

> 📝 **需要确认** · ⏰ 已超时
>
> 检测到模拟高风险操作，是否继续执行边界路由器流量调度建议？
>
> （用户未在超时时间内应答，请求已自动取消）

---

### 阶段 3.4：QUESTION kind — 多问题 + 选项 + 自定义答案

模型识别到需要多维度确认，暂停等待用户回答多问题。

```
> 🧑 用户
> 配置核查方案需要确认几个问题

> 🤖 助手 · 执行中 ⏳（等待用户输入）
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ✅ 已完成                         │
> │   用户要求制定配置核查方案。需要明确核查范围   │
> │   和优先检查项，才能制定有效方案。             │
> │                                                │
> │ 🔧 queryConfig · ✅ 已完成                    │
> └────────────────────────────────────────────────┘

┌─ Pending Input 卡片（QUESTION kind）─────────────────────────┐
│  请回答以下问题                                    ⏱ 4:32     │
│                                                              │
│  1. 核查范围是什么？                                         │
│    ○ 全部核心设备                                            │
│    ○ 仅边缘设备                                              │
│    ○ 自定义答案 [展开 textarea]                              │
│                                                              │
│  2. 优先检查哪些项？（可多选）                               │
│    ☐ 接口配置                                                │
│    ☐ 路由表                                                  │
│    ☐ ACL 规则                                                │
│    ☐ 自定义答案 [展开 textarea]                              │
│                                                              │
│  [取消]                                           [提交]     │
└──────────────────────────────────────────────────────────────┘
```

### 阶段 3.5：AUTHORIZATION kind — 授权审批 + 蓝色徽章

模型识别到需要特权操作，暂停等待用户授权。AUTHORIZATION 卡片有 2px primary 边框 + 蓝色"授权请求"徽章，与其他 kind 视觉区分。

```
> 🧑 用户
> 对核心交换机执行配置变更

> 🤖 助手 · 执行中 ⏳（等待用户授权）
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ✅ 已完成                         │
> │   用户要对核心交换机执行配置变更，属于高危操作。│
> │   需要用户明确授权后才能执行。                 │
> │                                                │
> │ 🔧 queryConfig · ✅ 已完成                    │
> └────────────────────────────────────────────────┘

┌════════════════════════════════════════════════════════════╗  ← 2px primary 边框
║  检测到高危配置变更操作        [授权请求] ⏱ 4:32          ║  ← 蓝色徽章 + 倒计时
║  此操作将修改核心交换机 Core-SW-01 的路由策略，           ║  ← authorizationHint
║  可能影响全网流量转发路径。                                ║
║  [拒绝]                              [批准执行]           ║
╚════════════════════════════════════════════════════════════╝
```

### 阶段 3.6：HUMAN_HANDOFF kind — 人工接管：模式选择 + 内容输入

模型判断任务超出自身能力范围，请求人工接管。用户需选择接管模式（最终答案 / 恢复指令）并输入交接内容。

```
> 🧑 用户
> 处理这个复杂的跨域路由环路问题

> 🤖 助手 · 执行中 ⏳（等待人工接管）
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ✅ 已完成                         │
> │   跨域路由环路涉及多部门协作，超出自动处理     │
> │   能力范围。需要人工接管，提供交接信息。       │
> │                                                │
> │ 🔧 networkDiagnostic · ✅ 已完成              │
> └────────────────────────────────────────────────┘

┌─ Pending Input 卡片（HUMAN_HANDOFF kind）───────────────────┐
│  人工接管                                         ⏱ 4:32     │
│                                                              │
│  接管模式                                                    │
│    ○ 最终答案    ○ 恢复指令                                  │
│                                                              │
│  交接内容                                                    │
│  ┌──────────────────────────────────────────────────┐       │
│  │ 请描述需要人工处理的具体问题…                    │       │
│  └──────────────────────────────────────────────────┘       │
│                                               0/500          │
│                                                              │
│  [取消]                                           [提交]     │
└──────────────────────────────────────────────────────────────┘
```

### 关键视觉元素对比

| 元素 | CONFIRMATION | QUESTION | AUTHORIZATION | HUMAN_HANDOFF |
|---|---|---|---|---|
| 卡片边框 | 1px default | 1px default | **2px primary**（视觉强调） | 1px default |
| 徽章 | 无 | 无 | 蓝色"授权请求"pill | 无 |
| 风险等级 | 可选（🟡 中） | 无 | 无 | 无 |
| 输入控件 | approve/deny 按钮 | Radio/Checkbox + 自定义 textarea | approve/deny 按钮 | 模式 Radio + 内容 textarea |
| 倒计时 | ⏰ 超时时间 | ⏱ 4:32（header 右侧） | ⏱ 4:32（徽章右侧） | ⏱ 4:32（header 右侧） |
| 提交校验 | 点击即提交 | 所有问题已回答 | 点击即提交 | 模式已选 + 内容非空 |
| 提交中间态 | 按钮禁用 + loading | 控件禁用 + Spin loading | 按钮禁用 + loading | 控件禁用 + loading |
| 提交错误 | `<Alert type="error">` | `<Alert type="error">` | `<Alert type="error">` | `<Alert type="error">` |
| answer shape | `[[optionId]]` | `[[q1], [q2]]` | `[[optionId]]` | `[[mode], [content]]` |

### 场景 3 的历史对话浏览视图（completed thinking 可恢复）

---

> 🧑 **用户**
>
> 测试：补充输入

> 🤖 **助手** · ✅ 已完成

<details>
<summary>📋 过程面板（默认折叠）</summary>

- 💭 思考 #1 · ✅ 已完成
- 🔧 networkDiagnostic · ✅ 已完成
</details>

> 📝 **需要确认** · ✅ 已应答
>
> 检测到模拟高风险操作，是否继续执行边界路由器流量调度建议？
>
> 你的选择：**继续执行**

> 🤖 **助手回复**：
>
> 已确认执行边界路由器流量调度建议……

---

以下为其余 3 种 kind 的历史终态；图中的 💭 completed thinking 可由 Event history 恢复，pending input lifecycle 卡仍按各自实现状态判断：

```
> 🧑 用户
> 配置核查方案需要确认几个问题

> 🤖 助手 · ✅ 已完成
> ┌─ 📋 过程面板（collapsed）──────────────────────┐
> │ 💭 思考 #1 · ✅    🔧 queryConfig · ✅         │
> └────────────────────────────────────────────────┘

┌─ Pending Input 卡片（QUESTION · 终态：已应答）──────────────┐
│  请回答以下问题                                              │
│  已应答：全部核心设备 / 接口配置、路由表                      │
└──────────────────────────────────────────────────────────────┘
```

```
> 🧑 用户
> 对核心交换机执行配置变更

> 🤖 助手 · ✅ 已完成
> ┌─ 📋 过程面板（collapsed）──────────────────────┐
> │ 💭 思考 #1 · ✅    🔧 queryConfig · ✅         │
> └────────────────────────────────────────────────┘

┌════════════════════════════════════════════════════════════╗
║  检测到高危配置变更操作        [授权请求]                   ║
║  已授权：批准执行                                           ║
╚════════════════════════════════════════════════════════════╝
```

```
> 🧑 用户
> 处理这个复杂的跨域路由环路问题

> 🤖 助手 · ✅ 已完成
> ┌─ 📋 过程面板（collapsed）──────────────────────┐
> │ 💭 思考 #1 · ✅    🔧 networkDiagnostic · ✅   │
> └────────────────────────────────────────────────┘

┌─ Pending Input 卡片（HUMAN_HANDOFF · 终态：已应答）────────┐
│  人工接管                                                   │
│  已应答：恢复指令 / 跨域路由环路需 NOC 团队介入排查…        │
└──────────────────────────────────────────────────────────────┘
```

### 约束

| 约束 | live | history |
|---|---|---|
| 卡片可应答 | ✅ | ❌（只读） |
| 倒计时 | ✅ 实时 | ❌ 不显示 |
| safeSummary | — | ✅ 展示终态摘要 |
| AUTHORIZATION 2px 边框 | ✅ | ✅ 保留视觉区分 |
| 超时/取消终态 | ✅ 所有 kind 共享 | ✅ 重建终态 |
| 思考过程 | ✅ 增量可见 | ✅ completed thinking 可由 Event history 折叠展示；未完成 delta 不恢复 |
| 能力卡片 | ✅ 可见 | ✅ 可见（过程面板默认折叠，展开后可见） |

（`[已实现-主干]` pending input 终态通过 stored event type 重建；completed thinking 通过 Event history 恢复。pending-input lifecycle 卡仍不与 thinking continuity 混为同一交付。）

---

## 场景 4：附件上传 [A 核心对话与任务执行]

**用户输入**：`排查这个告警日志` + 附件 2 个（1 个 PDF 报告，1 个超大文件）

### 阶段 4.1：附件已校验

---

> 🧑 **用户**
>
> 排查这个告警日志
>
> 📎 `alert-report.pdf` · ✅ 已接收 · PDF
> 📎 `large-log-500mb.bin` · ❌ 已拒绝 · 文件过大
>
> （拒绝原因：附件过大，已被拒绝。`reasonCode: ATTACHMENT_TOO_LARGE`）

> 🤖 **助手** · 已受理 ⏳

<details>
<summary>💭 思考过程</summary>
（Agent 基于已接收的 PDF 报告进行分析）
</details>

---

### 场景 4 的历史对话浏览视图（completed thinking 可恢复）

---

> 🧑 **用户**
>
> 排查这个告警日志
>
> 📎 `alert-report.pdf` · ✅ 已接收 · PDF
> 📎 `large-log-500mb.bin` · ❌ 已拒绝

<details>
<summary>📋 过程面板（collapsed ▶）— 已完成</summary>

<details>
<summary>💭 思考 · ✅ 已完成</summary>
（Agent 基于已接收的 PDF 报告进行分析）
</details>

</details>

> 🤖 **助手** · ✅ 已完成
>
> 根据告警报告分析……

（附件 accepted/rejected **流事件**不重建，但持久化 attachment metadata 仍在 USER 消息内可见；历史浏览时附件状态依赖持久化 metadata，不依赖流事件。上方 completed thinking 可由 Event history 恢复。）

---

## 场景 5：断线重连 [D 错误与异常恢复]

### 阶段 5.1：连接不稳定

---

> 🔴 **连接不稳定**
>
> 正在尝试维持连接……已收到的内容保持可见。

> 🤖 **助手** · 执行中 ⏳
>
> （已收到的部分回复内容保持可见）

---

### 阶段 5.2：已断开

---

> ⚫ **已断开**
>
> 点击重连。已收到的对话内容不会丢失。

> 🤖 **助手** · 执行中 ⏳
>
> （已收到的部分回复内容保持可见）

**[重新连接]**

---

### 阶段 5.3：重连成功

---

> 🟢 **已恢复连接**
>
> 已补齐断线期间遗漏的事件，继续接收实时更新。

> 🤖 **助手** · ✅ 已完成
>
> （完整回复内容，包括断线期间生成的部分已按序补入）

---

### 断线重连的约束

- transport close **MUST NOT** 触发伪造的 `REQUEST_COMPLETED` / `REQUEST_FAILED` / `REQUEST_CANCELED`。
- 已收到的对话内容保持可见，不因断线清除。
- 重连时上送 `lastSeenSequence` cursor，backend 回放断线期间遗漏的事件后继续 live-tail（实时接收新事件）。
- 历史对话浏览模式不涉及断线重连（无 active stream）。

---

## 场景 6：路径被策略拒绝（CAPABILITY_PATH_REJECTED）[D 错误与异常恢复]

**说明**：此场景由真实后端路径策略触发，mock server 未预置。以下为契约层期望渲染。

### 阶段 6.1：能力被路径策略拒绝

---

> 🧑 **用户**
>
> 读取 /etc/secrets/config 文件

> 🤖 **助手** · 执行中 ⏳

> 🔧 **能力调用：read** · ❌ 失败
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `read` |
> | 错误码 | `CAPABILITY_PATH_REJECTED` |
> | 失败摘要 | 路径访问被策略阻止 |
>
> > ❌ **路径被策略拒绝**
> >
> > Path access was blocked by policy.
>
> （**MUST NOT** 暴露被拒绝的路径 `/etc/secrets/config`、file system detail、policy internals）

> ⚠️ **降级提示**（可选，作为次要提示）
>
> 能力执行被策略阻止。

> 🤖 **助手** · ✅ 已完成（run 未因路径拒绝而失败）
>
> 该路径无法访问。我已尝试读取该文件，但被安全策略阻止。请提供项目工作区内的文件路径……

---

### 关键约束

- `CAPABILITY_PATH_REJECTED` **不升级为 run failure**：`RunStatus` 不转为 `FAILED`，run 继续下一 capability 或 model round。
- 用户可读原因 **MUST ONLY** 从 `safeErrorCode` + `safeSummary` 派生。
- **MUST NOT** 显示被拒绝的路径、file system detail、policy internals。
- **MUST NOT** 暗示能力执行成功。

---

## 场景 7：多轮思考与工具调用 [A 核心对话与任务执行]

**用户输入**：`排查 Edge-RTR-02 丢包问题，先查告警再查配置`

**说明**：一次问答中模型进行多次思考、多次工具调用。本场景演示 think → tool → think → tool → final reply 的多轮结构，以及"执行过程中模型产出的中途说明文本"的渲染去向。

### 核心规则：事件类型决定渲染位置，不是内容语义

| 模型产出的事件类型 | 渲染位置 | 说明 |
|---|---|---|
| `LLM_THINKING_DELTA`（`contentType=PLAIN_TEXT`） | **过程面板** think 条目 | 每轮思考是独立条目；若想让中途说明显示在过程面板，后端必须发此事件类型 |
| `LLM_CONTENT_DELTA`（`contentType=MARKDOWN`） | **助手消息气泡**（最下方） | 整个 turn 的所有 content delta 拼接成**一个**字符串，不区分"中途说明"与"最终回复" |

> ⚠️ **没有第三个 UI 区域**承接"执行过程中的中途总结"。架构严格二分：思考 → 过程面板，内容 → 助手气泡。

### 多轮 think 条目的产生机制

`processDetails.ts` 的 `flushThinking()` 保证：每遇到非思考事件（`CAPABILITY_STARTED` / `CAPABILITY_RESULT_DELTA` 等）就把当前 `activeThinking` 推入条目数组并置空，下一轮 `LLM_THINKING_DELTA` 开新条目。因此：

- think → tool_A → think → tool_B → think → final reply = **3 个独立的 think 条目**（不是一条累积）
- 每个 think 条目内部仍是累计快照 replace（`metadata.accumulated = true`）

### 阶段 7.1：第一轮思考 + 第一个工具调用（过程面板 auto-expanded）

run status = `EXECUTING` → 过程面板 **auto-expanded**

---

> 🧑 **用户**
>
> 排查 Edge-RTR-02 丢包问题，先查告警再查配置

> 🤖 **助手** · 执行中 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 **思考 #1** · ✅ 已完成
>
> <details><summary>展开查看思考 #1</summary>
>
> ```
> 用户要求排查 Edge-RTR-02 丢包，并指定顺序：先告警再配置。
> 我先调用告警查询能力，获取该设备最近的告警列表。
> ```
>
> </details>
>
> ---
>
> 🔧 **能力调用：queryAlerts** · ⏳ 执行中
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `queryAlerts` |
> | 参数 | `device=Edge-RTR-02, window=15m` |
> | 状态 | 执行中 |

---

### 阶段 7.2：第一个工具返回 + 第二轮思考 + 第二个工具调用

`flushThinking()` 在 `CAPABILITY_RESULT_DELTA` 到达时把思考 #1 推入条目数组；下一轮 `LLM_THINKING_DELTA` 开思考 #2 新条目。

---

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 **思考 #1** · ✅ 已完成（已折叠）
>
> 🔧 **能力调用：queryAlerts** · ✅ 已完成
>
> <details><summary>能力结果预览</summary>
>
> ```
> 设备: Edge-RTR-02
> 告警数: 3
> - 09:02  CPU_USAGE_HIGH   88%
> - 09:05  PACKET_LOSS      0.18%
> - 09:08  BGP_PEER_DOWN    peer=10.2.3.4
> ```
>
> </details>
>
> ---
>
> 💭 **思考 #2** · ✅ 已完成
>
> <details><summary>展开查看思考 #2</summary>
>
> ```
> 告警显示 BGP peer down 和 CPU 高，可能与路由配置变更有关。
> 接下来调用配置查询能力，获取该设备最近 1 小时的配置变更记录。
> ```
>
> </details>
>
> ---
>
> 🔧 **能力调用：queryConfig** · ⏳ 执行中
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `queryConfig` |
> | 参数 | `device=Edge-RTR-02, type=changes, window=1h` |
> | 状态 | 执行中 |

> 🤖 **助手** · 执行中 ⏳
>
> *(助手气泡此时为空或仅占位——尚未收到任何 `LLM_CONTENT_DELTA`)*

> ℹ️ 思考 #1 与思考 #2 是**两个独立条目**，不合并。若模型在两轮工具调用之间吐出 `LLM_CONTENT_DELTA`（如"告警已查到，继续查配置"），该文本进入**助手气泡**，不进入过程面板。

---

### 阶段 7.3：第二个工具返回 + 模型中途说明 + 第三轮思考

假设模型在拿到第二个工具结果后，吐出一段 `LLM_CONTENT_DELTA` 作为中途说明，然后进入第三轮思考。

---

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 **思考 #1** · ✅（已折叠）
> 🔧 **queryAlerts** · ✅
> 💭 **思考 #2** · ✅（已折叠）
> 🔧 **queryConfig** · ✅
>
> <details><summary>queryConfig 结果预览</summary>
>
> ```
> 设备: Edge-RTR-02
> 变更数: 1
> - 08:45  route-map RM-BGP-OUT modified (added prefix 10.5.0.0/16)
> ```
>
> </details>
>
> ---
>
> 💭 **思考 #3** · ⏳ 进行中
>
> ```
> 配置变更与告警时间吻合：08:45 新增 prefix 10.5.0.0/16，
> 09:05 开始丢包，09:08 BGP peer down。根因疑似该 prefix 通告导致
> 邻居路由表膨胀。准备整理结论并给出处置建议。
> ```

> 🤖 **助手** · 执行中 ⏳
>
> 告警已查到 3 条，配置变更 1 条。初步判断与 08:45 的 route-map 变更有关，正在整理结论……

> ℹ️ 助手气泡里的"告警已查到 3 条……"是 `LLM_CONTENT_DELTA`，**与最终回复拼接成同一个字符串**。前端没有"中途说明 vs 最终回复"的区分逻辑——`buildAnswerContent` 把整个 turn 的所有 content delta 合并。

---

### 阶段 7.4：最终回复完成（auto-collapsed）

run status = `COMPLETED` → 过程面板 **auto-collapsed**

---

> 🧑 **用户**
>
> 排查 Edge-RTR-02 丢包问题，先查告警再查配置

> 📋 **过程面板**（auto-collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开查看 3 个思考条目 + 2 个能力结果；展开后每个条目各占一行，可逐条展开详情)*

> 🤖 **助手** · ✅ 已完成
>
> 告警已查到 3 条，配置变更 1 条。初步判断与 08:45 的 route-map 变更有关，正在整理结论……
>
> ## 根因分析
>
> Edge-RTR-02 在 08:45 的配置变更中，route-map `RM-BGP-OUT` 新增了 prefix `10.5.0.0/16` 的通告，导致 BGP 邻居 `10.2.3.4` 路由表膨胀并最终 peer down。
>
> ## 证据链
>
> | 时间 | 事件 | 来源 |
> |---|---|---|
> | 08:45 | route-map 变更新增 prefix | queryConfig |
> | 09:02 | CPU 88% | queryAlerts |
> | 09:05 | 丢包 0.18% | queryAlerts |
> | 09:08 | BGP peer down | queryAlerts |
>
> ## 处置建议
>
> 1. 立即撤销 `10.5.0.0/16` 的通告。
> 2. 观察 BGP peer 恢复情况。
> 3. 补充 route-map 变更审批流程。

> ℹ️ 助手气泡里"告警已查到……"（中途 content delta）与"## 根因分析……"（最终 content delta）被 `mergeStreamText` 拼接成**同一个 markdown 字符串**，连续渲染。前端不做分段、不插入分隔符、不标记哪段是中途说明。

---

### 场景 7 的历史对话浏览视图（completed thinking 可恢复）

---

> 🧑 **用户**
>
> 排查 Edge-RTR-02 丢包问题，先查告警再查配置

> 📋 **过程面板**（collapsed ▶ 已完成）
>
> *(`[已实现-主干]` 点击 ▶ 可展开查看 3 个 completed thinking 条目 + 2 个能力结果。)*

> 🤖 **助手** · ✅ 已完成
>
> 告警已查到 3 条，配置变更 1 条。初步判断与 08:45 的 route-map 变更有关，正在整理结论……
>
> ## 根因分析
>
> Edge-RTR-02 在 08:45 的配置变更中……
>
> ## 处置建议
>
> 1. 立即撤销 `10.5.0.0/16` 的通告……

（过程面板通过 Event history 重建 3 个 completed thinking 条目和 capability lifecycle；助手气泡的完整 content 字符串——含中途说明——仍作为 `ASSISTANT` 消息持久化并重建。）

---

### 场景 7 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **思考与内容严格二分** | `LLM_THINKING_DELTA` 只进过程面板，`LLM_CONTENT_DELTA` 只进助手气泡，无交叉 | `answerContent.ts:229-235`（跳过非 `LLM_CONTENT_DELTA`）、`processDetails.ts:1200-1202`（跳过 `LLM_CONTENT_DELTA`） |
| **多轮思考 = 多个独立条目** | `flushThinking()` 在每个非思考事件时关闭当前 think 条目，下一轮开新条目 | `processDetails.ts:959-964` |
| **content delta 全 turn 拼接** | 整个 turn 的所有 `LLM_CONTENT_DELTA` 合并成一个字符串，不区分中途/最终 | `answerContent.ts:237-252`（`buildAnswerContent`）、`TurnBlock.tsx:843`（`TurnBlockContent`） |
| **事件类型决定渲染位置** | 若想让中途说明显示在过程面板，后端必须发 `LLM_THINKING_DELTA`，不是 `LLM_CONTENT_DELTA` | `stream-envelope.ts:226-244` |
| **思考条目内部累计 replace** | 每个 think 条目内 `metadata.accumulated=true`，replace 不 append | `stream-envelope.ts` |
| **思考 history 可见 `[已实现-主干]`** | 按模型调用和 `stepId` 持久化并重建 completed think 条目；不恢复中间 delta | `conversation-process-history.md`；B16 |
| **内容持久化重建** | 拼接后的 content 字符串作为 `ASSISTANT` 消息持久化，history 完整重建 | `conversationAdapter.ts` |

---

## 场景 8：多会话后台 run [B 长时任务与并行工作流]

**用户操作**：在会话 C 提问后，切换到会话 D 发起新问题。会话 C 的 run 继续在后台执行。

**说明**：演示已交付的跨会话 Activity Stream：后台 run 可显示等待输入、运行中与未读终态，且未读终态只在匹配 presentation 可见后消费。

### 阶段 8.1：会话 C 后台执行中，用户在会话 D

用户在会话 C 发送"网络健康诊断"后，切换到会话 D 发送"查询 DHCP 地址池状态"。会话 C 的 run 仍在后台执行。

---

> 📋 **会话列表**
>
> ▸ 会话 A
> ⚡ 会话 C · 执行中（后台 ⏳）
> ● 会话 D · 执行中 ⏳ ← 当前
> ▸ 会话 E

> 🤖 **助手（会话 D）** · 执行中 ⏳
>
> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 思考 #1 · ⏳ 进行中
>
> *(会话 D 的过程面板内容)*

> ℹ️ 会话 C 的 Activity 为 `RUNNING`，会话 D 是当前选中会话。两个会话的 run 互不影响；列表不为后台会话建立独立 conversation transport。

---

### 阶段 8.2：会话 C 后台 run 完成，用户仍在会话 D

会话 C 的 run 完成并提交 terminal fact，Activity Stream 投影 `UNREAD_RESULT`。

---

> 📋 **会话列表**
>
> ▸ 会话 A
> ▸ 会话 C · 🔵 有新结果
> ● 会话 D · 执行中 ⏳ ← 当前
> ▸ 会话 E

> ℹ️ 用户仍在会话 D，因此会话 C 的未读结果保留。失败终态则投影优先级更高的 `UNREAD_FAILURE`。

---

### 阶段 8.3：用户切换回会话 C

用户点击会话 C，对话区切换到会话 C 的完整 turn。

---

> 📋 **会话列表**
>
> ▸ 会话 A
> ● 会话 C ← 当前；匹配 terminal presentation 可见后消费蓝点
> ▸ 会话 D
> ▸ 会话 E

> 🧑 **用户（会话 C）**
>
> 网络健康诊断

> 📋 **过程面板**（auto-collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开查看完整过程)*

> 🤖 **助手（会话 C）** · ✅ 已完成
>
> # 网络诊断联调长回复
>
> ## 1. 摘要
>
> 本次诊断结论是：当前网络整体仍可用……

> ℹ️ 仅当已完成 turn 的匹配 terminal presentation 成功可见，前端才携带 activityId 与实际 run id 消费未读结果；仅点击列表行不够。

---

### 阶段 8 的历史对话浏览视图

会话 Activity 是独立于 conversation live/history 的投影。会话 C 和 D 的内容仍按场景 1 重建：Message history 先显示助手终态，Event history 渐进补齐 completed thinking 和能力过程。

---

### 阶段 8 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **后台 run 不取消** | 切换会话不取消前一会话的 run | `ChatPage.tsx` L901 `shouldOpenAnchoredBackgroundStream` |
| **不同 session lane 独立** | 会话 C 和会话 D 的 run 互不影响 | `session-lane-scheduling` spec |
| **五态优先级** | `WAITING_FOR_INPUT > RUNNING > UNREAD_FAILURE > UNREAD_RESULT > NONE` | `cross-session-activity-awareness` stable spec |
| **安全消费未读终态** | 匹配 terminal presentation 可见后才消费；点击/加载失败不消费 | `cross-session-activity-awareness` stable spec |
| **不暴露内部状态** | MUST NOT 暴露 requestId/runId/internal lane state | `ts-run-status-visibility` |
| **Activity 独立于 history** | history 内容重建不自行推断列表 Activity；列表状态来自独立 projection stream | `cross-session-activity-awareness` |

---

## 场景 9：长时运行（long-running）[B 长时任务与并行工作流]

**用户输入**：`批量核查 50 台设备的配置基线`

**说明**：演示能力执行超过阈值（建议 10 秒）后进入 long-running 态的渲染。当前工作流长时轮询和批量执行不发射中间进度事件；设计建议工作流节点通过 `emitOutputDelta` 发射进度文本和 `safeProgress` 结构化字段（见阶段 9.2b）。来源：`capability-card.md` 的"长时运行扩展"章节。

### 阶段 9.1：能力开始执行（running 态）

---

> 🧑 **用户**
>
> 批量核查 50 台设备的配置基线

> 🤖 **助手** · 执行中 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 思考 #1 · ✅ 已完成（已折叠）
>
> 🔧 **能力调用：configAudit** · ⏳ 执行中
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `configAudit` |
> | 参数 | `devices=50, type=baseline` |
> | 状态 | 执行中 |

---

### 阶段 9.2：超过阈值，进入 long-running 态

能力执行超过 10 秒，未收到任何 `CAPABILITY_RESULT_DELTA`。能力卡片视觉切换为 long-running 态。

---

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 #1 ✅（已折叠）
>
> 🔧 **能力调用：configAudit** · ⏳ 执行中（已 45 秒）
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `configAudit` |
> | 状态 | 执行中 |
> | 已用时 | 45 秒 |
>
> ℹ️ 此能力可能需要较长时间完成
>
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; **[取消执行]**

> ℹ️ 计时器从 `CAPABILITY_STARTED` 的 `createdAt` 计算，非客户端本地计时。当前无进度条、无百分比、无预估剩余时间——工作流批量执行**当前不发射**中间事件。设计建议工作流节点发射进度 delta（见阶段 9.2b）。

---

### 阶段 9.2b：进度更新到达（设计规格）

> ⚠️ **设计规格**：当前工作流节点不发射 `NODE_OUTPUT_DELTA`，本阶段为设计建议。工作流节点在批量/轮询执行循环中调用 `context.emitOutputDelta()` 发射进度文本，投影为 `CAPABILITY_RESULT_DELTA`，payload 包含 `safeProgress: { current, total, label? }` 和 `text`/`content` 状态文本。

工作流节点发射进度 delta，能力卡片在 long-running 态中显示进度信息：

---

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 #1 ✅（已折叠）
>
> 🔧 **能力调用：configAudit** · ⏳ 执行中（已 45 秒）
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `configAudit` |
> | 状态 | 执行中 |
> | 已用时 | 45 秒 |
> | 进度 | 📊 23/50 台设备 |
>
> ℹ️ 已处理 23 台，失败 0 台
>
> ℹ️ 此能力可能需要较长时间完成
>
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; **[取消执行]**

> ℹ️ `safeProgress: { current: 23, total: 50, label: "台设备" }` 驱动"📊 23/50 台设备"指示器。`text`/`content` 字段承载"已处理 23 台，失败 0 台"状态文本。每个 delta 携带当前完整进度状态（累积的），非增量。有 `safeProgress` 时 MAY 显示 current/total 或百分比。

---

### 阶段 9.2c：fork 引导——在新分支继续对话（设计规格）

> ⚠️ **设计规格**：本阶段为 UCD 设计建议，依赖 long-running 扩展态（计时器/阈值检测）落地。当前能力卡片与 composer 无 fork 引导 CTA。来源：`capability-card.md`"fork-to-continue 引导 CTA"、`composer.md`"长时任务执行中的 fork 引导"。

长时任务执行中，用户想基于已有对话历史开新任务，但不希望终止当前长时任务。同会话直接发送会触发 supersede（终止长时任务，见场景 10d）。系统在 long-running 态主动引导用户 fork 到子会话继续。

**触点 1：能力卡片内 CTA**（意图前，discoverability）

进入 long-running 态后，能力卡片底部出现引导：

```
> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 #1 ✅（已折叠）
>
> 🔧 **能力调用：configAudit** · ⏳ 执行中（已 45 秒）
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `configAudit` |
> | 已用时 | 45 秒 |
>
> ℹ️ 此能力可能需要较长时间完成
>
> 💡 想同时处理其他事？基于已有对话开个新分支
>    [在新分支继续 →]
>
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; **[取消执行]**
```

**触点 2：Composer 内联提示**（意图时刻，用户聚焦输入框）

用户点击 composer 输入框想发新消息时，输入框上方出现提示：

```
┌─ Composer ──────────────────────────────────────────┐
│  💡 "configAudit" 仍在执行（已 45 秒）                │
│     直接发送会终止它。想保留任务并基于历史继续？       │
│     [在新分支继续 →]                          [×]    │
│                                                      │
│  [📎]  检查 Edge-RTR-02 的路由表…             [发送]   │
└──────────────────────────────────────────────────────┘
```

**行为**：用户点击 [在新分支继续 →] → 系统自动 fork 当前 active run 之前最近的 `COMPLETED` ASSISTANT turn（智能 anchor 选择，用户不感知）→ 导航到子会话 → 聚焦 composer，已输入的草稿（"检查 Edge-RTR-02 的路由表…"）带到子会话 composer。

**子会话视图**（fork 后）：

```
┌─ Fork notice banner ──────────────────────────────────┐
│  由 "网络诊断-2026-07-08" 派生                          │
│           ▲                                             │
│           └─ 仅标题为可点击链接（打开来源会话）           │
└────────────────────────────────────────────────────────┘

> 🧑 用户                          ← 从派生点复制的上下文
> 批量核查 50 台设备的配置基线

> 🤖 助手 · ✅ 已完成              ← 从派生点复制的上下文（长时任务前的 turn）
> ## 已识别受影响设备
> …

> 🧑 用户                          ← 用户在新分支输入的新任务
> 检查 Edge-RTR-02 的路由表

> 🤖 助手 · 执行中 ⏳              ← 新任务在子会话开跑

┌─ Composer ──────────────────────────────────────────┐
│  [📎]  输入消息…                             [发送]   │
└──────────────────────────────────────────────────────┘
```

> ℹ️ 父会话的长时任务（configAudit）**继续在后台执行**，切换会话不取消 run（旅程 13）。用户可在会话列表看到父会话 `⚡ (后台⏳)` 指示。长时任务完成后，用户切回父会话查看结果。子会话的新任务基于派生点之前的完整历史执行，**看不到**长时任务的结果（fork 点在它之前）——若新任务依赖长时任务结果，应等待而非 fork。

**不阻断 supersede**：用户可点击 [×] 关闭提示，直接点发送——supersede 正常进行（长时任务被终止，见场景 10d）。引导是建议非强制。

**首轮即长时的边界**：若长时任务是会话第一个 turn（前面无 COMPLETED turn），fork 无历史可携带，引导 CTA **不显示**。

---

### 阶段 9.3：用户取消长时任务

用户点击"取消执行"，触发 `request-cancel`，run 进入 `CANCELED` 终态。

---

> 🧑 **用户**
>
> 批量核查 50 台设备的配置基线

> 📋 **过程面板**（auto-collapsed ▶ 已取消）
>
> *(点击 ▶ 可展开查看完整过程)*

> 🤖 **助手** · ⏹️ 已取消
>
> 已取消批量配置基线核查。已完成 0/50 台设备的检查。

> ℹ️ 用户取消后，run status = `CANCELED`。能力卡片终态指示为 ⏹️。助手气泡展示取消时的部分结果（如有）。过程面板 auto-collapsed（run 终态）。

---

### 阶段 9.4：长时任务完成（替代路径：用户未取消）

用户等待，能力最终完成（如 2 分钟后）。

---

> 🧑 **用户**
>
> 批量核查 50 台设备的配置基线

> 📋 **过程面板**（auto-collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开查看完整过程)*

> 🤖 **助手** · ✅ 已完成
>
> ## 配置基线核查结果
>
> | 设备 | 基线状态 | 偏差项 |
> |---|---|---|
> | Core-SW-01 | ✅ 符合 | 0 |
> | Edge-RTR-02 | ⚠️ 偏差 | 2 |
> | Access-SW-02 | ✅ 符合 | 0 |
> | …（共 50 台） | | |
>
> 共发现 5 台设备存在配置偏差，详情如下……

> ℹ️ 能力完成前，用户在整个等待期间（如 2 分钟）看到 long-running 态的计时器递增。当前无中间进度更新；设计建议工作流节点发射进度 delta（见阶段 9.2b），届时用户可看到"📊 23/50 台设备"等进度指示。完成后过程面板 auto-collapsed，助手气泡展示完整结果。

---

### 场景 9 的历史对话浏览视图（completed thinking 可恢复）

---

> 🧑 **用户**
>
> 批量核查 50 台设备的配置基线

> 📋 **过程面板**（collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开 completed thinking 条目 + 能力结果终态卡片；history 不重建未完成 delta。)*

> 🤖 **助手** · ✅ 已完成
>
> ## 配置基线核查结果
>
> | 设备 | 基线状态 | 偏差项 |
> |---|---|---|
> | Core-SW-01 | ✅ 符合 | 0 |
> | Edge-RTR-02 | ⚠️ 偏差 | 2 |
> | … | | |

（`[已实现-主干]` history 可重建 completed thinking，但不重建 long-running 计时器和取消入口；能力 lifecycle Event 与 `CAPABILITY_RESULT` Message 合并形成终态卡片。）

---

### 场景 9 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **当前无中间进度** | 工作流轮询/批量**当前不发射** `NODE_OUTPUT_DELTA`，前端无进度数据 | `capability-nodes.ts` L44-237 |
| **设计建议：发射进度 delta** | 工作流节点应通过 `emitOutputDelta` 发射进度文本 + `safeProgress` 结构化字段 | `capability-card.md` 长时运行扩展 |
| **MUST NOT 显示预估剩余时间** | 后端不提供此信息 | `capability-card.md` 长时运行扩展 |
| **有 safeProgress 时 MAY 显示百分比** | `safeProgress: { current, total }` 可计算百分比；无 `safeProgress` 时 MUST NOT | `conversation-ui-state.md` safeProgress 字段 |
| **进度 delta 是累积的** | 每个 `CAPABILITY_RESULT_DELTA` 携带当前完整进度状态，非增量 | `conversation-ui-state.md` safeProgress 字段 |
| **进度是可选的** | 不发射进度的能力仅显示计时器 | `capability-card.md` 长时运行扩展 |
| **计时器从 createdAt 计算** | 非客户端本地计时 | `capability-card.md` 长时运行扩展 |
| **long-running 是 running 的视觉扩展** | 不改变状态机，仍等待 `CAPABILITY_RESULT_DELTA`/`COMPLETED` | `capability-card.md` 状态机 |
| **long-running 计时器/取消入口 transient** | 计时器/取消入口是 live streaming 瞬态 UI，history 不重建（进度 delta 由 `CAPABILITY_RESULT` 消息重建） | `conversation-ui-state.md` 第 6 节 |
| **fork 引导是建议非强制** | long-running 态显示 fork CTA，但不阻断 supersede；用户可直接发送终止长时任务 | `capability-card.md` fork-to-continue 引导 |
| **fork 引导智能 anchor** | 自动选最近 COMPLETED turn 为 anchor；首轮即长时（无 COMPLETED）不显示引导 | `capability-card.md` fork-to-continue 引导 |
| **fork 子会话看不到长时任务结果** | fork 点在长时任务之前，子会话新任务基于 fork 点之前历史 | `message-bubble.md` 派生 |
| **取消触发 request-cancel** | 用户取消触发 `REQUEST_CANCELED` | `request-cancel` spec |

---

## 场景 10：请求被取代（Supersede）[B 长时任务与并行工作流 · F 编辑与修正]

**用户输入**：`检查 Edge-RTR-01 的丢包问题`（编辑重发）/ `抱歉，应该是 Edge-RTR-02`（执行中发新消息）

说明：本场景展示 `REQUEST_SUPERSEDED` 终态的两种触发路径——编辑重发（阶段 10a-10c）和执行中发新消息（阶段 10d）。两者后端机制相同（`replaceOlderLaneWork` → 旧 turn `SUPERSEDED`），但用户意图、UI 流程和对话结构不同。

### live 视图

**阶段 10a：原始消息已发送**

```
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题

> 🤖 助手 · 执行中 ⏳
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ⏳ 进行中                         │
> └────────────────────────────────────────────────┘
```

**阶段 10b：用户点击编辑（USER 气泡编辑按钮或 `/edit` 命令）**

```
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题

┌─ Composer（edit 模式）─────────────────────────────────────┐
│  [编辑模式]                                                  │  ← primary 边框 + 蓝色阴影
│  检查 Edge-RTR-02 的丢包问题                    [✕] [⬆]   │  ← 光标在末尾，编辑后文本
└──────────────────────────────────────────────────────────────┘
```

**阶段 10c：编辑提交后，旧 turn 被取代，新 turn 出现**

```
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题
> 🔁 被取代                                      ← 旧 turn 终态

> 🧑 用户
> 检查 Edge-RTR-02 的丢包问题                    ← 新 turn（编辑后的消息）

> 🤖 助手 · 执行中 ⏳
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ⏳ 进行中                         │
> └────────────────────────────────────────────────┘
```

**阶段 10d：替代路径——执行中直接发新消息（非编辑）**

用户未等待执行完成，直接输入新消息发送。与编辑重发不同：无 edit 模式，旧消息原样保留，对话中出现两条用户消息。用户可能意图修正上一条，但系统无法识别——统一按 supersede 处理。

```
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题

> 🤖 助手 · 执行中 ⏳
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ⏳ 进行中                         │
> └────────────────────────────────────────────────┘

> 🧑 用户                                        ← 新消息（非编辑，旧消息未修改）
> 抱歉，应该是 Edge-RTR-02

> 🤖 助手 · 🔁 被取代                             ← 旧 turn 终态（被新请求取代）
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ⏹ 被取代                         │
> └────────────────────────────────────────────────┘

> 🤖 助手 · 执行中 ⏳                             ← 新 turn 开始
> ┌─ 📋 过程面板 ─────────────────────────────────┐
> │ 💭 思考 #1 · ⏳ 进行中                         │
> └────────────────────────────────────────────────┘
```

### 编辑重发 vs 执行中发新消息

| 维度 | 编辑重发（10a-10c） | 执行中发新消息（10d） |
|---|---|---|
| 触发方式 | edit 模式 → 修改文本 → 确认 | 正常输入 → 发送 |
| 旧消息 | 被替换（文本更新为修正版） | 原样保留 |
| 对话结构 | 1 条用户消息（修正版） | 2 条用户消息（原文 + 新消息） |
| edit 模式 UI | ✅（primary 边框 + 蓝色阴影） | ❌（无特殊 UI） |
| 旧 turn 终态 | `🔁 被取代`（REQUEST_SUPERSEDED） | `🔁 被取代`（REQUEST_SUPERSEDED） |
| 草稿隔离 | ✅（edit-mode 文本独立缓存） | ❌（使用 normal per-session draft） |
| 用户意图 | 明确修正 | 可能修正/补充/新问题——系统无法区分 |
| 认知差异风险 | 无（用户明确选择了编辑） | 有（用户可能以为等效于编辑重发，但旧消息不会被修改） |

### 关键视觉元素

| 元素 | 说明 |
|---|---|
| edit 模式提示 pill | "编辑模式"（primary 背景 + secondary 文字） |
| edit 模式边框 | 2px primary 边框 + 3px 蓝色阴影 |
| 取消编辑 | X 图标按钮 + Escape 键 |
| 确认编辑 | Send 图标按钮 + Enter 键 |
| 旧 turn 终态 | `🔁 被取代`（REQUEST_SUPERSEDED） |
| 草稿隔离 | edit-mode 文本不覆盖 normal per-session draft |

### history 视图

编辑重发路径（10a-10c）的 history：

```
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题
> 🔁 被取代

> 🧑 用户
> 检查 Edge-RTR-02 的丢包问题

> 🤖 助手 · ✅ 已完成
> ## 诊断结论
> Edge-RTR-02 在 08:45 的配置变更中……
```

执行中发新消息路径（10d）的 history——注意旧消息原样保留，对话中有两条用户消息：

```
> 🧑 用户
> 检查 Edge-RTR-01 的丢包问题
> 🔁 被取代                              ← 旧 turn 终态

> 🧑 用户                                ← 新消息（独立条目，非替换）
> 抱歉，应该是 Edge-RTR-02

> 🤖 助手 · ✅ 已完成
> ## 诊断结论
> Edge-RTR-02 在 08:45 的配置变更中……
```

| 约束 | live | history |
|---|---|---|
| edit 模式 | ✅ 可用（仅 10a-10c） | ❌ 不适用（无 active run） |
| 被取代标记 | ✅ 实时 | ✅ 重建 |
| 过程面板 | ✅ 可见（collapsed/expanded） | ✅ 可见（默认 collapsed，可展开） |
| 旧消息保留 | 10a-10c：替换；10d：保留 | 同 live 终态 |
| 新消息位置 | 10a-10c：替换旧消息；10d：独立新条目 | 同 live 终态 |

---

## 场景 11：取消与重试 [D 错误与异常恢复]

**用户输入**：取消运行中的请求（有部分内容），然后重试失败的请求。

### live 视图

**阶段 11a：用户按 Escape 取消运行中请求**

```
> 🧑 用户
> 生成全网配置审计报告

> 🤖 助手 · 执行中 ⏳
> ┌─ 📋 过程面板（auto-expanded ▼）─────────────────┐
> │ 💭 #1 ✅（已折叠）                                │
> │ 🔧 queryConfig · ⏳ 执行中                        │
> └────────────────────────────────────────────────┘

┌─ Composer ────────────────────────────────────────────────┐
│  [📎]  输入消息…                              [⏹ 停止]    │
│  ℹ️ 再按一次取消运行                                       │  ← ESC armed 提示
└──────────────────────────────────────────────────────────────┘
```

**阶段 11b：取消完成（有部分内容）**

```
> 🧑 用户
> 生成全网配置审计报告

> 🤖 助手
> 正在查询核心设备的配置信息……部分结果已到达。          ← partial answer
> ⏹️ 已取消（含部分内容）                                  ← CanceledNotice

┌─ Composer ────────────────────────────────────────────────┐
│  [📎]  输入消息…                              [发送]     │
│  ↻ 重试                                                   ← 重试按钮（仅最新 FAILED/CANCELED）
└──────────────────────────────────────────────────────────────┘
```

**阶段 11c：用户点击重试 → 新 turn 执行成功**

```
> 🧑 用户
> 生成全网配置审计报告
> ⏹️ 已取消（含部分内容）

> 🧑 用户                                      ← 重试创建新 turn（原消息重发）
> 生成全网配置审计报告

> 🤖 助手 · ✅ 已完成
> ## 配置审计报告
> 全网核心设备配置审计已完成……
```

### 关键视觉元素

| 元素 | 说明 |
|---|---|
| ESC 两步取消 | 第一次 armed + Alert 提示，1.8 秒内第二次确认 |
| 停止按钮 | `⏹ 停止响应`（替代发送按钮） |
| 取消通知（有内容） | `⏹️ 已取消（含部分内容）` |
| 取消通知（无内容） | `⏹️ 已取消` |
| 重试按钮 | `↻ 重试`（仅最新 FAILED/CANCELED turn + 非 executing + Write 权限） |
| 重试行为 | 创建新 request，旧 turn 保留 |

### history 视图

```
> 🧑 用户
> 生成全网配置审计报告
> ⏹️ 已取消（含部分内容）

> 🧑 用户
> 生成全网配置审计报告

> 🤖 助手 · ✅ 已完成
> ## 配置审计报告
> 全网核心设备配置审计已完成……
```

| 约束 | live | history |
|---|---|---|
| 取消通知 | ✅ 实时 | ✅ 重建 |
| 重试按钮 | ✅ 仅最新 turn | ❌ 不适用 |
| 过程面板 | ✅ 可见（collapsed/expanded） | ✅ 可见（默认 collapsed，可展开） |

---

## 场景 12：会话搜索与管理 [C 会话组织与检索]

**用户操作**：搜索历史会话 → 重命名 → 删除 → 查看收藏回合。

### live 视图

**阶段 12a：搜索会话**

```
┌─ 搜索 dialog（540px modal）──────────────────────────────┐
│  [输入关键词…]  [📅 时间范围]                              │
│                                                           │
│  搜索结果（20 条）                                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 网络诊断-2026-07-08                    14:30        │ │
│  │ hover → [更多 ▼]                                    │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ 告警排查-2026-07-07                   昨天           │ │
│  │ hover → [更多 ▼]                                    │ │
│  └─────────────────────────────────────────────────────┘ │
│  [加载更多]                                               │
└───────────────────────────────────────────────────────────┘
```

**阶段 12b：重命名会话**

```
┌─ 重命名会话 ───────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────┐  │
│  │ 网络诊断-2026-07-08-v2                            │  │
│  └──────────────────────────────────────────────────┘  │
│                                            18/100       │  ← 字符计数器
│                            [取消]  [确定]                │
└──────────────────────────────────────────────────────────┘
```

**阶段 12c：删除活跃会话**

```
┌─ 删除会话 ─────────────────────────────────────────────┐
│  确定要删除"网络诊断-2026-07-08-v2"吗？此操作不可撤销。 │
│                        [取消]  [删除]                    │  ← danger 样式
└──────────────────────────────────────────────────────────┘
```

删除活跃会话后：对话区清空 → 导航到 `/` → 侧边栏回到无选中态。

**阶段 12d：查看收藏回合**

```
┌─ 会话列表 ──────────────┐
│  [搜索] [★收藏] [新会话] │  ← 收藏按钮高亮
│                          │
│  ★ 收藏回合              │
│  告警排查-07-07    昨天  │  ← 所属会话标题
│  「分析 Edge-RTR-02…」   │  ← 收藏的 turn 预览
│  配置核查-07-06    07/06 │
│  「核对核心设备基线…」   │
│  [加载更多]              │
└──────────────────────────┘
```

> ℹ️ `[已实现-主干]` 收藏对象是 message/turn，不是 session。`listFavoriteSessions` 等 legacy service 命名不能作为“收藏会话”产品语义证据；真正的 session favorite 若需要，必须单独准入。

### 关键视觉元素

| 元素 | 说明 |
|---|---|
| 搜索 debounce | 180ms（ASCII ≥ 3 字符，非 ASCII ≥ 2 字符） |
| 日期范围 | DatePicker.RangePicker，最大 90 天 |
| 搜索结果分页 | 每页 20 条 + "加载更多" |
| 重命名 | 100 字符限制 + 计数器 + Enter 提交 |
| 删除活跃会话 | 清空对话 + 导航到 `/` |
| 收藏回合列表 | 展示收藏的 message/turn，并带所属会话标题与内容预览；不声明 session favorite |
| 会话项操作 | hover 显示"更多"dropdown（非右键菜单） |

---

## 场景 13：分享与派生 [C 会话组织与检索]

**用户操作**：从已完成 turn 分享对话片段 + 从 turn 派生新会话。

### live 视图

**阶段 13a：点击 ASSISTANT 气泡的分享按钮**

```
┌─ Turn 1（ASSISTANT 气泡）──────────────────────────────┐
│  🤖 助手 · ✅ 已完成                                    │
│  ## 诊断结论                                            │
│  Edge-RTR-02 在 08:45 的配置变更中……                   │
│                                                        │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试    ← BubbleActions │
│              ↑                                          │
│              点击分享（需 Write 权限）                   │
└────────────────────────────────────────────────────────┘

         ↓ 弹出分享 dialog

┌─ 分享对话 ──────────────────────────────────────────────┐
│  选择要分享的 turn：                                     │
│  ☑ Turn 1: 检查 Edge-RTR-02 丢包问题                    │
│  ☐ Turn 2: 查询 DHCP 地址池状态                         │
│                                                         │
│  [生成分享链接]                                          │
└──────────────────────────────────────────────────────────┘
```

**阶段 13b：生成分享链接**

```
┌─ 分享对话 ──────────────────────────────────────────────┐
│  ✅ 分享链接已生成                                       │
│  https://nextagent.example.com/share/abc123...           │
│  [复制链接]  [取消分享]                                   │
└──────────────────────────────────────────────────────────┘
```

**阶段 13c：从 Turn 1 派生新会话——点击按钮进入 busy 态**

> ℹ️ 分享选择模式开启时派生按钮不渲染（模式互斥）。用户需先退出分享模式（按 Escape 或点取消）才能看到派生按钮。

```
┌─ Turn 1（ASSISTANT 气泡）──────────────────────────────┐
│  🤖 助手 · ✅ 已完成                                    │
│  ## 诊断结论                                            │
│  Edge-RTR-02 在 08:45 的配置变更中……                   │
│                                                        │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试    ← BubbleActions │
│                      ↑                                  │
│                      点击派生（tooltip："从此回复派生会话"）
└────────────────────────────────────────────────────────┘

         ↓ 点击后（按钮进入 busy 态）

┌─ Turn 1（ASSISTANT 气泡）──────────────────────────────┐
│  🤖 助手 · ✅ 已完成                                    │
│  ## 诊断结论                                            │
│  Edge-RTR-02 在 08:45 的配置变更中……                   │
│                                                        │
│  👍  👎  ⭐  🔗 分享  🔀 派生(disabled)  ↻ 重试         │
│                      ↑                                  │
│                      busy 态：disabled + opacity 0.55   │
│                      tooltip 变为 "正在派生..."         │
│                      图标不变（无 spinner）              │
│                      其他 turn 的派生按钮仍可用          │
└────────────────────────────────────────────────────────┘
```

> ℹ️ `handleFork` 设置 `forkingAnchorKey` 标记当前 anchor（`"message:<id>"` 或 `"request:<id>"`），仅匹配的 turn 按钮进入 busy 态。API 调用完成后在 `finally` 中清除。来源：`ChatPage.tsx` L1602-1603, L1624-1626; `TurnBlock.tsx` L429, L538-543。

**阶段 13d：派生成功——导航到新会话**

```
→ navigation.openSession(childSession.sessionId)
→ loadSessions() 刷新会话列表（新会话高亮选中）
→ 无成功 toast

┌─ Fork notice banner ────────────────────────────────────┐
│  由 "网络诊断-2026-07-08" 派生                            │
│                ▲                                          │
│                └─ 仅标题为可点击链接（打开来源会话）        │
└──────────────────────────────────────────────────────────┘

┌─ Turn 1（USER 气泡）────────────────────────────────────┐
│  🧑 用户                          ← 从派生点复制的上下文 │
│  检查 Edge-RTR-02 丢包问题                               │
└──────────────────────────────────────────────────────────┘

┌─ Turn 2（ASSISTANT 气泡）───────────────────────────────┐
│  🤖 助手 · ✅ 已完成              ← 从派生点复制的上下文 │
│  ## 诊断结论                                            │
│  Edge-RTR-02 在 08:45 的配置变更中……                   │
│                                                        │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试   ← 复制上下文亦可继续操作
└──────────────────────────────────────────────────────────┘

┌─ Composer ──────────────────────────────────────────────┐
│  [📎]  输入消息…                              [发送]     │  ← 用户可继续提问
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 成功后前端调用 `setActiveSessionId` + `navigation.openSession` 导航到新会话，`loadSessions` 刷新会话列表。fork notice 由 conversation bootstrap 投影（`ForkNotice { sourceSessionId, sourceSessionTitle }`），来源标题为派生时刻快照。来源：`ChatPage.tsx` L1617-1621; `contracts.ts` L233-236。

**阶段 13e：派生失败——error toast + 保留原会话**

```
         ⚠️ 派生会话失败，请稍后重试。       ← antd Message error toast（顶部短暂提示）

┌─ Turn 1（ASSISTANT 气泡）──────────────────────────────┐
│  🤖 助手 · ✅ 已完成              ← 仍在原会话（未导航） │
│  ## 诊断结论                                            │
│  Edge-RTR-02 在 08:45 的配置变更中……                   │
│                                                        │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试    ← 按钮恢复正常 │
│                                   （forkingAnchorKey 已清除）
└────────────────────────────────────────────────────────┘
```

> ℹ️ 失败时显示 `antdMessage.error(t("requestNotices.forkFailed"))`，不导航、不创建会话。`forkingAnchorKey` 在 `finally` 中清除，按钮恢复可点。不区分失败原因（来源不存在 / 网络失败 / 权限不足）。来源：`ChatPage.tsx` L1622-1626。

**阶段 13f：用户在派生会话中发首条消息——banner 消失**

```
                                         ← banner 已消失（不再显示）

┌─ Turn 1（USER 气泡）────────────────────────────────────┐
│  🧑 用户                          ← 从派生点复制的上下文 │
│  检查 Edge-RTR-02 丢包问题                               │
└──────────────────────────────────────────────────────────┘

┌─ Turn 2（ASSISTANT 气泡）───────────────────────────────┐
│  🤖 助手 · ✅ 已完成              ← 从派生点复制的上下文 │
│  ## 诊断结论                                            │
│  Edge-RTR-02 在 08:45 的配置变更中……                   │
│                                                        │
│  👍  👎  ⭐  🔗 分享  🔀 派生  ↻ 重试                   │
└──────────────────────────────────────────────────────────┘

┌─ Turn 3（USER 气泡）────────────────────────────────────┐
│  🧑 用户                          ← 新消息（首条，触发  │
│  那配置变更对 OSPF 邻居有什么影响？     banner 消失）    │
└──────────────────────────────────────────────────────────┘

┌─ Turn 4（ASSISTANT 气泡）───────────────────────────────┐
│  🤖 助手 · ⏳ 执行中              ← 新 turn 追加到复制  │
│  ...                                 上下文之后          │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 首条消息提交时 `clearForkNotice(sessionId)` 清除 store 中的 fork notice，同时 live layer 出现 USER stream envelope → `activeForkNotice` 置空 → banner 消失。后续对话与普通会话一致。来源：`requestStore.ts` L425; `conversationStore.ts` L1650-1657; `ChatPage.tsx` L782-783。

### 关键视觉元素

| 元素 | 说明 |
|---|---|
| 分享按钮 | `🔗 分享`（BubbleActions 中，需 Write 权限） |
| 分享设置 modal | 勾选 turn + 生成链接 + 复制/取消 |
| 分享选择模式 | 开启时派生按钮不渲染（模式互斥）；退出方式：Escape / 点取消 |
| 派生按钮 | `ForkOutlined` 图标（icon-only，tooltip "从此回复派生会话"），BubbleActions 中，需 Write 权限 |
| 派生条件 | `COMPLETED` 态（durable 已完成或 live-completed）+ 有 answer content；failed/canceled/superseded/in-flight 不可派生 |
| 派生 busy 态 | `forkingAnchorKey` 匹配的按钮 disabled + opacity 0.55 + tooltip 变 "正在派生..."，**无 spinner**（图标不变）；仅该 turn 按钮 busy，其他 turn 仍可用 |
| 派生路由 | 前端据 forkAnchor 自动选用 message-route 或 request-route，用户无感 |
| 派生成功 | `navigation.openSession` + `loadSessions` 刷新列表 + 新会话高亮选中；**无成功 toast**；`forkingAnchorKey` 在 `finally` 清除 |
| 派生失败 | error toast "派生会话失败，请稍后重试。"，保留原会话不导航，按钮恢复可点；不区分失败原因 |
| Fork notice banner | "由 [来源标题] 派生"，来源标题为可点击链接（快照，打开来源会话） |
| banner 消失时机 | 首条消息提交 → `clearForkNotice` + live USER envelope → `activeForkNotice = null` → banner 消失 |
| 派生行为 | 创建新会话 + 复制上下文 + 导航到新会话 |

### history 视图

派生创建的新会话本身就是历史会话，浏览时与普通历史会话一致。Fork notice banner 在 history 模式下仍可见（它是持久化数据）。

---

## 场景 14：Sub-agent 委派 [G 委派与能力扩展]

**用户输入**：`探测核心交换机 Core-SW-01 的邻居拓扑`

**说明**：演示模型通过 Agent 工具将子任务委派给 `network-explorer` sub-agent。mock server 当前不产生 Agent 工具事件，本场景为**设计规格**，基于代码实际行为描述期望渲染。

### 阶段 14.1：模型调用 Agent 工具（running 态）

模型发现 system prompt 中列出的可用 sub-agent，调用 Agent 工具委派网络拓扑探测任务。

---

> 🧑 **用户**
>
> 探测核心交换机 Core-SW-01 的邻居拓扑

> 🤖 **助手** · 执行中 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 思考 #1 · ✅ 已完成（已折叠）
>
> 🔧 **能力调用：Agent** · ⏳ 执行中
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `Agent` |
> | 参数 | `agentId=network-explorer, prompt=探测 Core-SW-01 邻居拓扑` |
> | 状态 | 执行中 |
>
> ℹ️ 子 agent 在独立 session/run 中执行（`priority: LOW`），父 turn 阻塞等待。子 agent 内部执行过程不可见。

> ℹ️ 图标为 skill 图标（`resolveProcessIconType` 检测到 title 含 "agent" → 返回 `"skill"`，与 Skill 工具相同）。子 agent 的思考、工具调用等内部过程**不在父 turn 过程面板中呈现**——Agent 工具是内部过程不可见的单步能力。

---

### 阶段 14.2：子 agent 执行完成（终态能力卡片）

子 agent 完成，返回终态文本。父能力卡片呈现终态。

---

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 #1 ✅（已折叠）
>
> 🔧 **能力调用：Agent** · ✅ 已完成
>
> | 字段 | 值 |
> |---|---|
> | 能力 ID | `Agent` |
> | 状态 | 已完成 |
> | 结果 | 不显示（`STATUS_ONLY`） |
>
> ℹ️ `Agent` 没有平台安全结果 projector，即使配置请求更高档位，有效级别仍为 `STATUS_ONLY`。父能力卡片只显示 Agent 业务身份和成功状态，不显示子 agent 返回正文或占位摘要。

---

### 阶段 14.3：模型基于子 agent 结果生成最终回答

模型基于子 agent 返回的拓扑数据继续推理，生成最终回答。

---

> 📋 **过程面板**（auto-collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开查看思考 + Agent 能力卡片)*

> 🤖 **助手** · ✅ 已完成
>
> ## Core-SW-01 邻居拓扑
>
> 根据子 agent 的探测结果，Core-SW-01 的邻居关系如下：
>
> | 邻居接口 | 邻居设备 | 邻居接口 | 状态 |
> |---|---|---|---|
> | Gi0/1 | Edge-RTR-01 | Gi0/0 | up |
> | Gi0/2 | Access-SW-01 | Gi0/24 | up |
> | Gi0/3 | Access-SW-02 | Gi0/24 | down |

---

### 场景 14 的历史对话浏览视图（completed thinking 可恢复）

---

> 🧑 **用户**
>
> 探测核心交换机 Core-SW-01 的邻居拓扑

> 📋 **过程面板**（collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开 completed thinking + Agent 能力卡片；history 不重建未完成 delta。)*

> 🤖 **助手** · ✅ 已完成
>
> ## Core-SW-01 邻居拓扑
>
> 根据子 agent 的探测结果，Core-SW-01 的邻居关系如下……

（`[已实现-主干]` history 可重建 completed thinking 和 Agent 能力卡片终态。）

---

### 场景 14 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **子 agent 内部不可见** | 父 turn 只看到 Agent 工具单步能力卡片，不展示 child session 内部的思考、工具调用、降级等过程 | `agent-tool.ts` 仅返回结果，不暴露内部过程 |
| **禁止嵌套** | 子 run 不可再调用 Agent 或 AskUserQuestion | `submit.ts` L805-818 自动注入 `forbiddenCapabilityIds` + `allowSubagents: false` |
| **低优先级调度** | 子 run `priority: "LOW"`，不抢占用户顶层请求 | `subagent-execution-port.ts` L62 |
| **结果无 safeResult.kind** | Agent 结果形状 `{ text }` 不匹配任何已知 kind，落入 unknown 兜底 | `stream-envelope.ts` `projectSafeCapabilityResultProjection` |
| **图标与 Skill 相同** | title 含 "agent" → `resolveProcessIconType` 返回 `"skill"` | `ProcessPanel.tsx` L34-35 |
| **结果文本上限** | 子 agent 终态文本上限 100,000 字节，prompt 上限 8,192 字节 | `agent-tool.ts` L10-11 |
| **禁止自调用** | agent 不可调用自身 | `agent-tool.ts` L43-45 |

> ⚠️ **设计 gap**：Agent 工具结果当前落入 unknown 兜底，无结构化卡片呈现。UCD 设计人员可考虑为 sub-agent 结果设计专用视觉模板（如显示 `agentId`、子 run 状态、终态文本预览），但这需要后端新增 `safeResult.kind` 投影，属于后续 change 范围。

---

## 场景 15：页面关闭与重开 [D 错误与异常恢复]

**说明**：演示用户关闭页面后重新打开的恢复流程。mock server 不产生 activeRun，本场景为**设计规格**，基于 `ts-stream-resume-replay` spec 和前端 `useStreamConnection.ts` 实际行为描述。

### 阶段 15.1：用户关闭页面（turn 正在执行）

---

> 🧑 **用户**
>
> 帮我分析这台设备的最近告警

> 🤖 **助手** · 执行中 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 思考 #1 · ⏳ 流式中
>
> 🔧 **能力调用：QueryAlerts** · ⏳ 执行中

> ℹ️ 用户此时关闭浏览器标签页。浏览器终止 SSE/WebSocket 连接，内存中的 `lastSeenSequence` cursor 丢失。

---

### 阶段 15.2：用户重开页面——conversation bootstrap + history 重建

---

> 📋 **过程面板**（collapsed ▶ 已完成）
>
> *(已完成的历史 turn，过程面板默认折叠)*

> ℹ️ 前端执行 conversation bootstrap：`GET /api/v1/sessions/{sessionId}/conversation`，加载持久化消息历史，重建为 history envelopes（`transportHints: ["history-load"]`）。正在执行的 turn 暂时不可见（尚未建立 stream）。

---

### 阶段 15.3a：有 activeRun——run-scoped stream 重放

---

> 🤖 **助手** · 执行中 ⏳

> 📋 **过程面板**（auto-expanded ▼）
>
> 💭 思考 #1 · ⏳ 执行中（从 sequence 0 重放）
>
> 🔧 **能力调用：QueryAlerts** · ⏳ 执行中

> ℹ️ conversation bootstrap 返回非终态 `activeRun { requestId, runId, status }`。前端以 `lastSeenSequence=0` 打开 run-scoped stream，从开头重放该 run 的所有 stream 事件：思考条目、能力卡片从 sequence 0 重放，随后继续接收 live 事件。`continuityPhase` 从 `idle` 直接到 `connected`，无"重连中"指示。

---

### 阶段 15.3b：无 activeRun——turn 已完成（替代路径）

---

> 📋 **过程面板**（collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开查看思考 + 能力卡片终态)*

> 🤖 **助手** · ✅ 已完成
>
> 根据查询结果，最近告警如下……

> ℹ️ turn 在关闭期间已完成，用户直接从持久化消息看到终态。过程面板默认折叠，展开后可见能力结果终态卡片与 completed thinking；未完成 delta 不重建。前端打开 no-cursor live-tail stream（省略 `lastSeenSequence`），仅接收后续新事件。

---

### 阶段 15.4：opening reconcile（打开时对账）

---

> ℹ️ no-cursor live-tail 建立后，前端执行一次 conversation refresh，合并已接收的实时事件，去重，不产生重复 turn 或过程条目。

---

### 场景 15 的历史对话浏览视图（completed thinking 可恢复）

---

> 📋 **过程面板**（collapsed ▶ 已完成）
>
> *(点击 ▶ 可展开 completed thinking + 能力卡片；history 不重建未完成 delta。)*

> 🤖 **助手** · ✅ 已完成
>
> 根据查询结果，最近告警如下……

有 activeRun 的重连路径会重放该 run 的 canonical stream 并继续 live-tail；无 activeRun 的纯 history 路径加载 Message history 和持久化 Event history。两条路径对 completed thinking 最终一致，但纯 history 不包含未完成 delta。

---

### 场景 15 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **cursor 丢失** | 页面关闭后内存 cursor 丢失，spec 禁止持久化到 sessionStorage | `ts-stream-resume-replay` L7 |
| **conversation bootstrap 先于 stream** | 冷启动必须先加载 conversation 再开 stream | `ts-stream-resume-replay` L29-33 |
| **activeRun bootstrap 从 0 重放** | `lastSeenSequence=0`，run-scoped stream 重放全部 run 事件 | `ts-stream-resume-replay` L36-43, `useStreamConnection.ts` L461-471 |
| **无"重连中"态** | 当前 conversation 的 `continuityPhase` 从 `idle` 到 `connected`，不经过 `reconnecting` | `useStreamConnection.ts` / `conversationStore.ts` |
| **stream activity timeout** | 15 秒无活动超时，force-refresh conversation | `useChatSessionStream.ts` L21 |
| **opening reconcile（打开时对账）** | live-tail 建立后执行一次 conversation refresh，去重 | `ts-stream-resume-replay` L33 |
| **不推断 activeRun** | 前端 MUST NOT 通过扫描 visible history 推断 active run 身份 | `ts-stream-resume-replay` L49 |

---

## 场景 16：Run Graph 完整执行流程 [A 核心对话与任务执行]

**用户输入**：（复用场景 7 的多轮任务）`排查 Edge-RTR-02 丢包问题，先查告警再查配置`

**说明**：演示"完整过程"按钮打开 Run Graph 的端到端渲染，含 side-split（右侧展开）和 drawer（覆盖）两种布局模式。来源：`process-panel.md` 的"Run Graph 抽屉"章节、`03` 第 2.6 节、`features/run-graph/` 实现。

### 阶段 16.1：触发 Run Graph

用户在复杂多轮 turn 完成后，想查看完整执行流程。过程面板 summary row 右侧有"完整过程"按钮。

---

> 📋 **过程面板**（auto-collapsed ▶ 已完成）
>
> 💭 #1 ✅ · 🔧 #1 ✅ · 💭 #2 ✅ · 🔧 #2 ✅ · 📝 回复 ✅
>
> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; **[完整过程]**
>
> *(点击"完整过程"按钮 → 打开 Run Graph)*

> ℹ️ "完整过程"按钮在过程面板 summary row 右侧（`ProcessPanel.tsx` `onOpenFullProcess`）。注意：这与过程面板 ▶ 展开/折叠不同——▶ 展开查看 think/capability 条目列表，"完整过程"按钮打开流程图画布。两者同名但不同物。

---

### 阶段 16.2：side-split 模式（视口充足，右侧展开）

视口宽度 ≥ 932px（560 对话区 + 360 graph + 12 拖拽条），Run Graph 在右侧展开，对话区不被覆盖，两者并排。

```
┌──────────────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区（不被覆盖）         │  Run Graph（右侧展开） │
│             │                            │ [Fit][Reset]    [Close]│
│  ● 会话 A   │  > 🧑 用户                 ├──────────────────────┤
│  ● 会话 B   │  > 排查 Edge-RTR-02...     │                      │
│  ▸ 会话 C   │                            │  ┌────────┐          │
│             │  > 🤖 助手 · ✅ 已完成      │  │request │          │
│             │  > ## 诊断结论              │  └───┬────┘          │
│             │  > Edge-RTR-02 在 08:45...  │      ▼               │
│             │                            │  ┌────────┐          │
│             │  📋 过程面板 ▶ 已完成       │  │ model  │          │
│             │     [完整过程] ← 已点击     │  └───┬────┘          │
│             │                            │      ▼               │
│             │  ┌─ Composer ───────────┐  │  ┌────────┐          │
│             │  │ [📎] 输入消息… [发送] │  │  │capability│        │
│             │  └──────────────────────┘  │  └───┬────┘          │
│             │                            │      ▼               │
│             │                            │  ┌────────┐          │
│             │                            │  │ model  │          │
│             │                            │  └───┬────┘          │
│             │                            │      ▼ ...           │
│             │                            │  ┌────────┐          │
│             │                            │  │terminal│          │
│             │                            │  └────────┘          │
│             │  ← 拖拽条 (12px) →         │                      │
└──────────────────────────────────────────────────────────────────┘
```

> ℹ️ side-split 模式：对话区与 Run Graph 并排，graph 占右侧。可拖拽中间 12px 拖拽条调整 graph 宽度（360–1040px，键盘步进 32px）。`shouldUseGraphDrawer` 返回 false 时使用此模式。

---

### 阶段 16.3：选中节点查看详情

用户点击画布中的 capability 节点，右侧/下方节点详情面板（`SelectedNodeDetail`）显示节点详情。

```
┌─ Run Graph ──────────────────────────────────────────┐
│  [Fit][Reset]                          [Close]       │
├──────────────────────────┬───────────────────────────┤
│                          │  节点详情面板              │
│  ┌────────┐              │                           │
│  │request │              │  capability #1            │
│  └───┬────┘              │  状态：✅ 已完成           │
│      ▼                   │  阶段：执行中              │
│  ┌────────┐              │  事件计数：3               │
│  │ model  │              │  指标：toolCallId=tc_001  │
│  └───┬────┘              │                           │
│      ▼                   │  详情行：                  │
│  ┌─────────────┐ ← 选中   │  capabilityId=alertQuery │
│  │capability #1│ (高亮)   │  status=COMPLETED        │
│  └───┬─────────┘          │                           │
│      ▼                   │  引用列表：                │
│  ┌────────┐              │  • CAPABILITY_STARTED     │
│  │ model  │              │    seq=12, t=08:45:03     │
│  └───┬────┘              │  • CAPABILITY_RESULT_DELTA│
│      ▼                   │    seq=14, t=08:45:04     │
│  ┌────────┐              │  • CAPABILITY_COMPLETED   │
│  │terminal│              │    seq=15, t=08:45:04     │
│  └────────┘              │                           │
└──────────────────────────┴───────────────────────────┘
```

> ℹ️ 选中节点后详情面板显示：节点标题（类型 + 序号）、状态徽章、阶段标签、事件计数、指标（capability 节点显示 toolCallId）、详情行、引用列表（每个引用含 eventType / sequence / timestamp）。7 种节点类型各有相位色。

---

### 阶段 16.4：drawer 模式（视口不足，覆盖对话区）

视口宽度 < 932px，Run Graph 作为 Drawer 覆盖对话区。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  Run Graph（Drawer，覆盖对话区）           │
│             │  [Fit][Reset]                    [Close]   │
│  ● 会话 A   │ ─────────────────────────────────────────┐ │
│  ● 会话 B   │ │                                        │ │
│  ▸ 会话 C   │ │  X6 流程图画布（全宽）                  │ │
│             │ │                                        │ │
│             │ │  request → model → capability →        │ │
│             │ │  model → capability → answer →         │ │
│             │ │  terminal                               │ │
│             │ │                                        │ │
│             │ │  (节点详情面板在下方，选中节点时显示)    │ │
│             │ │                                        │ │
│             │ └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ drawer 模式：Run Graph 覆盖对话区（非并排）。`shouldUseGraphDrawer` 返回 true 时使用此模式。视口宽度变化时（如缩放浏览器窗口），`useGraphDrawerMode` 通过 ResizeObserver 自动切换 side-split ↔ drawer。

---

### 阶段 16.5：关闭 Run Graph

用户点击 Close 按钮，Run Graph 关闭，回到对话区。

---

> ℹ️ 关闭后回到触发前的对话区状态。Run Graph 是只读查看，不修改 conversation、不触发新执行。

---

### 场景 16 的历史对话浏览视图（history 模式）

Run Graph 在 history 模式下可基于**实际已重建**的 TurnBlock 事件流打开，并由 `buildRunGraphViewState` 转换为 `RunGraphViewState`。completed thinking 可由 Event history 恢复，但 history 不包含未完成 delta，因此不能把瞬时 live 图谱误作持久事实。

> ℹ️ history 模式下的布局交互可与 live 一致：side-split / drawer 自适应、节点选中、详情面板、缩放/平移。内容只来自已持久化事实，包含 completed thinking，但不显示 ⏳ running 中间态或未完成 delta。

---

### 场景 16 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **触发入口** | 过程面板 summary row 右侧"完整过程"按钮，非 ▶ 展开折叠 | `ProcessPanel.tsx` L588 |
| **"完整过程"同名歧义** | ▶ 展开折叠查看条目列表 vs "完整过程"按钮打开流程图——同名不同物 | `process-panel.md` Run Graph 抽屉 |
| **side-split 优先** | 视口充足时并排，不覆盖对话区；不足时降级 drawer | `graphDetailLayout.ts` L30 |
| **布局自适应阈值** | 932px（560 对话区 + 360 graph + 12 拖拽条） | `graphDetailLayout.ts` L3-7 |
| **可拖拽分栏宽度** | 360–1040px，拖拽条 12px，键盘步进 32px | `graphDetailLayout.ts` L3-8 |
| **7 种节点类型** | request / model / capability / userInput / degradation / answer / terminal | `types.ts` L14-21 |
| **节点状态徽章** | ⏳✅❌⏹️🔁（history 模式无 ⏳） | `RunGraphNodeState` |
| **画布缩放范围** | 0.6–1.35 | `X6FlowDiagram.tsx` L146 |
| **只读查看** | 不触发新执行、不修改 conversation | `process-panel.md` Run Graph 抽屉 |
| **live/history 均可打开** | 基于已重建 TurnBlock 事件流；history 包含持久化 completed thinking，但不包含未完成 delta | `buildRunGraphViewState.ts`；B16 |
| **懒加载** | `TurnRunGraphPanel` 懒加载，首次打开才加载 | `ChatPage.tsx` L61-62 |

---

## 场景 17：右侧展开面板——地图故障分布 [A 核心对话与任务执行]

**用户输入**：`查看陆家嘴顺势故障分布`

**说明**：演示对话执行中富内容（地图）通过 PIU 机制在右侧展开面板呈现。对话区收到左侧固定宽度，右侧画布承载交互式地图。来源：`05-component-specs/expand-panel.md`、`features/expand-panel/`、`piu/layout.ts`。地图是 PIU 组件（`piuName: "fault-distribution-map"`），不新增内容类型。

### 阶段 17.1：用户提问，Agent 执行

用户提问后，Agent 调用能力查询故障分布数据。对话区显示用户消息 + 思考 + 能力卡片 running 态。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │                                            │
│  ● 会话 A   │  > 🧑 用户                                 │
│  ▸ 会话 B   │  > 查看陆家嘴顺势故障分布                   │
│             │                                            │
│             │  > 🤖 助手 · 🔄 执行中                      │
│             │  > 💭 #1 思考中...                          │
│             │  📋 过程面板 ▶ 执行中                       │
│             │    └ 🔧 faultQuery 🔄 查询故障分布...        │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [⏹停止]  │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

### 阶段 17.2：EXPAND_PANEL 事件到达，右侧面板自动打开

Agent 能力执行完成，推送 `TOOL_STRUCTURED_DELTA`（`toolEventType: "EXPAND_PANEL"`，`toolMessageType: "PIU"`）。前端 stream watcher 自动打开右侧展开面板。对话区收到左侧固定宽度（484px），Expand Panel 占满右侧剩余空间。

气泡内显示 PIU 占位符，富内容在右侧面板呈现。

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区（484px 固定宽度，收到左侧）  │  Expand Panel（flex:1）│
│             │                                    │  [× Close]             │
│  ● 会话 A   │  > 🧑 用户                         ├────────────────────────┤
│  ▸ 会话 B   │  > 查看陆家嘴顺势故障分布           │                        │
│             │                                    │  🗺️ 陆家嘴故障分布地图  │
│             │  > 🤖 助手 · ✅ 已完成              │                        │
│             │  > ## 故障分布概览                  │   ┌────────────────┐   │
│             │  > 陆家嘴区域共 12 处故障...        │   │   📍 📍 📍      │   │
│             │                                    │   │  📍  📍  📍    │   │
│             │  > [PIU: fault-distribution-map    │   │   📍 📍 📍 📍  │   │
│             │     @1.0（等待宿主渲染）]           │   │     📍 📍       │   │
│             │                                    │   └────────────────┘   │
│             │  📋 过程面板 ▶ 已完成               │                        │
│             │    └ 🔧 faultQuery ✅               │  图例：● 高压  ▲ 低压  │
│             │                                    │        ◆ 通信中断       │
│             │  ┌─ Composer ──────────────────┐  │                        │
│             │  │ [📎] 输入消息…      [发送]    │  │                        │
│             │  └──────────────────────────────┘  │                        │
└──────────────────────────────────────────────────────────────────────────┘
```

> ℹ️ 触发方式是流式事件自动打开（`useExpandPanelStreamWatcher.ts` 监听 `toolEventType === "EXPAND_PANEL"`），**非用户点击气泡卡片**。气泡内 PIU 占位符显示"PIU: {piuName}@{piuVersion}（等待宿主渲染）"，富内容在右侧面板呈现。

> ℹ️ PIU 机制：`PiuMessage` 调用 `window.Prel.autoLoad("fault-distribution-map", "1.0")` 加载组件包，再 `piu.emit("render", { data, wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId })` 在容器内渲染。地图、图表、仪表盘等富交互组件均通过 PIU 承载。

---

### 阶段 17.3：用户与地图交互

用户在右侧面板内与地图交互：缩放、平移、点击故障标注查看详情。PIU 组件可通过 `handleExpandPanelOpen/Close` 控制面板开关。

```
┌─ Expand Panel ──────────────────────────────────────────┐
│  陆家嘴故障分布地图                         [× Close]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│         ┌─────────────────────┐                         │
│         │  📍 📍              │  ← 点击标注弹出详情：     │
│         │    📍(选中) 📍      │     故障 #F-2026-0713   │
│         │  📍   📍 📍 📍      │     类型：高压故障       │
│         │     📍 📍            │     状态：处理中        │
│         └─────────────────────┘     时间：08:42         │
│                                                         │
│  [+ 缩放] [-] [⛶ 适配]                                  │
└─────────────────────────────────────────────────────────┘
```

> ℹ️ docked/floating/maximized 是协作式（PIU）宿主面板的布局模式（`CollaborativePanelLayout`），不是 Expand Panel 的。Expand Panel 布局由宿主模式决定：flex sibling（本地/沉浸式）或 fixed overlay（协作式/PIU）。详见 `05-component-specs/expand-panel.md` 布局模式章节。

---

### 阶段 17.4：关闭面板

用户通过以下方式关闭面板：
- 点击 Close 按钮（`ExpandPanel.tsx` 右上角 `CloseOutlined`）
- PIU 组件调用 `handleExpandPanelClose` 回调
- turn 切换 / session 切换自动关闭
- 打开 Run Graph 自动关闭（互斥，二者共享右侧空间）

关闭后回到对话区全宽状态。

---

### 场景 17 的历史对话浏览视图（history 模式）

history 模式下，`EXPAND_PANEL` 事件带 `history-load` transport hint，stream watcher 跳过（`if (event.transportHints.includes("history-load")) continue;`），**面板不自动打开**。用户浏览历史对话时看到的是过程面板中的工具条目（PIU 占位符），不自动展开右侧面板。若需查看富内容，需用户主动触发（如点击条目——当前未实现，见 `expand-panel.md` UCD 设计建议）。

> ℹ️ history 模式与 live 模式的关键差异：live 模式 `EXPAND_PANEL` 事件到达时自动打开面板；history 模式 `history-load` 事件被跳过，不自动打开。这与 Run Graph 不同——Run Graph 在 history 模式下仍可手动打开（基于已重建事件流），Expand Panel 当前无手动打开入口（依赖流式事件自动触发）。

---

### 场景 17 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **触发仅限 EXPAND_PANEL** | `toolEventType === "EXPAND_PANEL"` 才打开面板，其他 toolEventType 不打开 | `useExpandPanelStreamWatcher.ts` L6 |
| **6 种 ToolMessageType** | PIU / TEXT / FILE / ACTION / OPERATOR / DSL，其他类型被 `VALID_TOOL_MESSAGE_TYPES` 忽略 | `useExpandPanelStreamWatcher.ts` L6 |
| **PIU 是可扩展类型** | 地图、图表、仪表盘等富交互组件均注册 `piuName`，不新增 ToolMessageType | `PiuMessage.tsx`、`expand-panel.md` |
| **对话区固定宽度** | Expand Panel 打开时对话区 `flex: 0 0 484px`（`DOCKED_DEFAULT_WIDTH = 484`），面板 `flex: 1 1 auto` | `piu/layout.ts` L2、`ChatPage.tsx` L2075-2117 |
| **布局类型由宿主模式决定** | flex sibling（本地/沉浸式，与对话区并排）/ fixed overlay（协作式/PIU，覆盖在 PIU 面板左侧）。docked/floating/maximized 是 PIU 宿主面板模式，非 Expand Panel | `ChatPage.tsx` L2066-2107、`AIAgentPiuRuntime.tsx` L217-222 |
| **与 Run Graph 互斥** | 打开 Expand Panel 关闭 Run Graph；打开 Run Graph 时 Expand Panel 不显示 | `ChatPage.tsx` L851 |
| **turn/session 切换关闭** | 切换 turn 或 session 时自动关闭面板 | `ChatPage.tsx` L870-877 |
| **history 不自动打开** | `history-load` 事件被 stream watcher 跳过 | `useExpandPanelStreamWatcher.ts` L31-33 |
| **PIU 依赖 window.Prel** | 本地环境不可用时显示"PIU 内容（本地不可预览）" | `PiuMessage.tsx` |
| **位置可配** | `expandPanelPosition = "LEFT" \| "RIGHT"`，默认 RIGHT | `ChatPage.tsx` L846 |
| **触发非点击** | 流式事件自动打开，非用户点击气泡卡片 | `useExpandPanelStreamWatcher.ts` |

---

## 场景 18：打开 OSS 配置——导航卡片与集成方页面跳转 [A 核心对话与任务执行]

**用户输入**：`打开 OSS 配置`

**说明**：演示对话中通过 OPERATOR LINK 导航卡片通知集成方打开外部页面。NextAgent 仅 `document.dispatchEvent` 通知集成方，页签管理由集成方在 NextAgent 页面外部实现。来源：`05-component-specs/sub-window.md`、`OperatorButtons.tsx`、`add-ts-tool-structured-delta/design.md` L64-82。本场景为 UCD 设计规格——OPERATOR `type: "LINK"` 字段已声明但未实现渲染区分，NextAgent 前端不监听 CustomEvent、不管理页签。

### 阶段 18.1：用户提问，Agent 响应导航卡片

用户提问"打开 OSS 配置"，Agent 执行后推送 `TOOL_STRUCTURED_DELTA`（`toolMessageType: "OPERATOR"`，content 中 `type: "LINK"`），对话气泡内联渲染导航卡片。

```
┌─ NextAgent 嵌入区域 ─────────────────────────────────────┐
│                                                          │
│  > 🧑 用户                                              │
│  > 打开 OSS 配置                                         │
│                                                          │
│  > 🤖 助手 · ✅ 已完成                                    │
│  > ## OSS 配置入口                                        │
│  > 已为你找到 OSS 配置页面。                              │
│                                                          │
│  ┌─ 导航卡片 ──────────────────────────────────────┐    │
│  │  📦 OSS 配置                                     │    │
│  │  对象存储服务配置页                               │    │
│  │  可管理 Bucket、权限、生命周期策略                │    │
│  │                                    [打开 →]      │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  📋 过程面板 ▶ 已完成                                     │
│                                                          │
│  ┌─ Composer ──────────────────────────────────────┐    │
│  │ [📎] 输入消息…                          [发送]    │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 导航卡片是 OPERATOR ToolMessageType 的 `type: "LINK"` 渲染（UCD 设计建议，当前未实现——所有 OPERATOR 条目均渲染为按钮）。卡片内联在气泡中，不在 Expand Panel 中呈现。`data` 字段携带导航目标：`{ "url": "/oss/config", "title": "OSS 配置", "embed": "iframe" }`。

---

### 阶段 18.2：用户点击卡片，集成方打开外部 tab（全屏切换）

用户点击导航卡片，`document.dispatchEvent(new CustomEvent("openOssConfig", { detail: { url, title, embed, ... } }))` 触发。**集成方应用**监听事件，在自身页面打开新 tab 并自动激活——OSS 配置 tab 全屏显示外部页面，**NextAgent 对话不可见**。

```
集成方页面——OSS 配置 tab 激活（全屏）：
┌─ [NextAgent] ─┬─ [OSS 配置 ×] ↑激活 ────────────────────────┐
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  OSS 配置页（iframe 嵌入，全屏）                    │  │
│  │                                                    │  │
│  │  Bucket 列表                                       │  │
│  │  • prod-assets                                     │  │
│  │  • staging-log                                     │  │
│  │  • backup-cold                                     │  │
│  │                                                    │  │
│  │  [新建 Bucket]                                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
  ↑ 切到 OSS 配置 tab 时全屏显示外部页面，NextAgent 对话不可见。
    NextAgent 嵌入区域在背后保留——对话状态不丢失（流式连接、草稿、过程面板）。
```

> ℹ️ **整页切换**：切到 OSS 配置 tab 时全屏显示外部页面，NextAgent 对话不可见。这与 Expand Panel 的并排共存（对话区 + 面板同时可见）是关键区别。NextAgent 嵌入区域在背后保留——对话状态不丢失。点击 [NextAgent] tab 切回即可恢复对话。

> ⚠️ **NextAgent 职责边界**：`OperatorButtons.tsx` L64 已实现 `document.dispatchEvent`，NextAgent 职责到此结束。页签管理（打开/切换/关闭/去重）、页面嵌入由集成方实现，不在 NextAgent 范围内。

---

### 阶段 18.3：切回 NextAgent tab，继续对话（集成方行为）

用户点击 [NextAgent] tab，全屏切回 NextAgent 嵌入区域——对话状态完整恢复。

```
集成方页面——NextAgent tab 激活（全屏）：
┌─ [NextAgent] ↑激活 ─┬─ [OSS 配置 ×] ──────────────────────┐
│                                                          │
│  ┌─ NextAgent 嵌入区域 ──────────────────────────────┐  │
│  │  对话区                                            │  │
│  │  > 🧑 用户                                        │  │
│  │  > 打开 OSS 配置                                   │  │
│  │  > 🤖 助手 · ✅ 已完成                              │  │
│  │  > ┌─ 导航卡片 ──────────────┐                    │  │
│  │  > │ 📦 OSS 配置  [打开 →]    │                    │  │
│  │  > └──────────────────────────┘                    │  │
│  │  📋 过程面板 ▶ 已完成                               │  │
│  │  ┌─ Composer ──────────────────┐                  │  │
│  │  │ [📎] 输入消息…      [发送]   │                  │  │
│  │  └──────────────────────────────┘                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
  ↑ 切回 NextAgent tab 时全屏显示对话，OSS 配置 tab 在背后保留。
    对话状态完整恢复——流式连接保持、草稿保留、过程面板状态保留。
```

- 切回 NextAgent tab：全屏显示 NextAgent 对话，对话状态完整保留，可继续输入。
- 关闭 OSS 配置 tab：由集成方处理，关闭后自动激活 NextAgent tab。关闭不影响 NextAgent 对话状态。

> ℹ️ 页签的打开/切换/关闭是集成方的 UI 行为，不持久化在 conversation 中。NextAgent 嵌入区域始终保留，是用户的对话主界面。

---

### 场景 18 的历史对话浏览视图（history 模式）

history 模式下，OPERATOR 内容由持久化消息重建。`[已实现-主干]` 当前重建后仍是普通按钮组；`type: "LINK"` 的标题 + 描述 +“打开”专门卡片是 `[UCD目标]`，live/history 都尚未实现。页签是集成方管理的临时 UI 状态，不持久化；用户点击重建后的现有 OPERATOR 按钮时，CustomEvent 行为依赖集成方监听器是否可用。

> ℹ️ history 与 live 的关键差异：OPERATOR 内容在 history 中可重建并可由用户点击，但当前只呈现普通按钮；LINK 专门卡片仍是 UCD 目标。页签状态不持久化（集成方临时 UI，不属于 conversation）。这与 Expand Panel 不同——Expand Panel 在 history 中不自动打开（`history-load` 被跳过）。

---

### 场景 18 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **OPERATOR LINK 未实现** | `type: "LINK"` 字段已声明，但 `OperatorButtons.tsx` 未区分渲染——当前均渲染为按钮 | `OperatorButtons.tsx` L14、`design.md` L69 |
| **NextAgent 职责边界** | `[已实现-主干]` NextAgent 仅渲染普通 OPERATOR 按钮并在用户点击后 `document.dispatchEvent`；`[UCD目标]` LINK 专门卡片也只能复用该边界。NextAgent 不监听、不管理页签 | `sub-window.md` |
| **页签管理是集成方职责** | 打开/切换/关闭/去重、页面嵌入（iframe/component）均由集成方实现 | `sub-window.md` |
| **触发方式** | 当前用户点击普通 OPERATOR 按钮主动触发；目标 LINK 卡片同样必须由用户点击，不得因流式到达自动打开 | `sub-window.md` |
| **页签是临时状态** | 打开/切换/关闭不持久化，history 不重建页签 | `sub-window.md` |
| **data 安全** | `data` MUST NOT 包含 credential/token | `design.md` L414 |
| **与 Expand Panel 区别** | Expand Panel 是对话区与面板**并排共存**（同时可见，NextAgent 内）；导航卡片是**全屏整页切换**（互斥可见，切到导航 tab 时看不到对话，由集成方管理） | `sub-window.md` |
| **卡片内联在气泡** | 导航卡片在对话气泡内联呈现，不在 Expand Panel 中 | `sub-window.md` |

---

## 场景 19：下载区域列表模板 [A 核心对话与任务执行]

**用户输入**：`开启节能自治`

**说明**：演示 Agent 在对话中输出可下载文件（区域列表模板），用户点击下载。来源：`05-component-specs/file-download.md`、`FileCard.tsx`、`add-ts-tool-structured-delta/design.md` L46-48。本场景为 UCD 设计规格——FILE content 当前为纯文件名字符串，无下载基础设施。

### 阶段 19.1：用户提问，Agent 响应 pending question + 文件下载卡片

用户提问"开启节能自治"，Agent 分析后反问用户"你希望在哪些区域开启节能自治?"（pending input - question kind），同时输出文件下载卡片"区域列表模板.csv"供用户下载填写。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │                                            │
│  ● 会话 A   │  > 🧑 用户                                 │
│  ▸ 会话 B   │  > 开启节能自治                             │
│             │                                            │
│             │  > 🤖 助手 · ✅ 已完成                      │
│             │  > 你希望在哪些区域开启节能自治？            │
│             │  > 可下载下方模板填写目标区域后上传。        │
│             │                                            │
│             │  ┌─ 文件下载卡片 ──────────────────────┐  │
│             │  │  📊 区域列表模板.csv        1.0 KB   │  │
│             │  │  CSV 模板，包含区域名称、区域编码列  │  │
│             │  │                          [⬇ 下载]   │  │
│             │  └──────────────────────────────────────┘  │
│             │                                            │
│             │  ┌─ Pending Input ─────────────────────┐  │
│             │  │ 你希望在哪些区域开启节能自治？        │  │
│             │  │ ○ 手动选择区域                       │  │
│             │  │ ○ 上传区域文件后指定                 │  │
│             │  │ [自定义回答...]                      │  │
│             │  │              [取消]    [提交]        │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 文件下载卡片是 FILE ToolMessageType 的扩展渲染（UCD 设计建议）。当前 FILE content 为纯文件名字符串，`FileCard.tsx` 纯展示无下载能力。UCD 建议扩展 content 为 object `{ fileName, downloadUrl, mimeType, fileSize }`，FileCard 渲染下载按钮。卡片内联在气泡中，不在 Expand Panel 中。

> ℹ️ Agent 同时输出 pending question（反问用户）和文件下载卡片（提供模板）——用户可选择下载模板填写后上传，或直接在 pending input 中回答。

---

### 阶段 19.2：用户点击下载

用户点击文件下载卡片（或 [⬇ 下载] 按钮），浏览器原生下载"区域列表模板.csv"到本地。

```
┌─ 文件下载卡片 ────────────────────────────────────┐
│  📊 区域列表模板.csv                    1.0 KB    │
│  CSV 模板，包含区域名称、区域编码列              ✓  │  ← 已下载标记
│                                        [⬇ 下载]   │
└────────────────────────────────────────────────────┘
```

> ℹ️ 下载机制：`<a href={downloadUrl} download={fileName}>`（默认）或 `Blob` + `createObjectURL`（需鉴权时）。已下载标记是 session 内临时状态，不持久化。下载完成后用户在本地填写模板。

---

### 场景 19 的历史对话浏览视图（history 模式）

history 模式下，FILE content 由持久化消息重建——**下载卡片可见**（文件名 + 大小 + [⬇ 下载] 按钮均重建）。但 downloadUrl 指向的临时文件可能已过期（`openspec/designs/architecture/attachment-lifecycle.md` cleanup 机制）。UCD 建议下载失效时显示"文件已过期"提示。

> ℹ️ history 与 live 的关键差异：下载卡片在 history 中可见；downloadUrl 指向的文件可能已清理（临时文件生命周期）。Agent 生成的模板文件（静态 URL）不会过期；诊断报告/导出数据（临时 URL）可能过期。

---

### 场景 19 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **FILE content 扩展** | content 从 string（文件名）扩展为 object `{ fileName, downloadUrl, mimeType?, fileSize? }`，向后兼容 | `file-download.md` |
| **无下载基础设施** | 前端零 `blob`/`createObjectURL`/`saveAs`，落地需新建 | `file-download.md` |
| **downloadUrl 安全** | MUST NOT 含 credential/token；需鉴权时用短期签名 URL 或 Blob 方式 | `file-download.md` |
| **可信域名校验** | downloadUrl MUST 指向可信域名，防开放重定向 | `file-download.md` |
| **卡片内联在气泡** | 文件下载卡片在对话气泡内联呈现，不在 Expand Panel 中 | `file-download.md` |
| **与导航卡片区别** | 文件下载是浏览器原生下载；导航卡片（场景 18）通知集成方打开外部页签 | `file-download.md`、`sub-window.md` |
| **history 文件过期** | 临时文件可能已清理，下载失效时建议显示"文件已过期" | `openspec/designs/architecture/attachment-lifecycle.md` |

---

## 场景 20：在扩展面板中审核修改节能配置 [A 核心对话与任务执行]

**用户输入**：`开启上述文件中区域的节能特性`（用户已上传"意图生效区域.csv"）

**说明**：演示 Agent 解析上传文件后在扩展面板中打开配置审核 PIU，用户审核修改后保存，配置反馈到对话。来源：`05-component-specs/expand-panel.md`（交互式 PIU 保存→对话反馈）、`PiuMessage.tsx` L28-41。本场景是 `[UCD目标/Clarify]`：`PiuMessage` 当前无 save 回调，`onPiuSubmit` 只是占位名称，尚未形成可实施契约。

### 阶段 20.1：用户上传文件并引用

用户在 composer 上传"意图生效区域.csv"（附件上传，见场景 4），并输入"开启上述文件中区域的节能特性"。

> ℹ️ **附件当前边界**：`[已实现-主干]` staged composer 的 effective file config 可配置支持 CSV；默认 allowlist 仍为 Markdown-only，因此本场景要求部署配置显式允许 CSV。提交后 request context 只携带安全 metadata/引用，模型通过受控的逻辑 `Read` path 按需读取内容，文件正文不会直接投影进 prompt。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │                                            │
│  ● 会话 A   │  > 🧑 用户                                 │
│  ▸ 会话 B   │  > 开启上述文件中区域的节能特性             │
│             │    📎 意图生效区域.csv (已就绪)             │
│             │                                            │
│             │  > 🤖 助手 · 🔄 执行中                      │
│             │  > 💭 #1 正在解析区域文件...                │
│             │  📋 过程面板 ▶ 执行中                       │
│             │    └ 🔧 regionParser 🔄 解析 CSV...         │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [⏹停止]  │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

### 阶段 20.2：Agent 解析文件，扩展面板打开配置审核 PIU

Agent 解析 CSV 提取区域列表，推送 `EXPAND_PANEL` 事件（`toolMessageType: "PIU"`，`piuName: "energy-config-review"`），扩展面板自动打开配置审核 PIU。对话区收到左侧 484px。

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区（484px 收到左侧）  │  Expand Panel（配置审核 PIU）  │
│             │                            │  [× Close]                     │
│  ● 会话 A   │  > 🧑 用户                ├────────────────────────────────┤
│  ▸ 会话 B   │  > 开启上述文件中区域...   │  节能自治配置                  │
│             │                            │                                │
│             │  > 🤖 助手 · ✅ 已完成      │  区域列表（从文件解析）：       │
│             │  > 已解析 3 个区域，请      │  ☑ 华东-上海-陆家嘴            │
│             │  > 在右侧面板审核配置。    │  ☑ 华东-杭州-西湖              │
│             │                            │  ☑ 华北-北京-海淀              │
│             │  > [PIU: energy-config-   │                                │
│             │  >  review@1.0（等待宿主   │  节能参数：                    │
│             │  >  渲染）]                │  ├ 峰值时段：08:00 - 22:00     │
│             │                            │  ├ 节能模式：智能调度          │
│             │  📋 过程面板 ▶ 已完成       │  └ 温度阈值：26°C              │
│             │    └ 🔧 regionParser ✅     │                                │
│             │                            │  预估节能率：12%               │
│             │  ┌─ Composer ──────────┐  │                                │
│             │  │ [📎] 输入…  [发送]   │  │  [取消]        [保存并提交]    │
│             │  └──────────────────────┘  │                                │
└──────────────────────────────────────────────────────────────────────────┘
```

> ℹ️ PIU 组件当前通过 `window.Prel.autoLoad("energy-config-review", "1.0")` 加载，`piu.emit("render", { data, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId })` 只传面板宿主字段。`onPiuSubmit` 是 `[UCD目标/Clarify]` 的占位名称，当前未实现。

---

### 阶段 20.3：用户审核修改配置

用户在扩展面板中审核配置：可勾选/取消区域、修改节能参数。PIU 组件是交互式的——支持表单编辑。

---

### 阶段 20.4：用户点击保存，配置反馈到对话

`[UCD目标/Clarify]` 用户点击 [保存并提交] 后，PIU 组件通过待定义的受控 submit contract（暂称 `onPiuSubmit(configData)`）把数据交给 shared composer/request owner，由既有 request lifecycle 创建新 turn；Agent 处理后展示策略摘要并发起 confirmation pending input"是否执行?"。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │                                            │
│  ● 会话 A   │  > 🤖 助手 · ✅ 已完成                      │
│  ▸ 会话 B   │  > ## 节能自治策略已生成                    │
│             │  > 已为你生成以下节能自治策略：              │
│             │  > - 适用区域：华东-上海-陆家嘴、华东-杭州-  │
│             │  >   西湖（已取消华北-北京-海淀）            │
│             │  > - 峰值时段：08:00 - 22:00               │
│             │  > - 节能模式：智能调度                     │
│             │  > - 预估节能率：12%                        │
│             │  > - 预计生效时间：即时                     │
│             │                                            │
│             │  ┌─ Pending Input ─────────────────────┐  │
│             │  │ 是否执行该节能策略？                  │  │
│             │  │              [否]    [是]            │  │
│             │  └──────────────────────────────────────┘  │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [发送]    │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> ⚠️ **当前缺口**：`PiuMessage.tsx` 的 `piu.emit()` 仅传递面板宿主字段，无 submit 回调。`onPiuSubmit` 只是 UCD 暂定名称；落地前必须由 shared composer/request owner 明确受控 submit 契约，复用既有 request lifecycle 与可信 scope，不能直接复用 host-only `sendQuestionToLui` 或前端私有 helper。PIU 提交不直接修改后端状态——数据反馈到对话，由 Agent 处理。

---

### 场景 20 的历史对话浏览视图（history 模式）

history 模式下，`EXPAND_PANEL` 事件带 `history-load` transport hint，stream watcher 跳过——**扩展面板不自动打开**。用户看到 PIU 占位符和策略摘要（持久化消息重建）。交互式审核/保存不重建（临时 UI 状态）。

> ℹ️ history 与 live 的关键差异：扩展面板不自动打开（history-load 跳过）；PIU 占位符和策略摘要可见（持久化重建）；交互式审核/保存不重建。用户若需重新审核配置，需重新触发 Agent（如重新提问）。

---

### 场景 20 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **PiuMessage 无 save 回调** | `piu.emit()` 仅传 `handleExpandPanelOpen/Close`/`expandPanelId`，无 `onPiuSubmit` | `PiuMessage.tsx` L28-41 |
| **onPiuSubmit `[Clarify]`** | 暂定名称；必须由 shared composer/request owner 定义并复用既有 request lifecycle，不得路由到私有 `injectQuestion` helper 或 host-only bridge | `expand-panel.md` 交互式 PIU 保存章节 |
| **PIU 提交不直接改后端** | 数据反馈到对话，由 Agent 处理后决定是否执行 | `expand-panel.md` |
| **CSV intake 配置** | staged composer 配置后可接收 CSV；默认 allowlist 仍为 Markdown-only | `add-ts-remote-file-upload`；effective file config |
| **附件读取路径** | request context 只携带安全 metadata/引用；模型通过逻辑 `Read` path 按需读取正文，不直接投影正文 | `request-attachments`；`add-ts-remote-file-upload` |
| **history 不自动打开面板** | `history-load` 事件被跳过，PIU 占位符可见但面板不打开 | `useExpandPanelStreamWatcher.ts` L31-33 |
| **与旅程 20 区别** | 旅程 20 是只读展示（地图）；本场景是交互式审核+保存反馈 | `expand-panel.md` |

---

## 场景 21：开启节能自治——端到端复合场景 [A 核心对话与任务执行]

**用户输入**：`开启节能自治`（首轮）→ `开启上述文件中区域的节能特性`（次轮）→ `需要`（确认执行）

**说明**：串联 7+ 交互步骤的完整端到端用例，引用场景 3/4/17/19/20/9。覆盖 pending input → 文件下载 → 附件上传 → 文件引用 → 扩展面板配置审核 → PIU 保存反馈 → confirmation → 长时任务 → fork 引导的完整链路。

### 阶段 21.1：用户提问 → pending question + 文件下载卡片

用户输入"开启节能自治"，Agent 反问"你希望在哪些区域开启节能自治?"（pending input - question，引用场景 3）同时输出文件下载卡片"区域列表模板.csv"（引用场景 19）。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │  > 🧑 用户：开启节能自治                    │
│  ● 会话 A   │                                            │
│  ▸ 会话 B   │  > 🤖 助手 · ✅ 已完成                      │
│             │  > 你希望在哪些区域开启节能自治？            │
│             │  > 可下载下方模板填写目标区域后上传。        │
│             │                                            │
│             │  ┌─ 文件下载卡片 ──────────────────────┐  │
│             │  │  📊 区域列表模板.csv        1.0 KB   │  │
│             │  │                          [⬇ 下载]   │  │
│             │  └──────────────────────────────────────┘  │
│             │                                            │
│             │  ┌─ Pending Input ─────────────────────┐  │
│             │  │ 你希望在哪些区域开启节能自治？        │  │
│             │  │ ○ 上传区域文件后指定                 │  │
│             │  │              [取消]    [提交]        │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 引用场景 3（pending input - question）+ 场景 19（文件下载）。用户选择"上传区域文件后指定"并提交 pending input。

---

### 阶段 21.2：用户下载模板、填写、上传

用户下载"区域列表模板.csv"（引用场景 19），本地填写区域信息，保存为"意图生效区域.csv"。用户点击 composer 的 📎 按钮选择文件，文件上传后在 composer 中显示附件 chip（文件名 + 已就绪 + 移除按钮），输入消息后点击 [发送]（引用场景 4）。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │  > 🧑 用户：开启节能自治                    │
│  ● 会话 A   │  > 🤖 助手 · ✅ 已完成                      │
│  ▸ 会话 B   │  > 你希望在哪些区域开启节能自治？            │
│             │  > 可下载下方模板填写目标区域后上传。        │
│             │                                            │
│             │  ┌─ 文件下载卡片 ──────────────────────┐  │
│             │  │  📊 区域列表模板.csv        1.0 KB   │  │
│             │  │                          [⬇ 下载]   │  │
│             │  └──────────────────────────────────────┘  │
│             │                                            │
│             │  ┌─ Composer（文件已上传）──────────────┐  │
│             │  │ 📎 意图生效区域.csv (已就绪)  [×]     │  │
│             │  │ 输入消息…                    [发送]    │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
  ↑ 用户通过 composer 📎 按钮选择本地填写后的 CSV 文件。
    文件上传完成后在 composer 中显示附件 chip（文件名 + 已就绪 + [×] 移除）。
    用户输入"开启上述文件中区域的节能特性"后点击 [发送]。
```

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │  > 🧑 用户                                 │
│  ● 会话 A   │  > 开启上述文件中区域的节能特性             │
│  ▸ 会话 B   │    📎 意图生效区域.csv                     │
│             │                                            │
│             │  > 🤖 助手 · 🔄 执行中                      │
│             │  > 正在解析文件中的区域信息...              │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [发送]    │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
  ↑ 消息发送后，用户消息气泡显示文本 + 附件指示（📎 文件名）。
    Agent 开始解析 CSV 文件内容。
```

> ℹ️ `[已实现-主干]` staged composer 配置后可接收 CSV，默认 allowlist 仍为 Markdown-only；本场景以部署配置已显式允许 CSV 为前提。提交后只把安全 metadata/引用带入 request context，Agent 通过逻辑 `Read` path 按需读取文件正文。

---

### 阶段 21.3：Agent 解析文件 → 扩展面板打开配置审核 PIU

Agent 解析 CSV 提取区域，推送 `EXPAND_PANEL` 事件打开配置审核 PIU（引用场景 17 + 场景 20）。用户在扩展面板中审核修改配置。

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区（484px 收到左侧）  │  Expand Panel（配置审核 PIU）  │
│             │  > 🧑 用户                │  节能自治配置          [×]    │
│  ● 会话 A   │  > 开启上述文件中区域...   ├────────────────────────────────┤
│  ▸ 会话 B   │                            │  区域列表（从文件解析）：       │
│             │  > 🤖 助手 · ✅ 已完成      │  ☑ 华东-上海-陆家嘴            │
│             │  > 已解析 3 个区域，请      │  ☑ 华东-杭州-西湖              │
│             │  > 在右侧审核配置。        │  ☑ 华北-北京-海淀              │
│             │                            │  节能参数：                    │
│             │  > [PIU: energy-config-   │  ├ 峰值时段：08:00-22:00       │
│             │  >  review@1.0]            │  ├ 节能模式：智能调度          │
│             │                            │  └ 温度阈值：26°C              │
│             │                            │  [取消]      [保存并提交]      │
└──────────────────────────────────────────────────────────────────────────┘
```

> ℹ️ 引用场景 17（扩展面板 PIU）+ 场景 20（交互式 PIU 审核）。用户取消勾选"华北-北京-海淀"，修改温度阈值为 28°C，点击 [保存并提交]。

---

### 阶段 21.4：PIU 保存 → 对话显示策略摘要 → confirmation

`[UCD目标/Clarify]` PIU 通过待定义的受控 submit contract（暂称 `onPiuSubmit(configData)`）把配置交给 shared composer/request owner，由既有 request lifecycle 创建新 turn。Agent 处理后展示策略摘要，并发起 confirmation pending input"是否执行?"（引用场景 3）。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │  > 🤖 助手 · ✅ 已完成                      │
│  ● 会话 A   │  > ## 节能自治策略已生成                    │
│  ▸ 会话 B   │  > - 适用区域：华东-上海-陆家嘴、华东-杭州   │
│             │  >   -西湖（已取消华北-北京-海淀）           │
│             │  > - 峰值时段：08:00 - 22:00               │
│             │  > - 节能模式：智能调度                     │
│             │  > - 温度阈值：28°C                        │
│             │  > - 预估节能率：12%                        │
│             │                                            │
│             │  ┌─ Pending Input ─────────────────────┐  │
│             │  │ 是否执行该节能策略？                  │  │
│             │  │              [否]    [是]            │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 引用场景 20（PIU 保存反馈）+ 场景 3（pending input - confirmation）。用户点击 [是]。

---

### 阶段 21.5：用户确认 → Agent 执行 → 进入 long-running

用户点击 [是]（"需要"），Agent 开始执行节能策略任务。任务耗时较长，超过 10 秒阈值后进入 long-running 态（引用场景 9）。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │  > 🤖 助手 · 🔄 执行中                      │
│  ● 会话 A   │  > 正在执行节能自治策略...                  │
│  ▸ 会话 B   │                                            │
│             │  ┌─ 能力卡片 ─────────────────────────┐    │
│             │  │ 🔧 energyPolicyApply 🔄 已 45 秒    │    │
│             │  │ 智能调度策略下发中...                │    │
│             │  │                [⏹ 取消]             │    │
│             │  └──────────────────────────────────────┘    │
│             │                                            │
│             │  ┌─ fork 引导提示（inline）──────────────┐  │
│             │  │ 💡 "energyPolicyApply" 仍在执行        │  │
│             │  │ （已 45 秒）。直接发送会终止它。       │  │
│             │  │ 想保留任务并基于历史继续？             │  │
│             │  │              [在新分支继续 →]    [×]   │  │
│             │  └──────────────────────────────────────┘  │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [发送]    │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 引用场景 9（长时运行 + fork-to-continue 引导）。能力卡片进入 long-running 扩展态（计时器 + 取消入口）。composer 上方出现 fork 引导提示（引用 `capability-card.md` fork-to-continue CTA + `composer.md` 长时任务 fork 引导）。

---

### 阶段 21.6：fork-to-continue 引导

用户看到 fork 引导提示，可选择：
- **[在新分支继续 →]**：fork 到子会话，长时任务在原会话继续，用户在新分支继续对话（引用旅程 14 第 7 步）
- **[×]**：关闭提示，继续等待或直接发送（supersede 终止长时任务）
- **直接发送**：supersede 正常进行，引导不阻断

> ℹ️ 引用场景 9 阶段 9.2c（fork-to-continue 引导）。fork anchor 选择：从当前 active run 往前找最近 COMPLETED ASSISTANT turn（策略摘要 turn 已完成）。

---

### 场景 21 的历史对话浏览视图（history 模式）

history 模式下，复合场景的各步骤持久化内容均重建：
- ✅ 用户消息（"开启节能自治"/"开启上述文件中区域..."/"需要"）
- ✅ 助手消息（pending question / 策略摘要 / 执行结果）
- ✅ 文件下载卡片（FILE content 重建，downloadUrl 可能过期）
- ✅ 附件指示（持久化 metadata）
- ✅ PIU 占位符（EXPAND_PANEL 事件重建，面板不自动打开）
- ✅ pending input 终态卡片（已应答/已确认）
- ✅ 能力卡片终态（执行完成/失败/取消）
- ❌ 扩展面板配置审核 UI（临时状态，不重建）
- ❌ fork 引导提示（临时状态，不重建）
- ❌ 长时运行计时器（transient streaming UI）

---

### 场景 21 的关键约束

| 约束 | 说明 | 来源 | 引用场景 |
|---|---|---|---|
| **步骤引用** | 21.1→场景 3+19, 21.2→场景 4, 21.3→场景 17+20, 21.4→场景 20+3, 21.5→场景 9, 21.6→场景 9 | — | 3/4/9/17/19/20 |
| **CSV intake 配置** | staged composer 配置后可接收 CSV；默认 allowlist 仍为 Markdown-only | `add-ts-remote-file-upload`；effective file config | 21.2 |
| **附件读取路径** | request context 只携带安全 metadata/引用；模型通过逻辑 `Read` path 按需读取正文 | `request-attachments`；`add-ts-remote-file-upload` | 21.2-21.3 |
| **FILE content 扩展** | 文件下载卡片需 FILE content 扩展为 object | `file-download.md` | 21.1 |
| **PIU 无 save 回调** | `onPiuSubmit` 为 `[UCD目标/Clarify]` 占位名称；当前未实现，且不得路由到私有 `injectQuestion` | `PiuMessage.tsx` L28-41 | 21.4 |
| **PIU submit owner** | 必须交给 shared composer/request owner 并复用既有 request lifecycle | `expand-panel.md` | 21.4 |
| **PIU 提交不直接改后端** | 配置数据反馈到对话，由 Agent 处理 | `expand-panel.md` | 21.4 |
| **history 不重建临时 UI** | 扩展面板配置审核/fork 引导/计时器不重建 | `expand-panel.md`/`capability-card.md` | history 视图 |
| **fork anchor** | 从 active run 往前找最近 COMPLETED ASSISTANT turn | `message-bubble.md` forkAnchor | 21.6 |

---

## 场景 22：后台分离执行与任务追踪 [B 长时任务与并行工作流]

**用户输入**：`启动开发服务器`

**说明**：演示**后台分离执行模式**——任务结果不参与对话上下文的长时任务执行。Agent 通过工具启动长时间运行的后台命令，能力调用立即返回句柄（而非等待命令完成），turn 不阻塞、模型不等待结果。用户在能力卡片的内联追踪区独立查看任务状态和输出。

**与场景 9（长时运行）的核心区别**——任务结果是否参与后续上下文：

| 维度 | 场景 9：长时运行（内联耦合） | 场景 22：后台分离（解耦） |
|---|---|---|
| 任务结果 | 进入模型上下文（`CAPABILITY_RESULT_DELTA` 携带 `safeResult`） | **不进入模型上下文**（返回 `backgroundHandle`，实际输出不回传模型） |
| 模型行为 | 阻塞等待结果，同一 turn 内完成 | **不阻塞**，turn 立即完成，模型可继续对话 |
| 能力调用状态 | 未返回（long-running 扩展态） | **已返回**（终态），后台进程独立运行 |
| 用户观测 | 过程面板 + 能力卡片 long-running 态 | `[已实现-主干]` `⚡` header monitor；能力卡片内联追踪区是 `[UCD目标]` |

当前唯一实例为 Bash 工具的 `run_in_background: true`（或前台超时自动转后台）。能力调用返回句柄后进入终态；`[已实现-主干]` 由 header `⚡` 承载观测/终止能力，能力卡片内联追踪区是复用同一 task snapshot 的 `[UCD目标]`。

### 阶段 22.1：Agent 启动后台命令

用户请求启动开发服务器，Agent 调用 Bash 工具设置 `run_in_background: true`——这是后台分离执行模式的当前实例。能力调用立即返回 `backgroundHandle`（turn 不阻塞、结果不进入上下文），卡片显示完成并进入终态，卡片底部内联后台任务追踪区显示 RUNNING 状态。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                              ⚡ ¹  │
│             │                                            │
│  ● 会话 A   │  > 🧑 用户                                 │
│  ▸ 会话 B   │  > 启动开发服务器                           │
│             │                                            │
│             │  > 🤖 助手 · ✅ 已完成                      │
│             │  > 好的，我已为你启动开发服务器。            │
│             │                                            │
│             │  📋 过程面板 ▶ 已完成                       │
│             │    └ 🔧 Bash ✅ 后台任务已启动               │
│             │      ▼ ⏳ npm run dev    [processing] 2m    │
│             │        npm run dev --port 3000     [Kill]  │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [发送]    │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 上图的能力卡片内联追踪区是 `[UCD目标]`。`[已实现-主干]` 对话区 header `⚡` 在 session mount 时做一次 REST seed，随后由 `BACKGROUND_TASK_*` session stream 实时更新；Kill 以 local override 立即反映，stdout/stderr 仍按展开/手动刷新读取。候选内联区不得建立第二条轮询链。

---

### 阶段 22.2：用户展开查看 stdout/stderr

用户点击追踪区展开，加载 stdout/stderr 输出（各限 65536 字节）。

```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  后台任务已启动（EXPLICIT）                          │
│                                                    │
│  ▼ ⏳ npm run dev              [processing] 2m     │
│    npm run dev --port 3000                         │
│  stdout                              [↻ 刷新]      │
│  ┌──────────────────────────────────────────────┐ │
│  │ > next dev@14.2.3                             │ │
│  │ - Local: http://localhost:3000                │ │
│  │ - Network: http://192.168.1.10:3000           │ │
│  │ ✓ Ready in 1.2s                               │ │
│  │ ○ Compiling / ...                             │ │
│  └──────────────────────────────────────────────┘ │
│  stderr                                            │
│  ┌──────────────────────────────────────────────┐ │
│  │ (空)                                         │ │
│  └──────────────────────────────────────────────┘ │
│                              [Kill]                │
└────────────────────────────────────────────────────┘
```

> ℹ️ 输出通过 `<pre>` 块渲染，monospace 12px，maxHeight 200px，可滚动。[↻ 刷新] 按钮重新加载输出。

---

### 阶段 22.3：用户 Kill 后台任务

用户点击 Kill 按钮，Popconfirm 确认后发送 SIGTERM。

```
┌─ 追踪区 ──────────────────────────────────────────┐
│  ▼ ⏳ npm run dev              [processing] 3m     │
│    npm run dev --port 3000                         │
│  ┌──────────────────────────────────────────────┐ │
│  │  ⚠️ 确认终止该后台任务？          [取消] [终止] │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
         ↓ 用户点击 [终止]
┌─ 追踪区（Kill 后）────────────────────────────────┐
│  ▶ ⏹️ npm run dev              [default] 3m12s    │
│    npm run dev --port 3000                         │
│    退出码：null（SIGTERM 终止）                    │
└────────────────────────────────────────────────────┘
```

> ℹ️ Kill 后用 local override 立即变为 KILLED（当前 kill 不发对应 stream event），Kill 按钮消失；随后输出可按需刷新。

---

### 场景 22 的历史对话浏览视图（history 模式）

history 模式下切换会话时，header monitor 对该 session 做一次 REST seed 并接入其 session stream；历史会话任务通常已终态，输出引用可能已过期。下方能力卡片内联形态仍是 `[UCD目标]`。

```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  后台任务已启动（EXPLICIT）                          │
│                                                    │
│  ▶ ✅ npm run dev              [success] 5m30s     │
│    npm run dev --port 3000    exit 0               │
└────────────────────────────────────────────────────┘
```

> ℹ️ history 模式下无 RUNNING 任务，Kill 按钮不显示。输出可展开查看（若后端存储仍可用）。

---

### 场景 22 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **结果不参与上下文** | backgroundHandle 返回后，实际任务输出不回传模型上下文，模型 turn 不阻塞——这是后台分离执行模式的核心特征 | 后台分离执行模式定义 |
| **当前仅 Bash 工具支持** | `run_in_background: true` 或前台超时自动转后台；后台分离是通用模式，未来其他长时能力可复用 | `bash-tool.ts` L120-161 |
| **追踪区触发条件** | safeResult 为 `bashBackgroundOutputSchema` 形状（含 `taskId` + `backgroundReason`，文档中用概念术语 `backgroundHandle` 指代） | `bash-schemas.ts` `bashBackgroundOutputSchema` |
| **Kill 仅 RUNNING** | 只有 RUNNING 状态显示 Kill 按钮 | capability-card 追踪区设计 |
| **SIGTERM 终止** | Kill 发送 SIGTERM，非 SIGKILL | `backgroundTaskService.ts` killTask |
| **输出限制 65536 字节** | stdout/stderr 各最多 65536 字节，超出截断显示 `…` | `OUTPUT_LIMIT_BYTES` |
| **状态同步** | session mount 一次 REST seed + `BACKGROUND_TASK_*` canonical stream live update；Kill 用 local override | `BackgroundTaskMonitorPanel.tsx` |
| **不进入消息卡片** | stream event 更新 header task snapshot，但不生成 ProcessPanel message entry | `stream-envelope.ts`；monitor component |
| **`backgroundExecutionEnabled` 门控** | 未启用时 `run_in_background: true` 报错 | `bash-tool.ts` L121-124 |
| **无自动续跑** | `[已实现-主干]` 自然完成与 Kill 都只更新任务终态/timeline，不提交 continuation run，也不把 stdout/stderr 自动送回 Agent；用户通过 monitor 与按需 output REST 查看结果 | `background-completion.ts`、`channel-composition.ts` |
| **`⚡` header 快速查找入口** | 会话存在后台任务时对话区 header 显示 `⚡` + running count badge，点击展开下拉面板列出本会话所有后台任务；无任务时隐藏（`tasks.length === 0` → `return null`） | `BackgroundTaskMonitorPanel.tsx` L140-142 |

---

## 场景 23：创建和管理 Cron 定时任务 [A 核心对话与任务执行]

**用户输入**：`每天早上 9 点检查网络拓扑并报告异常`

**说明**：演示 Agent 通过 Cron 工具创建/列出/删除定时任务。来源：`05-component-specs/cron-task.md`、`packages/agent-capability/src/builtins/cron/cron-tool.ts`、共享安全投影、`safeCapabilityResult.ts` 与 `processDetails.ts`。后端 `safeResult.kind = "cron"`、前端 parser 和本地化 formatter 均已进入主干，对应 active change 待归档。

### 阶段 23.1：用户请求创建定时任务

用户请求每天 9 点检查网络拓扑，Agent 调用 Cron 工具 `action=create`。

```
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│             │                                            │
│  ● 会话 A   │  > 🧑 用户                                 │
│  ▸ 会话 B   │  > 每天早上 9 点检查网络拓扑并报告异常      │
│             │                                            │
│             │  > 🤖 助手 · 🔄 执行中                      │
│             │  📋 过程面板 ▶ 执行中                       │
│             │    └ 🔧 Cron 🔄 创建定时任务...              │
│             │                                            │
│             │  ┌─ Composer ──────────────────────────┐  │
│             │  │ [📎] 输入消息…              [⏹停止]  │  │
│             │  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

### 阶段 23.2：定时任务创建完成

Cron 工具执行完成，后端投影生成 `safeResult.kind = "cron"`（含 `id`、`humanSchedule`、`recurring`）。

**当前实际呈现**（主干已实现专门 formatter，active change 待归档）：

```
┌──────────────────────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                                    │
│  > 好的，我已创建定时任务。每天 09:00 会自动检查网络拓扑。 │
│                                                          │
│  📋 过程面板 ▶ 已完成                                     │
│    └ 🔧 Cron ✅                                           │
│        展开后显示：任务 ID、调度计划、是否循环            │
└──────────────────────────────────────────────────────────┘
```

**当前结构详情示意**：

```
┌──────────────────────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                                    │
│  > 好的，我已创建定时任务。每天 09:00 会自动检查网络拓扑。 │
│                                                          │
│  📋 过程面板 ▶ 已完成                                     │
│    └ 🔧 Cron ✅                                           │
│      ┌──────────────────────────────────────────┐       │
│      │ ⏰ 定时任务已创建                          │       │
│      │ 任务 ID：cron-abc123                      │       │
│      │ 调度计划：Every day at 09:00              │       │
│      │ 循环：✅ 是                                │       │
│      │ cron 表达式：0 9 * * *                    │       │
│      └──────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 前端只消费 `safeResult` 中批准的 action、任务 ID、human schedule、recurring、delay 或有界 jobs；不得从原始 Tool result 补建 prompt 或其他字段。

---

### 阶段 23.3：用户请求列出定时任务

用户问"我有哪些定时任务"，Agent 调用 Cron 工具 `action=list`（按 session scope 查询，仅当前会话的任务）。卡片底部 CTA 可跳转 `⏰` 管理面板查看所有会话的定时任务。

```
┌──────────────────────────────────────────────────────────┐
│  > 🧑 用户                                                │
│  > 我有哪些定时任务？                                     │
│                                                          │
│  > 🤖 助手 · ✅ 已完成                                    │
│  > 你当前会话有 2 个定时任务：                            │
│                                                          │
│  📋 过程面板 ▶ 已完成                                     │
│    └ 🔧 Cron ✅                                           │
│      Found 2 Cron tasks.                                 │
│      ┌──────────────────────────────────────────┐       │
│      │ 📋 当前会话有 2 个定时任务                 │       │
│      │ ┌────────────────────────────────────┐   │       │
│      │ │ cron-abc123  Every day at 09:00    │   │       │
│      │ │ 0 9 * * *            [循环]        │   │       │
│      │ ├────────────────────────────────────┤   │       │
│      │ │ cron-def456  Every 5 minutes       │   │       │
│      │ │ */5 * * * *                        │   │       │
│      │ └────────────────────────────────────┘   │       │
│      │ （最多显示 50 条，超出截断）              │       │
│      │       [⏰ 查看所有会话的定时任务 →]       │       │
│      └──────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ Cron Tool list 按 session scope 查询，最多 50 条；前端已消费 `cron` kind 并本地化呈现安全结构详情。独立 Cron Dashboard 已实现，但 Tool 卡片内直接 CTA 仍未接通。

---

### 阶段 23.4：用户请求删除定时任务

用户说"删除每 5 分钟的那个任务"，Agent 调用 Cron 工具 `action=delete`。

```
┌──────────────────────────────────────────────────────────┐
│  > 🧑 用户                                                │
│  > 删除每 5 分钟的那个任务                                │
│                                                          │
│  > 🤖 助手 · ✅ 已完成                                    │
│  > 已删除定时任务 cron-def456。                           │
│                                                          │
│  📋 过程面板 ▶ 已完成                                     │
│    └ 🔧 Cron ✅                                           │
│      ┌──────────────────────────────────────────┐       │
│      │ 🗑️ 定时任务已删除                          │       │
│      │ 任务 ID：cron-def456                      │       │
│      └──────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ delete 投影生成 `safeResult: { kind: "cron", action: "delete", id: "cron-def456" }`，safeSummary "Cron task was deleted."。

---

### 阶段 23.5：用户通过 Cron Dashboard 管理任务 `[已实现-主干]`

用户从 sidebar 进入独立 route。Dashboard 提供“任务”和“执行记录”两个 Tab，使用 Web public API 管理当前 trusted owner + active Agent scope 下的任务；23.3/23.4 的 Cron Tool list 仍按 session scope 工作。

```
侧边栏 ⏰ 入口 + 管理面板 modal：
┌──────────────────────────────────────────────────────────┐
│  [会话列表]  │  对话区                                    │
│  ● 会话 A   │  > 🧑 用户                                 │
│  ▸ 会话 B   │  > 每天早上 9 点检查网络拓扑并报告异常      │
│             │  > 🤖 助手 · ✅ 已完成                      │
│ [⏰ 2]      │                                            │
│             │         ┌─ ⏰ 定时任务管理 ────── [×] ─┐  │
│             │         │ 当前 Agent：network-ops-agent │  │
│             │         │               （跨会话）[↻刷新]│  │
│             │         ├──────────────────────────────┤  │
│             │         │ 任务ID     调度计划  来源 操作│  │
│             │         │ ┌──────────────────────────┐ │  │
│             │         │ │cron-abc123 Every day 09:00│ │  │
│             │         │ │0 9 * * *    会话A ✅ [🗑] │ │  │
│             │         │ ├──────────────────────────┤ │  │
│             │         │ │cron-def456  Every 5 min   │ │  │
│             │         │ │*/5 * * * *  会话B ✅ [🗑] │ │  │
│             │         │ └──────────────────────────┘ │  │
│             │         │ 共 2 个任务          [关闭]  │  │
│             │         └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
  ↑ ⏰ 入口在侧边栏导航按钮区（OperatorsArea 下方），badge 显示当前 agent 任务数。
    管理面板按 agent 级查询（跨会话），列出当前 agent 下所有会话创建的 cron 任务。
```

用户点击 `cron-def456` 行的 [🗑] 按钮，Popconfirm 确认后删除：

```
┌─ 删除确认 ──────────────────────────────────┐
│  ⚠️ 确认删除定时任务 cron-def456？            │
│  调度计划：Every 5 minutes                    │
│                          [取消]    [删除]     │
└──────────────────────────────────────────────┘
         ↓ 用户点击 [删除]
┌─ 管理面板（删除后）──────────────────────────┐
│  任务ID     调度计划            循环  操作    │
│  ┌──────────────────────────────────────────┐│
│  │cron-abc123 Every day at 09:00  ✅   [🗑] ││
│  │0 9 * * *                                 ││
│  └──────────────────────────────────────────┘│
│  共 1 个任务                        [关闭]    │
└──────────────────────────────────────────────┘
```

> 当前实现支持手动创建、修改、删除、启停、立即执行和执行记录筛选/详情。图中的旧 modal 排版仅作历史示意，当前页面形态以 `agent-web-cron-task-dashboard` stable spec 为准。

---

### 场景 23 的历史对话浏览视图（history 模式）

history 模式下，Cron 能力卡片由持久化消息重建，并使用与 settled live 相同的 `cron` parser/formatter；不重演 running 动画。

```
┌──────────────────────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                                    │
│  > 好的，我已创建定时任务。每天 09:00 会自动检查网络拓扑。 │
│                                                          │
│  📋 过程面板 ▶ 已完成                                     │
│    └ 🔧 Cron ✅                                           │
│        展开后显示：任务 ID、调度计划、是否循环            │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ history 模式下 Cron 能力卡片从持久化结果重建，并使用与 settled live 相同的 parser/formatter；不重演 running 动画。

---

### 场景 23 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **5 字段 cron 表达式** | `minute hour day-of-month month day-of-week`，进程本地时区 | `cron-tool.ts` L16-17 |
| **recurring 默认 true** | 未指定时为循环任务；`recurring=false` 为单次提醒 | `cron-tool.ts` L74 |
| **NON_IDEMPOTENT** | 创建和删除不可重放 | `cron-tool.ts` L23 |
| **scope 隔离** | Cron Tool list 按 session scope；Dashboard API 只按 trusted owner + active Agent scope，客户端不得覆盖 | Cron Tool 与 `cron-task-management-api` |
| **list 最多 50 条** | 投影层截断，`truncated: true` 标记 | `stream-envelope.ts` L493 |
| **后端投影已实现** | `projectCronSafeResult` 生成 `kind: "cron"` | `stream-envelope.ts` L400-401、L458-510 |
| **前端 cron kind 已消费** | `SafeCapabilityResult`、fail-closed parser 和 create/delete/list formatter 已实现 | `safeCapabilityResult.ts`、`processDetails.ts` 与对应前端测试 |
| **Cron Dashboard `[已实现-主干]`** | sidebar route、任务/执行记录 Tab、管理操作与安全详情已交付；结果会话跳转仍不在本能力内 | `agent-web-cron-task-dashboard` stable spec |
| **prompt 长度限制** | `CRON_PROMPT_MAX_LENGTH` | `cron-schemas.ts` |
| **避免 :00/:30 分钟** | 分散集群负载 | `cron-tool.ts` L18 |

---

## 场景 24：上下文压缩——长对话中的上下文窗口管理 [E 交互输入与上下文]

**说明**：演示长对话中上下文窗口接近限制时触发压缩的完整体验。mock server 在正常路径每次发送压缩事件（场景 1 阶段 1.3），但真实后端仅在上下文窗口接近限制时触发。本场景为**契约层期望渲染**，展示真实触发条件下的用户体验。

### 阶段 24.1：长对话累积——多轮对话后上下文接近窗口限制

用户已进行 5 轮网络诊断对话，上下文持续增长。每个 turn 包含思考、能力调用和长回复，上下文窗口已接近限制。

```
┌─ 对话区（Turn 1-5 概览）──────────────────────────────┐
│                                                        │
│  Turn 1: 网络健康诊断                                   │
│    🧑 用户：网络健康诊断                                 │
│    🤖 助手 · ✅ 已完成                                  │
│    📋 过程面板 ▶ 已完成（💭✅ → 🔧✅）                  │
│    [长回复：诊断摘要 + 关键发现表 + 处置建议]            │
│                                                        │
│  Turn 2: Edge-RTR-02 丢包排查                          │
│    🧑 用户：排查 Edge-RTR-02 丢包问题                   │
│    🤖 助手 · ✅ 已完成                                  │
│    📋 过程面板 ▶ 已完成（💭✅ → 🔧✅ → 🔧✅ → 💭✅）    │
│    [长回复：根因分析 + 证据链表]                         │
│                                                        │
│  Turn 3: 查询告警历史                                   │
│    🧑 用户：过去 24 小时有哪些告警                      │
│    🤖 助手 · ✅ 已完成                                  │
│    📋 过程面板 ▶ 已完成（💭✅ → 🔧✅）                  │
│    [长回复：告警列表 + 分类统计]                         │
│                                                        │
│  Turn 4: Core-SW-01 邻居拓扑                           │
│    🧑 用户：探测 Core-SW-01 的邻居拓扑                  │
│    🤖 助手 · ✅ 已完成                                  │
│    📋 过程面板 ▶ 已完成（💭✅ → 🔧Agent✅）             │
│    [长回复：邻居拓扑表]                                 │
│                                                        │
│  Turn 5: 配置审核建议                                   │
│    🧑 用户：基于以上诊断，给出配置审核建议              │
│    🤖 助手 · ✅ 已完成                                  │
│    📋 过程面板 ▶ 已完成（💭✅ → 🔧✅ → 💭✅）           │
│    [长回复：审核建议 + 优先级排序]                       │
│                                                        │
│  ⚠️ 上下文窗口已接近限制（约 92% 已用）                 │
└────────────────────────────────────────────────────────┘
```

### 阶段 24.2：压缩触发——CONTEXT_COMPACTED 事件到达

Turn 6 执行中，上下文引擎检测到窗口接近限制，触发压缩。较早的 Turn 1-3 被总结为 SUMMARY 消息，`CONTEXT_COMPACTED` 事件推送到流。

**双重呈现**：过程面板出现 📦 压缩条目（持久），ASSISTANT 气泡内出现瞬时通知（~3 秒后消失）。

```
阶段 24.2a：压缩事件到达（过程面板 + 瞬时通知）
┌─ 对话区 ────────────────────────────────────────────────┐
│  ...（Turn 1-5 已折叠）                                  │
│                                                          │
│  Turn 6: 综合诊断报告                                    │
│  > 🧑 用户：综合以上所有诊断结果，生成完整报告           │
│  > 🤖 助手 · 执行中 ⏳                                   │
│                                                          │
│  ┌─ 📋 过程面板（auto-expanded ▼）──────────────────┐   │
│  │  💭 思考 #1 · ⏳ 进行中                             │   │
│  │  ────────                                          │   │
│  │  📦 上下文已压缩            ← 压缩条目（持久）      │   │
│  │  已压缩较早上下文以继续处理当前长回复。              │   │
│  │  （reason: CONTEXT_WINDOW_POLICY）                  │   │
│  │  压缩 3 条消息，剩余 4200 tokens                     │   │
│  │  contextVersion: v2                                 │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  > 🤖 助手回复（流式追加中）...                          │
│  > ## 综合诊断报告                                       │
│  > 根据前序诊断结果...                                   │
│                                                          │
│           📦 上下文已压缩              ← 瞬时通知        │
│        （3 秒后自动消失）              （live-only）      │
└──────────────────────────────────────────────────────────┘
```

```
阶段 24.2b：瞬时通知消失后（仅过程面板条目保留）
┌─ 对话区 ────────────────────────────────────────────────┐
│  ...（Turn 1-5 已折叠）                                  │
│                                                          │
│  Turn 6: 综合诊断报告                                    │
│  > 🧑 用户：综合以上所有诊断结果，生成完整报告           │
│  > 🤖 助手 · ✅ 已完成                                   │
│                                                          │
│  ┌─ 📋 过程面板（auto-collapsed ▶ 已完成）────────────┐  │
│  │  已完成  ▶                                          │  │
│  │  （展开可见：💭✅ → 📦 压缩 → 助手回复）             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  > ## 综合诊断报告                                       │
│  > 根据前序诊断结果，当前网络状况如下：                  │
│  > ## 1. 诊断摘要                                        │
│  > ## 2. 关键发现                                        │
│  > ## 3. 处置建议                                        │
│  > ...                                                   │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 压缩条目在过程面板内作为独立条目呈现，不混入助手消息气泡正文。瞬时通知在 ASSISTANT 气泡内/下方显示，约 3 秒后自动消失——它是 live-only 的，history 模式不重建。

### 阶段 24.3：压缩后继续对话——基于压缩后上下文回答

Turn 6 的助手回复基于压缩后上下文生成。用户在 Turn 7 引用早期对话内容提问，Agent 基于摘要回答（关键信息保留，但部分细节可能丢失）。

```
┌─ 对话区 ────────────────────────────────────────────────┐
│  ...（Turn 1-5 已压缩，Turn 6 已完成）                   │
│                                                          │
│  Turn 7: 追问早期细节                                    │
│  > 🧑 用户：Edge-RTR-02 的丢包率具体是多少？             │
│  >    （引用 Turn 2 的内容）                              │
│  > 🤖 助手 · ✅ 已完成                                   │
│  > 根据之前的排查记录，Edge-RTR-02 在 09:05              │
│  > 的丢包率为 0.18%。                                    │
│  >                                                       │
│  > ℹ️ 该数据来自压缩后保留的诊断摘要。                   │
│  >    如需完整原始数据，建议查看 Turn 2 的历史记录。      │
│                                                          │
│  ┌─ 📋 过程面板（auto-collapsed ▶ 已完成）────────────┐  │
│  │  已完成  ▶                                          │  │
│  │  （展开可见：💭✅）                                   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  contextVersion: v2（当前上下文基于压缩后版本）           │
└──────────────────────────────────────────────────────────┘
```

> ℹ️ 压缩保留了关键诊断结论（如丢包率），但部分原始细节（如完整告警列表、配置变更 diff）可能已被摘要化。Agent 会基于摘要回答，必要时引导用户查看历史 turn。

### 阶段 24.4：history 模式下的压缩呈现

用户切换到历史对话浏览。过程面板的 📦 压缩条目由持久化事实重建，completed thinking 由 Event history 恢复；两者默认折叠、可展开。瞬时通知不重建（live-only）。SUMMARY 消息被过滤，但压缩通知独立重建。

```
┌─ 对话区（history 模式）─────────────────────────────────┐
│  ...（Turn 1-5 已压缩）                                  │
│                                                          │
│  Turn 6: 综合诊断报告                                    │
│  > 🧑 用户：综合以上所有诊断结果，生成完整报告           │
│  > 🤖 助手 · ✅ 已完成                                   │
│                                                          │
│  ┌─ 📋 过程面板（collapsed ▶ 已完成）─────────────────┐  │
│  │  已完成  ▶                                          │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  点击 ▶ 展开后：                                         │
│  ┌─ 📋 过程面板（expanded ▼）─────────────────────────┐  │
│  │  💭 思考 #1 · ✅ 已完成（已折叠）                    │  │
│  │  ────────                                          │  │
│  │  📦 上下文已压缩            ← 重建（持久化消息）     │  │
│  │  已压缩较早上下文以继续处理当前长回复。              │  │
│  │  （reason: CONTEXT_WINDOW_POLICY）                  │  │
│  │  压缩 3 条消息，剩余 4200 tokens                     │  │
│  │  contextVersion: v2                                 │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  > ## 综合诊断报告                                       │
│  > ...（完整终态内容，与 live 完成后完全相同）            │
│                                                          │
│  ℹ️ 瞬时通知不重建（live-only）                           │
│  ℹ️ SUMMARY 消息已过滤，压缩通知独立重建                  │
└──────────────────────────────────────────────────────────┘
```

### 场景 24 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **压缩是可选事件** | 仅当上下文窗口接近限制时触发，非每次对话必然出现。mock server 正常路径每次发送压缩事件不代表真实后端行为 | `conversation-ui-state.md` 第 1 节 `CONTEXT_COMPACTED` |
| **双重呈现** | 过程面板条目（持久）+ 瞬时通知（live-only，~3 秒自动消失） | `process-panel.md` 上下文压缩通知章节 |
| **MUST NOT 暴露内部状态** | 不暴露被压缩的 prompt 内容、模型输出、原始消息正文、上下文引擎内部状态 | `07-content-copy.md` 上下文压缩文案 |
| **SUMMARY 消息过滤** | history 模式下 SUMMARY 消息被过滤，但压缩通知独立重建 | `conversation-ui-state.md` 第 6 节 |
| **瞬时通知 live-only** | 瞬时通知依赖实时事件到达触发，history 不重建 | `process-panel.md` 上下文压缩通知章节 |
| **contextVersion 可感知** | 用户可通过 contextVersion 感知上下文已变化，后续回答基于压缩后上下文 | `01-user-journeys.md` 旅程 6 第 4 步 |
| **压缩条目独立呈现** | 压缩条目在过程面板内作为独立条目追加到序列末尾，不嵌入其他条目内部 | `process-panel.md` 条目排序规则 |

---

## 场景 25：宿主页面触发 AI 提问（sendQuestionToLui） [A 核心对话与任务执行]

**用户操作**：用户在宿主产品页面点击"询问 AI"按钮，宿主页面通过 `sendQuestionToLui` 向 NextAgent PIU 面板注入问题，PIU 面板自动打开并开始对话。

**适用模式**：仅协作式（PIU/collaborative）。本地（local）和沉浸式（immersive）模式无此机制。

### 阶段 25.1：宿主页面——用户点击"询问 AI"按钮

```
┌─────────────────────────────────────────────────────────────┐ ← 宿主产品页面
│  宿主产品顶部菜单                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  告警列表                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⚠ Edge-RTR-02  CPU 95%        2026-07-15 08:42     │   │
│  │ 状态：处理中        级别：严重                      │   │
│  │                                     [询问 AI 🤖]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⚠ Core-SW-01  端口 down      2026-07-15 08:35     │   │
│  │ 状态：未处理        级别：重要                      │   │
│  │                                     [询问 AI 🤖]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                                        ┌──────┐            │
│                                        │ 🤖 AI │ ← PIU 入口 │
│                                        └──────┘  （折叠态） │
└─────────────────────────────────────────────────────────────┘
```

> ℹ️ 宿主页面 JS 调用 `piu.sendQuestionToLui({ question: "分析 Edge-RTR-02 CPU 95% 告警原因", isSend: true })`。来源：`registerAIAgentPIU.tsx` L76-85。

### 阶段 25.2：PIU 面板自动打开——问题注入对话

```
┌─────────────────────────────────────────────────────────────┐ ← 宿主产品页面
│  宿主产品顶部菜单（63.2px）                                 │
├────────────────────────────────┬────────────────────────────┤
│  Expand Panel（如有）          │  PIU 宿主面板（docked-right）│
│                                │  ┌──────────────────────┐  │
│                                │  │ 💬 NextAgent  [×]   │  │
│                                │  ├──────────────────────┤  │
│                                │  │ > 🧑 用户            │  │
│                                │  │ > 分析 Edge-RTR-02   │  │
│                                │  │   CPU 95% 告警原因   │  │
│                                │  │                      │  │
│                                │  │ > 🤖 助手 · ⏳ 执行中 │  │
│                                │  │ > 📋 过程面板 ▶      │  │
│                                │  │   └ 🔧 queryAlerts   │  │
│                                │  │                      │  │
│                                │  │ ┌─ Composer ──────┐  │  │
│                                │  │ │ 输入消息…[发送]  │  │  │
│                                │  │ └──────────────────┘  │  │
│                                │  └──────────────────────┘  │
├────────────────────────────────┴────────────────────────────┤
│  宿主页面内容（告警列表）                                   │
└─────────────────────────────────────────────────────────────┘
```

> ℹ️ `sendQuestionToLui` 调用后：(1) PIU 面板自动打开（`queueQuestion` 内调 `openPanel`，`runtimeStore.ts` L217）；(2) 问题通过 `composerBridgeRef.current.sendQuestion()` 注入对话（`AIAgentPiuRuntime.tsx` L97）；(3) `isSend=true` 时自动发送为新消息。若 composer 未就绪，每 16ms 重试直到成功（`AIAgentPiuRuntime.tsx` L107-111）。

### 阶段 25.3：isSend=false——仅填入 composer（不自动发送）

```
┌────────────────────────────────────────────────┐ ← PIU 宿主面板
│  💬 NextAgent                          [×]    │
├────────────────────────────────────────────────┤
│                                                │
│  （对话区为空或保留之前的对话）                 │
│                                                │
│  ┌─ Composer ──────────────────────────────┐  │
│  │ 分析 Edge-RTR-02 CPU 95% 告警原因  [发送] │ ← 问题填入输入框
│  └──────────────────────────────────────────┘  │   但未发送
│                                                │
└────────────────────────────────────────────────┘
```

> ℹ️ `isSend=false`（或未设）时，问题仅填入 composer 输入框，用户可编辑后手动点击发送。适用于宿主页面提供"建议提问"而非"强制发起对话"的场景。

### 关键视觉元素

| 元素 | 说明 |
|---|---|
| PIU 入口按钮 | 宿主页面右下角圆形 logo 按钮（`AIAgentEntrance`），折叠态可点击手动打开面板 |
| 宿主页面"询问 AI"按钮 | 宿主页面 UI 元素（如告警卡片旁），由宿主产品自行设计和渲染 |
| 面板自动打开 | `sendQuestionToLui` 调用后 PIU 面板自动从折叠/关闭态切换到显示态 |
| 问题注入 | 问题通过 `composerBridgeRef.sendQuestion` → `injectQuestion` 注入对话 |
| isSend 控制 | `true` → 自动发送为新消息（USER 气泡 + Agent 执行）；`false` → 仅填入 composer |
| composer 重试 | composer bridge 未就绪时每 16ms 重试，直到注入成功 |
| 面板布局不受影响 | 面板保持当前布局（docked/floating/maximized），`sendQuestionToLui` 不改变面板布局 |

### history 视图

`sendQuestionToLui` 注入的问题作为普通 USER 消息持久化，history 模式下与普通对话一致。`isSend=false` 时问题未发送，不产生持久化消息。

### 场景 25 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **仅协作式（PIU）模式** | 本地/沉浸式无 `sendQuestionToLui` 机制 | `registerAIAgentPIU.tsx` L76-85 |
| **自动打开面板** | 调用后 PIU 面板自动打开，无论之前是折叠还是关闭 | `runtimeStore.ts` L217 |
| **question 非空校验** | `question` 必须为非空字符串，否则 warn 并忽略 | `registerAIAgentPIU.tsx` L77-79 |
| **isSend 默认 false** | 未设 `isSend` 时仅填入 composer，不自动发送 | `runtimeStore.ts` L220 |
| **不直接修改后端状态** | 问题注入对话后由 Agent 处理，`sendQuestionToLui` 不直接调用后端 API | `sendQuestionToLui` 当前行为 |
| **pendingQuestion 清理** | 注入完成后 `clearPendingQuestion` 清除待处理状态 | `AIAgentPiuRuntime.tsx` L98 |
| **不得复用为 PIU submit contract** | `sendQuestionToLui` 是 host-only 当前 bridge；`onPiuSubmit` 仍为 `[UCD目标/Clarify]`，必须由 shared composer/request owner 定义，不得直接路由到 `injectQuestion` | `expand-panel.md` 与 `sendQuestionToLui` 的边界 |

---

## 场景 26：并行工具调用 [A 核心对话与任务执行]

**用户操作**：用户提出需要同时获取多种信息的复杂问题（如"排查 Edge-RTR-02，同时查告警、查配置、查日志"）。Agent 一次思考后决定并行调用 3 个工具，3 个能力同时执行，各自独立完成后 Agent 综合分析生成最终回答。

**适用模式**：本地（local）、沉浸式（immersive）、协作式（PIU/collaborative）。

> ℹ️ 系统已完整实现并行工具调用：模型一次思考后通过 `Promise.allSettled` 并发执行多个工具（`tool-loop.ts` L245-266）。每轮有副作用工具上限 5 个，只读工具上限 20 个。结果按模型声明顺序（非完成顺序）写入对话上下文，以保持 tool_use/tool_result 配对。

### 阶段 26a：思考完成 → 并行能力启动

Agent 思考完成，`flushThinking()` 关闭 think 条目。前端**几乎同时**收到 3 个 `CAPABILITY_STARTED` 事件，过程面板出现 3 个 running 态能力卡片。

```
┌─ 过程面板 ─────────────────────────────────────────┐
│  💭 思考完成（折叠）                                │
│  🔧 queryAlerts    running  [并行 1/3]             │
│  🔧 queryConfig    running  [并行 2/3]             │
│  🔧 queryLogs      running  [并行 3/3]             │
└──────────────────────────────────────────────────┘
```

> ℹ️ 3 个 `CAPABILITY_STARTED` 事件携带相同的 `toolBatchSize=3` 且 `toolBatchExecutionMode="PARALLEL"`，属于同一并行批次。每个事件的 `toolBatchOrdinal` 分别为 1、2、3。
>
> ⚠️ 当前 `stream-envelope.ts` 的 `copySafeFields` 未将 `toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize` 投影到前端流，前端当前无法识别并行批次。上图中的"并行 N/M"徽标为 UCD 设计建议，需补流投影后实现（见 `10-implementation-gap-analysis.md` B10）。

### 阶段 26b：部分完成

3 个能力各自独立执行，`CAPABILITY_RESULT_DELTA` / `CAPABILITY_COMPLETED` 按各自完成顺序到达。queryAlerts 先完成（success），queryConfig 和 queryLogs 仍 running。

```
┌─ 过程面板 ─────────────────────────────────────────┐
│  💭 思考完成（折叠）                                │
│  🔧 queryAlerts    ✅ 找到 3 条告警  [并行 1/3]     │
│  🔧 queryConfig    running         [并行 2/3]       │
│  🔧 queryLogs      running         [并行 3/3]       │
└──────────────────────────────────────────────────┘
```

> ℹ️ 并行能力之间互不阻塞——queryAlerts 完成不会等待 queryConfig 和 queryLogs。每个能力独立进入 settling → settled。

### 阶段 26c：全部完成 → 生成回答

3 个能力全部终态，过程面板 auto-collapsed。Agent 综合三个能力的结果生成最终回答，助手消息气泡流式输出。

```
┌─ Turn ───────────────────────────────────────────┐
│  > 🧑 用户                                        │
│  > 排查 Edge-RTR-02，同时查告警、查配置、查日志   │
│                                                    │
│  > 🤖 助手 · ✅ 已完成                             │
│  > 📋 过程面板（已折叠，3 个工具已执行）           │
│  > # Edge-RTR-02 排查报告                          │
│  > ## 告警                                         │
│  > 共 3 条告警，最早 08:42 CPU 95%…               │
│  > ## 配置                                         │
│  > 当前配置与基线一致，无异常变更…                 │
│  > ## 日志                                         │
│  > 08:41-08:43 期间有 12 条 error 级日志…         │
│  > ## 结论                                         │
│  > CPU 飙高与 BGP 邻居震荡相关，建议…              │
│  └──────────────────────────────────────────────┘
└──────────────────────────────────────────────────┘
```

### history 视图

3 个能力卡片均显示终态（success/failure），无"并行 N/M"徽标——history 不重建 streaming 中间态，内容与 live 完成后完全相同。

```
┌─ Turn（history） ────────────────────────────────┐
│  > 🧑 用户                                        │
│  > 排查 Edge-RTR-02，同时查告警、查配置、查日志   │
│                                                    │
│  > 🤖 助手 · ✅ 已完成                             │
│  > 📋 过程面板（已折叠，3 个工具已执行）           │
│  > # Edge-RTR-02 排查报告                          │
│  > …（完整回复内容与 live 完成后相同）             │
│  └──────────────────────────────────────────────┘
└──────────────────────────────────────────────────┘
```

### 关键视觉元素

| 元素 | live 模式 | history 模式 |
|------|-----------|--------------|
| 多个能力同时 running | ✅ 可见 | ❌ 不适用（直接呈现终态） |
| "并行 N/M" 徽标 | ✅ 可见（UCD 设计建议，需补流投影） | ❌ 不显示（无 streaming 中间态） |
| 各能力独立完成顺序 | ✅ 按各自完成顺序呈现 | N/A |
| 结果写入对话顺序 | 按模型声明顺序（非完成顺序） | 同 |
| 过程面板 auto-collapsed | ✅ 全部完成后折叠 | ✅ 默认折叠 |

### 场景 26 的关键约束

| 约束 | 说明 | 来源 |
|---|---|---|
| **每轮上限** | 有副作用工具 max 5/轮，只读工具 max 20/轮 | `tool-loop.ts` |
| **序列化例外** | ToolSearch + Skill 同批次强制 SERIAL 模式 | `tool-loop.ts` |
| **AskUserQuestion 中断** | AskUserQuestion 在批次中会中断后续工具执行 | `tool-loop.ts` |
| **结果按声明顺序写入** | 结果按模型声明的 tool_use 顺序（非完成顺序）写入对话上下文 | `tool-loop.ts` 有序终结逻辑 |
| **批次元数据已持久化** | `toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize` 已在后端 timeline event 中持久化 | `capability-timeline-payload-schemas.ts` |
| **流投影缺口** | `stream-envelope.ts` 未将批次字段投影到前端流 | `stream-envelope.ts` L284 `copySafeFields` |
| **Dev Workbench 已实现** | Dev Workbench Run Graph 已有 fan-out/fan-in 渲染 | `packages/agent-dev-workbench/` |
| **生产前端未实现** | 生产前端 Run Graph 和过程面板均无并行分组 | `frontend/agent-web/` |

---

## 场景 27：300 轮多步骤诊断历史压力验证 [C 会话组织与检索]

### 数据形态

- 同一 session 包含 300 个已完成 turn。
- 每个 turn 包含 2～4 次模型调用，每次产生独立 completed thinking。
- 每个 turn 包含 1～3 次 capability lifecycle，结果由同一 run 的 Message 补全。
- 部分 turn 包含 degradation、compaction 和 legacy Event unavailable，用于覆盖混合历史。

### 用户操作序列

1. 刷新页面，验证 Message history 先可读，执行详情标题不闪现“加载历史信息”。
2. 使用鼠标滚轮快速跨越约 100 个 turn，观察 Event 请求并发不超过 4。
3. 拖动 scrollbar thumb 到会话中部；拖动期间不为经过的每个 turn 发起 Event 请求，释放后只加载最终可视范围。
4. 连续 hover 10 个 preview marker，确认只显示摘要且 Event 请求数不增加。
5. 点击一个尚未加载的 preview marker，确认目标 Message 页先加载并定位，目标 run 的 Event 随后进入显式优先队列。
6. 展开多个历史过程面板，确认每次模型调用只显示一个 completed thinking，不出现一行是另一行前缀的重复条目。
7. 切换到另一个 session 后再返回，确认旧 session 请求不会回填到新 session，缓存命中时已加载过程立即出现。

### 可观察验收

| 观察项 | 预期 |
|---|---|
| Message 首屏 | 不等待 Event history |
| Event 并发 | 全局最多 4 个；同一 run 分页串行 |
| 自动/显式目标 | 各最多 16 个 |
| 加载提示 | 300ms 内无 loading-only 行；之后只在展开内容区显示 spinner |
| Thinking 数量 | 与 completed model invocation 数量一致；按 run/root/step identity 合并 |
| Cache | 最多 64 个未固定 run、2,000 条未固定 envelope；单个 run 不截断 |
| 快速滚动 | 不反复取消、重发已启动的只读请求 |
| Legacy 数据 | 安全显示“历史过程不可用”，不循环重试 |

---

核心边界：`[已实现-主干]` Message history 与 Event history 共同保证完成的持久化事实可重建；streaming 瞬态和未完成 delta 不重建。

| 元素 | live 模式 | history 模式 |
|---|---|---|
| 用户消息气泡 | ✅ 实时 | ✅ 重建 |
| 助手消息气泡（流式追加） | ✅ 实时追加（打字机效果） | ✅ 直接呈现终态完整内容（无打字机效果） |
| 💭 思考过程（单轮） | ✅ 累计 snapshot 流式可见 | ✅ 恢复 completed snapshot，不恢复中间 delta |
| 💭 思考过程（多轮，每轮独立条目） | ✅ 多个 think 条目，按 `stepId` replace | ✅ 恢复各 completed 条目并按 identity 合并；安全过滤仍见 B17 |
| 🔧 能力卡片 running 态 | ✅ 可见 | ❌ 不可见（transient streaming 状态，终态由 CAPABILITY_RESULT_DELTA 承载） |
| 🔧 能力卡片 long-running 态（计时器+取消+进度） | ✅ 可见 | ❌ 计时器/取消不可见（transient streaming UI）；进度 delta 由 CAPABILITY_RESULT 消息重建 |
| 🔧 能力卡片结果 | ✅ 增量投递 | ✅ 终态重建 |
| 📝 助手气泡中途 content delta | ✅ 与最终回复拼接 | ✅ 合并后完整重建 |
| ⚡ 跨会话等待输入/运行中 Activity | `[已实现-主干]` 独立 Activity Stream + shared trailing slot | 独立于 conversation history |
| 🔴/🔵 未读失败/结果 Activity | `[已实现-主干]` 匹配 terminal presentation 可见后消费 | 独立于 conversation history |
| ⚠️ 降级提示（可选，非每次对话必然出现） | ✅ 实时 | ✅ 可见（由持久化消息重建） |
| 📦 压缩通知（可选，仅上下文窗口超限时） | ✅ 实时 | ✅ 可见（由持久化消息重建，`SUMMARY` 消息被过滤但压缩通知独立重建） |
| 📝 Pending input 卡片 | ✅ 可交互 | ✅ 终态重建（只读） |
| 📎 staged 文本附件 | `[已实现-主干]` 默认 Markdown-only；effective config 可允许 CSV 等文本类型，正文由模型通过逻辑 `Read` path 按需读取 | ⚠️ 依赖持久化 metadata 呈现附件状态；不把正文直接投影进 prompt |
| 终态指示 | ✅ 实时 | ✅ 重建 |
| 过程面板 | ✅ 可见（完成后 auto-collapsed） | ✅ 可见（默认 collapsed，可展开） |
| 过程动画 | ✅ 可见（running/settling/settled） | ❌ 不可见（无动画，直接呈现终态） |
| 🔴 断线重连指示 | ✅ 可见 | ❌ 不适用 |
| 🔭 Run Graph（"完整过程"按钮） | ✅ 可打开（节点含 ⏳ 进行中态） | ✅ 可打开（节点均为终态，无 ⏳） |
| 🗺️ Expand Panel（富内容面板） | ✅ EXPAND_PANEL 事件自动打开 | ❌ history-load 事件被跳过，不自动打开 |
| 🪟 OPERATOR 与 `[UCD目标]` LINK 导航卡片 | `[已实现-主干]` 普通 OPERATOR 按钮可点击并 dispatch；LINK 专门卡片未实现 | history 可重建普通按钮并由用户点击；LINK 专门卡片同样未实现，集成方行为依赖监听器 |
| 📄 文件下载卡片（FILE object） | ✅ 用户点击下载，浏览器原生下载 | ⚠️ 卡片可见（重建），downloadUrl 指向文件可能过期 |
| 🔧 交互式 PIU 保存（`onPiuSubmit`） | `[UCD目标/Clarify]` 目标为审核后交给 shared composer/request owner 创建新 turn；`[已实现-主干]` 无此回调 | `[UCD目标]` 面板不自动打开，PIU 占位符可见，审核 UI 不重建 |
| ★ 收藏 | `[已实现-主干]` 收藏对象为 message/turn；不提供 session favorite 语义 | ✅ 重建 favorite turn 列表项及其所属会话信息 |
| ⚡ 后台任务追踪 | `[已实现-主干]` header monitor：一次 REST seed + stream live update，可 Kill；inline card 为 `[UCD目标]` | 切换 session 时重新 seed；任务通常已终态，输出引用可能过期 |
| ⏰ Cron 定时任务卡片 | ✅ 后端安全投影 + 前端 create/delete/list 专门呈现 | ✅ 从持久化结果重建并使用同一 formatter，不重演 running 动画 |
| 🔀 并行工具调用（"并行 N/M" 徽标） | ✅ 可见（UCD 设计建议，需补流投影） | ❌ 不显示（无 streaming 中间态） |

---

## 样例与组件规范的对应

| 样例元素 | 组件规范 | 契约层章节 |
|---|---|---|
| 用户/助手消息气泡 | `05-component-specs/message-bubble.md` | 第 1 节 |
| 💭 思考过程（单轮/多轮 think 条目） | `05-component-specs/message-bubble.md`（思考条目） | 第 1 节 `LLM_THINKING_DELTA` |
| 📝 助手气泡中途 content delta（与最终回复拼接） | `05-component-specs/message-bubble.md`（助手气泡） | 第 1 节 `LLM_CONTENT_DELTA` |
| 🔧 能力卡片（含 long-running 态） | `05-component-specs/capability-card.md` | 第 1、2 节 |
| 📝 Pending input 卡片 | `05-component-specs/pending-input-card.md` | 第 3 节 |
| ⚠️ 降级提示 | `05-component-specs/degradation-notice.md` | 第 1、5 节 |
| 📎 附件指示 | `05-component-specs/composer.md` | 第 1 节 `ATTACHMENT_*` |
| 📦 压缩通知 | `07-content-copy.md` | 第 1 节 `CONTEXT_COMPACTED` |
| ❌ 失败卡片 | `06-empty-loading-error-states.md` | 第 5 节 |
| 🔴 断线重连 | `06-empty-loading-error-states.md` | 第 4 节 |
| ⚡ 跨会话 Activity 五态与未读终态消费 | `05-component-specs/session-list-item.md` | 会话活动章节 |
| ⏳ long-running 计时器 / 取消入口 | `05-component-specs/capability-card.md`（长时运行扩展） | 第 1 节 |
| 📝 Pending input 多 kind 矩阵 | `05-component-specs/pending-input-card.md`（各 kind 详细呈现） | 第 3 节 |
| ✏️ 编辑模式 / 被取代终态 | `05-component-specs/composer.md`（编辑模式）、`message-bubble.md`（SUPERSEDED） | 第 1 节 |
| ⏹️ 取消通知 / ↻ 重试入口 | `05-component-specs/message-bubble.md`（CANCELED 子情况、重试入口） | 第 1 节 |
| 🔍 搜索 / 重命名 / 删除 / 收藏回合 | `05-component-specs/session-list-item.md`（搜索、重命名、删除）、`message-bubble.md`（favorite turn） | 第 6 节 |
| 🔗 分享 / 🔀 派生 | `05-component-specs/message-bubble.md`（派生、标注反馈） | 第 1 节 |
| 🔭 Run Graph（完整执行流程） | `05-component-specs/process-panel.md`（Run Graph 抽屉） | 第 1 节 |
| 🗺️ Expand Panel（富内容面板/PIU） | `05-component-specs/expand-panel.md` | 第 1 节 `TOOL_STRUCTURED_DELTA` |
| 🪟 导航卡片与集成方页面跳转（OPERATOR LINK） | `05-component-specs/sub-window.md` | `TOOL_STRUCTURED_DELTA` OPERATOR |
| 📄 文件下载卡片（FILE object） | `05-component-specs/file-download.md` | `TOOL_STRUCTURED_DELTA` FILE |
| 🔧 交互式 PIU 保存（`onPiuSubmit`，`[UCD目标/Clarify]`） | `05-component-specs/expand-panel.md`（交互式 PIU 保存章节） | `TOOL_STRUCTURED_DELTA` PIU |
| 🤖 宿主页面触发 AI 提问（sendQuestionToLui） | `05-component-specs/tool-ui-interface-overview.md`（其他 PIU 交互接口章节） | PIU handler `sendQuestionToLui` |
| ⚡ 后台任务追踪区 | `05-component-specs/capability-card.md`（commandOutput + backgroundHandle 扩展） | 后台分离执行模式（当前实例：Bash `run_in_background`） |
| ⏰ Cron 定时任务卡片 | `05-component-specs/cron-task.md` | Cron 工具 `safeResult.kind = "cron"` |
| 🔀 并行工具调用（"并行 N/M" 徽标） | `05-component-specs/process-panel.md`（并行组合）、`05-component-specs/capability-card.md`（并行徽标） | `CAPABILITY_STARTED` 的 `toolBatchExecutionMode`/`toolBatchOrdinal`/`toolBatchSize`（流投影缺口见 B10） |

---

## 样例数据时效性

本文档样例基于 mock、真实服务验证与契约层期望渲染，整理于 2026-07-08，并于 2026-08-13 按 `origin/main@4f27c4a9f` 刷新 thinking history、Session Activity、Process Activity、Cron Dashboard、safeResult 与长会话容量边界。场景同时包含已实现行为与显式 `[UCD目标/Clarify]`；契约事实以 owning stable/active specs 为准，尚未归档的增量会明确标注，任务准入以 roadmap 为准。
