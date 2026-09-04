# ADR: Lifecycle Hook Effect 隔离

## 状态（Status）

Accepted

## 背景与现状（Context）

Lifecycle hook 使用 `HookEffect` 集合（`OBSERVE`、`TRANSFORM`、`CONTROL`）声明副作用权限。Runtime 从该集合推导执行策略：仅观察 hook（effect 恰为 `["OBSERVE"]`）以有界并行执行；包含 `TRANSFORM` 或 `CONTROL` 的 hook 在具有稳定拓扑顺序的串行影响组中执行。

这形成两个具有不同隔离保证的执行组：

- **观察组**：并行、无执行顺序保证、结果不回流进有效边界、完成顺序不得影响 request 事实。
- **串行影响组**：有序、变更归约进有效边界、后续 hook 看到更新后的边界、控制结果停止后续 hook。

`order.before` / `order.after` 约束允许同组内 hook 表达相对顺序。问题在于顺序约束是否可以跨 effect 组边界。

## 决策（Decision）

跨 effect 组的顺序目标 MUST 在 assembly 编译期 fail closed。仅观察 hook 的 `order.before` / `order.after` 目标 MUST 引用同一 stage 的其他仅观察 hook；影响 hook 的顺序目标 MUST 引用同一 stage 的其他影响 hook。仅观察顺序约束 MAY 记录在观察调用证据中用于诊断，但 MUST NOT 影响执行顺序。

## 理由（Rationale）

### 为什么隔离是必要的

三个执行组属性是耦合的：

1. 仅观察 hook 接收 stage 入口边界（在影响变更之前）。
2. 仅观察结果不回流进有效边界。
3. 仅观察 hook 以有界并行执行，无顺序保证。

如果一个仅观察 hook 可以声明 `order.after: "impact-hook"`，将意味着该观察 hook 应当看到影响变更——但属性 (1) 阻止了这一点。该约束会在运行时被静默忽略，误导开发者以为观察 hook 在影响变更应用之后运行。

反过来，如果一个影响 hook 可以声明 `order.before: "observe-hook"`，将意味着该观察 hook 的结果对影响 hook 可见——但属性 (2) 阻止了这一点。该约束同样会被静默忽略。

### 为什么 fail closed 而不是警告

Runtime 没有警告通道——assembly 编译是 pass/fail 的。静默忽略跨 effect 组约束会让开发者建立在错误的顺序假设之上，这在电信治理场景中尤其危险，因为 hook 顺序可能影响合规审计轨迹和脱敏保证。

### 为什么声明了顺序也不把仅观察合并进串行组

合并会违反 effect 推导执行策略原则（D2）：执行策略由 effect 推导，而不是由顺序约束推导。如果带顺序约束的仅观察 hook 变成串行，开发者就无法再依赖仅 `OBSERVE` 意味着"并行且隔离"。

## 排除的依赖模式（Excluded Dependency Patterns）

本模型有意排除三种依赖模式。开发者必须使用指明的替代做法：

1. **仅观察 hook 需要看到影响变更**：声明 `TRANSFORM` effect 并进入串行影响组。该 hook 如果只需要读取变更后边界，可以返回 `PASS` 而不变更，但必须接受串行执行延迟。

2. **影响 hook 需要消费仅观察结果**：仅观察结果不回流进有效边界。将观察逻辑合并进影响 hook，或重构为影响 hook 通过自己的冻结配置或确定性读取直接读取外部状态。

3. **仅观察 hook 彼此之间需要串行执行**：对外部副作用使用 runtime 提供的幂等 key，或合并为单一 hook。不存在 `OBSERVE_SERIAL` effect；如果该模式变得普遍，未来的 OpenSpec change 可以引入子阶段或串行观察 effect。

## 取舍（Trade-offs）

- **简单性**：effect 模型保持二元（并行观察 vs 串行影响）。没有子阶段，没有条件化执行策略。
- **安全性**：跨组依赖在编译期被捕获，而不是被静默忽略。
- **表达力缺口**："变更后观察"和"串行观察"需要替代做法。对电信治理场景（审计、合规、脱敏）而言，观察与影响通常被清晰分离，因此该缺口可接受。
- **未来扩展性**：如果"变更后观察"成为常见模式，未来 change 可以引入 stage 子阶段（`observe-pre` / `impact` / `observe-post`）而不破坏既有 effect 模型。

## 结果（Consequences）

- Assembly 编译器 MUST 校验跨 effect 组顺序目标并 fail closed。
- Runtime executor 在物化缺少 assembly 编译器校验的 hook 快照时，MUST 也进行校验以作为纵深防御。
- 仅观察 hook 的 `HOOK_INVOKED` 证据 MAY 记录顺序约束用于诊断。
- `mutationSummary` MUST 只为 runtime 实际应用的变更产生；返回被忽略变更的仅观察 hook MUST NOT 产生 `mutationSummary`。
