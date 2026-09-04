# ADR: Message 拥有可恢复过程 body

## 状态（Status）

Accepted.

## 背景与现状（Context）

Tool 轮次解释、Tool 调用和 Tool 结果是持久 `SessionMessage` 事实，而其执行顺序和生命周期是持久 timeline 事实。把同一公开 body 同时持久化在两个事实中会产生两个恢复权威、重复渲染、不一致的脱敏，以及 history 加载或 session fork 期间的不安全回退。

## 决策（Decision）

当公开过程内容存在持久 message 时，该 message 是其唯一的可恢复 body。Producer 必须在发布可恢复 event 之前 append 该 message。Event 只存储自身的顺序/状态坐标和一个强 `messageId`；它绝不存储可恢复 body、Tool 参数或 Tool 结果副本。

Runtime 只通过一个仅服务端的、Owner/Agent/session/request/run 范围的有界查询解析引用。Channel live 和 history 路径使用同一个安全 event/message projector。非法或歧义引用降级为 status-only 的 `contentUnavailable` 结果，绝不读取 legacy event body、另一个 message、浏览器缓存或 Tool 本地状态。Fork 在原子子 composite 之前把每个持久引用重映射到被复制的子 message；不安全映射使 fork abort。

Live-only delta 保持为临时呈现输入。最终 Assistant Message 和已完成 thinking 保持既有 owner。不引入公开的隐藏 message 路由、Gateway port、Record、表或远程协议。

受治理的 `TOOL_STRUCTURED_DELTA` 有一个封闭的过渡性呈现例外。Runtime 可以持久化一个有界、保形态的 Event 快照，唯一目的是让 Channel/Web 在 live 和冷 history 中渲染同一结构化呈现。Canonical `CAPABILITY_RESULT` Message 仍是语义结果和 model-context 权威；该快照不得进入 Context、terminal truth、完成限制或 fork/model 权限。对普通已完成结果，Message 在私有快照 flush 之前 append，history 为同一 run/tool 选择合格的 Event 快照或 Message 派生的兼容呈现之一，绝不两者并存。Workflow 内部完成产物仍是单独的 Event 拥有的过程产物例外；terminal Assistant 内容仍由 Message 拥有。

该例外有明确的退出条件：当 canonical Message 契约可以承载独立治理的最终呈现投影时，Event body 被移除，Channel/history 迁移到该 Message 拥有的投影。本 ADR 不定义那个未来的 envelope、披露策略或存储引用。

## 结果（Consequences）

- Live、冷 history 和子拥有的 fork 快照恢复同一公开 body，无需持久双重写入。
- Message append 失败不会留下可恢复的孤儿引用。
- 旧 event 只通过严格唯一的有限匹配恢复；歧义 history 牺牲的是 body 可用性，而不是正确性或隔离性。
- 一个回退到引用感知 projector 之前的读取者可能看到 status-only 过程 history，但回滚不得恢复 event body 双重写入。
- 本地 timeline store 可以新增私有的 run 范围索引，而不改变 Gateway contract。
- 过渡期内，结构化呈现物理上重复，但只有一个语义权威；可信的 `truncated=true` 标记记录呈现损失，绝不改变 canonical Message 结果。
