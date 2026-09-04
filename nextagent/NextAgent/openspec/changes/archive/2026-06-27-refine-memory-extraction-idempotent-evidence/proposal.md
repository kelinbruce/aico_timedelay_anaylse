# refine-memory-extraction-idempotent-evidence

## 背景与问题（Why）

Memory dreaming 扫描最近的 `lookbackDays` 窗口。重跑同一窗口可能从相同的任务轨迹 source ref 产生等价候选。当前融合路径可能把这些重复 ref 当作新佐证，即使没有新增独立 evidence 也提升 confidence。

## 变更范围（What Changes）

- 让 memory 抽取 evidence 融合按 source evidence 幂等。
- 判断某个 source ref 是否已被代表时忽略 `extractionCycleId`。
- 融合时仅当候选新增至少一个 source ref 才保存既有 memory。
- 仅当候选新增独立 source evidence 时才提升 confidence，重处理同一轨迹不提升。

## 影响范围（Impact）

- 受影响 package：`agent-memory`
- 受影响 spec：`memory-extraction`
- 不改变 gateway contract 形态、持久化 schema、Web API 或 stream event。
