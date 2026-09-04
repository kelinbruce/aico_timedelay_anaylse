## 背景与问题（Why）

`frontend/agent-web` 已经实现 Pending Input 的前端交互闭环：当前会话出现 active pending input 时，普通 Composer 被响应面板替换；回答成功，或该 pending input 被接收、超时、取消后，普通 Composer 恢复。有投影过期坐标时，响应面板只展示随本地时间变化的剩余/过期状态；`QUESTION` 和 `HUMAN_HANDOFF` 的取消入口把操作委托给 active input 的 owning request，并等待 canonical outcome 收敛 UI。组件测试和路由状态测试已经覆盖这些可观察行为。

当前 Stable Specs 已拥有 Pending Input 的 runtime 生命周期、四种 canonical kind、答案 shape、超时和取消语义，但没有专门的前端 UI owner。结果是现有 UI 行为只能作为 implementation-only 事实存在，无法在不重读生产代码的情况下判断 Composer 与 Pending Input 响应面板的切换契约。

本 change 严格按当前生产代码和已通过测试补齐这一缺失的 UI 规格，不设计新的产品行为，也不修改任何生产代码。

## 变更范围（What Changes）

- 新增 `agent-web-pending-input-ui` capability，规定当前会话存在 active pending input 时，agent-web 使用对应响应面板替换普通 Composer。
- 为 Stable Pending Input contract 已定义的四种 canonical kind（`QUESTION`、`CONFIRMATION`、`AUTHORIZATION`、`HUMAN_HANDOFF`）规定对应响应控件；兼容 kind 不在本 change 范围内。
- 规定回答请求成功后，前端清除当前响应面板并恢复普通 Composer。
- 规定当前 active pending input 收到 canonical resolved outcome（received、timeout 或 canceled）后，前端清除响应面板并恢复普通 Composer。
- 规定存在投影过期坐标时展示随本地时间变化的剩余/过期状态，但本地到期不回答、不授权、不取消、不清除响应面板，仍等待 canonical resolved outcome。
- 规定 canonical `QUESTION` 和 `HUMAN_HANDOFF` 的当前取消入口委托 active input 的 owning request；cancel request 成功本身不合成事件或提前恢复 Composer。
- 明确排除 Web/Task answer route、public DTO、stream envelope payload、runtime resolve/timeout/cancel 生命周期、timeout policy、timer cadence、精确倒计时格式、cancel command/idempotency、fallback decision、分类错误展示、exactly-once 提交、其他视觉常量和兼容 kind；这些内容继续由既有 Stable Specs、未归档 change 或当前实现拥有。
- 明确不把当前 `CONFIRMATION` 无 options 时的 fallback 值写入规格，因为它与 Stable confirmation contract 冲突。

本 change 无破坏性变更。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-web-pending-input-ui`: 定义 active pending input 与普通 Composer 之间的前端可观察切换行为、canonical kind 对响应面板的选择边界、展示型过期状态和当前 owning-request 取消委托。

### 修改的 Capability

无。

## 影响范围（Impact）

- OpenSpec：新增 `agent-web-pending-input-ui` 增量规格、设计说明和验证任务。
- 生产代码：无修改；事实证据来自 `useChatSessionStream.ts`、`userInputStore.ts`、`ChatPage.tsx` 和 `RespondInput.tsx` 的当前实现。
- API 与 contract：无修改；不重定义 `add-ts-task-channel` 正在拥有的 Web/Task answer route、公共 DTO、stream projection 或安全错误契约。
- 测试：复用并执行 `RespondInput.test.tsx`、`useStreamConnection.test.tsx` 和 `chat-page.route-state.test.tsx` 中与本 capability 直接对应的测试；characterization tests 证明 canonical `CONFIRMATION` 控件选择与恢复、投影倒计时到期不驱动生命周期，以及取消操作使用 owning request 且等待 canonical outcome。不修改产品行为或无关失败，也不把 request service 的 URL shape 纳入本 capability。
- 配置、依赖、持久化和运维：无影响。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/agent-web-pending-input-ui/spec.md`：归档时新增本 change 已验证的 UI 切换、展示型过期状态和 owning-request 取消委托行为。

长期背景：

- `openspec/overview.md`：无。

设计视图：

- `openspec/designs/architecture/<topic>.md`：无；本 change 不新增跨模块协议或 runtime 生命周期设计。
- `openspec/designs/modules/agent-web.md`：该文件现已是 Stable 前端 module owner；归档前最小补充 Pending Input response surface、普通 Composer 互斥、本地恢复、展示型过期状态和 owning-request 取消委托职责，不复制 channel/runtime lifecycle。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：归档前为新 capability 增加到生产代码与定向测试的导航；不得同步未归档 change 的专属内容。

验证入口：

- `frontend/agent-web/tests/RespondInput.test.tsx`
- `frontend/agent-web/tests/useStreamConnection.test.tsx`
- `frontend/agent-web/tests/chat-page.route-state.test.tsx` 中 Pending Input 激活、回答成功和 resolved outcome 场景
- `openspec validate establish-agent-web-pending-input-ui --strict`
