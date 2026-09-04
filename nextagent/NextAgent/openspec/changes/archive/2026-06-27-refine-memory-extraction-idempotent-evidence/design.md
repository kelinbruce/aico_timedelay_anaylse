# 设计（Design）

## 决策（Decision）

`lookbackDays` 仍是输入选择窗口，不是 evidence 唯一性边界。对相同任务轨迹重新处理时，抽取融合必须幂等。

抽取编排器在为既有 record 调用 `saveLongTermMemory` 之前，会先比较候选 source ref 与既有 memory source ref。

## Evidence 身份（Evidence Identity）

Source evidence 身份包括：

- `sessionId`
- `rootMessageId`
- `runId`
- 排序后的 `messageRefs`

它显式排除 `extractionCycleId`。对同一轨迹的新一轮 dreaming 不应让 evidence 变新。

## 置信度佐证（Confidence Corroboration）

保存 source ref 与提升 confidence 是两个独立决策：

- 若没有候选 source ref 是新的，跳过融合。
- 若 source ref 是新的，但来自已被代表的 source group，可以合并 ref，但不提升 confidence。
- 若 source ref 是新的且来自新的 source group，可以按既有的有界佐证规则提升 confidence。

Source group 包括 `sessionId`、`rootMessageId` 和 `runId`。这避免同一 run 的重复消息推高 confidence，同时仍允许跨 run 或跨 session 佐证。

## 非目标（Non-goals）

- 不新增 processed-marker 表。
- 不改变 scheduler checkpoint。
- 不改变搜索/访问遥测。
- 不改变 memory gateway 公共 contract。
