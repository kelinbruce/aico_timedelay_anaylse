## ADDED Requirements

### Requirement: 所有宿主模式下 process history 行为完全一致

Local、immersive 与 collaborative 模式 SHALL 仅从共享的 chat/session 业务核心获取 process history hydration、message/event 组合、process entry 生命周期和手动覆盖。Host shell 和 PIU adapter MUST NOT 自行发起 run event 查询、维护平行的 process 缓存，或实现宿主特有的折叠规则。

#### Scenario: 在每个宿主中重新打开已完成的会话
- **WHEN** 同一已完成会话在 local、immersive 和 collaborative 模式下打开
- **THEN** 三种模式 MUST 通过共享 session service 为同一可见 run 集合请求 process event
- **AND** MUST 渲染等价的已完成 thinking 文本、capability process 顺序和最终回答
- **AND** MUST 初始以折叠状态呈现已完成的 process panel

#### Scenario: 实时 process 在每个宿主中完成
- **WHEN** 同一 stream fixture 在每种宿主模式下驱动一个从 thinking 经 capability 执行到最终回答的 run
- **THEN** 三种模式 MUST 以相同的状态结果自动展开 active entry、自动折叠已稳定的 entry 并自动折叠终态 panel
- **AND** 手动 entry 或 panel 覆盖在每种模式下 MUST 具有相同的作用域和优先级

#### Scenario: 检视宿主实现
- **WHEN** 检视三个宿主入口和 adapter
- **THEN** run event HTTP 调用和 process hydration 状态 MUST 只存在于共享的 agent-web service/store 路径
- **AND** process 折叠行为 MUST 只存在于共享的 `ProcessPanel`
