# harden-action-operator-event-dispatch

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：security contract refinement candidate
主要 owner：`frontend/agent-web` host interaction boundary；可信 action catalog owner 待确认
认领人：不可认领
依赖：既有 ACTION/OPERATOR structured rendering 与 multi-host baseline

当前状态：
- 已有 ACTION card、普通 OPERATOR buttons 与宿主事件路径，不需要重复创建基础 renderer；OPERATOR LINK 专门卡片尚未实现。
- 当前 ACTION 数据可影响被 dispatch 的 event key；缺少冻结的 allowlist/catalog、host registration、scope 和确认规则。
- `ActionCard` 在 render 时重新解析 `entries`，effect 又依赖该对象；live re-render 可能重复自动 dispatch。历史 `CAPABILITY_RESULT` 重建/重新打开也可能再次 mount ACTION 并重放副作用，当前没有稳定的 at-most-once identity 或 history 禁派发规则。

目标：
- 让模型产生的 ACTION/OPERATOR 只能选择当前可信宿主显式注册且授权的 action，不能构造任意 Document event 或覆盖 scope。

进入 `ready` 前必须确认：
- action id/catalog 由 host composition、runtime bootstrap 还是其他可信 public boundary 提供。
- 每个 action 的 payload runtime schema、最大大小、Agent/Owner Scope 和 host mode availability。
- 哪些操作只导航，哪些产生外部副作用并必须先经过用户确认或 authorization pending input。
- ACTION 首次 live 到达、同组件 re-render/remount、stream replay 和 history-load 的派发规则；首版必须明确 history 是否一律只读不派发。
- at-most-once/deduplication identity、作用域、保留时间和宿主幂等责任；不能用 React mount 次数或本地临时对象身份充当业务幂等键。
- unknown/disabled action、schema mismatch、host rejection 和 timeout 的 safe UI 行为。

实现约束：
- 模型输出只能引用 action id 和受 schema 约束的参数，不得定义 event name、DOM target 或任意 callback。
- frontend 不接管 trusted identity、capability authority 或后台业务写入。
- 单纯渲染、组件 re-render、history/replay 或 locale/theme 变化不得无条件重复外部副作用；若某类自动派发获准，必须由冻结的 live-only + at-most-once/idempotency contract 约束。
- 不新增第二套 ACTION/OPERATOR renderer 或 host mode 业务语义。

转为 `ready` 后的验收出口：
- negative tests 证明任意 event key、未注册 action、scope override、非法 payload、history-load、重复 render/remount 和重复 envelope 被拒绝或去重，不产生重复 dispatch。
- multi-host tests 证明 action availability 来自可信 host registration。
- 外部副作用 action 必须有对应 confirmation/authorization contract tests。

并行边界：
- clarify 状态不可实施。
- 不与 nested PIU submit、session navigation 或 runtime lifecycle 合并。
