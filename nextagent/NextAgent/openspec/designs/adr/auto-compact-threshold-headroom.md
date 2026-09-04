# ADR: Auto-compact 阈值使用固定的 13,000 单位余量

## 状态（Status）

Accepted (2026-06-27, `tune-auto-compact-threshold`)

## 背景与现状（Context）

摘要压缩需要一个主动触发器：在 history 被迫挤出 context window 之前压缩
对话，而不是只在 budget gate 省略 `prior_active_history` 之后
再被动响应。该触发器必须把"对话正在逼近有效窗口"表达为
一个单一、确定性的
条件。

有效窗口是 `availableInputUnits = contextWindowTokens − reservedOutput`
（单一来源，在 `runBudgetGate` 中计算）。触发器将估算的
对话输入 unit 与该窗口比较。有两个
参数可以表达触发点：

- 窗口的**比例**（例如在 92% 时触发），或
- **固定绝对余量**（在 `window − H` 时触发）。

目标部署窗口很大（电信网络智能体使用
128K 级 model）。小窗口（例如 16K）是边缘情况，
不是设计目标。

## 决策（Decision）

使用**固定绝对余量** `DEFAULT_AUTO_COMPACT_HEADROOM_UNITS = 13_000`，
硬编码在 `assemble-context.ts` 中。当
`estimatedConversationInputUnits >= availableInputUnits − 13_000` 时触发。

附加一个确定性的**小窗口守卫**：当
`availableInputUnits <= 13_000` 时，触发器完全不触发
（压缩回退到 budget gate 自身的降级路径）。

该值是固定常量——不注入、不可配置、不通过
`ContextAssemblyRequest` 携带。

## 结果（Consequences）

- 在 128K 窗口上触发点约为 ~90–92%（取决于保留
  输出）；在 200K 窗口上约为 ~93.5%。两者都落在预期的
  "逼近窗口、在被省略前压缩"区间。
- 绝对余量提供与窗口大小无关的
  可预测安全边际，而不是在小窗口上
  按比例缩小的边际。
- 小窗口（`availableInputUnits <= 13_000`）没有主动压缩；
  它们依赖 budget gate 的显式降级。这是可接受的，
  因为此类窗口不是部署目标，且那里的
  比例边际会紧到无法行动。
- 如果将来需要窗口自适应触发，单独的 change 可以
  引入它；本 ADR 有意避免第二个参数（KISS）。

## 考虑过的备选方案（Alternatives considered）

- **纯比例（例如 0.92）。** 被否决：在 16K 窗口上 8% 余量只有
  ~1,280 token——太紧；压缩在小窗口上会触发得太晚，
  且边际恰恰在最关键的地方按比例消失。
- **比例加最小钳制。** 被否决：为非目标的小窗口场景
  增加了第二个可调参数和推理复杂度。
- **可配置/注入的余量。** 被否决：没有可配置性
  需求；固定常量是最小的单源形式，
  并使触发器远离请求表面。
