## ADDED Requirements

### Requirement: Agent execution trajectory inputs SHALL enter the shared observation stream

agent execution trajectory 新增的 turn、context assembly、capability selection、sandbox execution 和 user-visible output 对齐信号 MUST 通过现有 `ObservabilityObservationEvent` stream 进入 LOG / AUDIT / METRIC / TRACE surface。系统 MUST NOT 为这些轨迹点新增第二套 observability event carrier、per-surface bus、direct logger path 或 trace-private carrier。

当轨迹点已有 runtime-owned canonical 或 live-only timeline fact 时，observation mapper MUST 优先消费该事实；只有在对应事实由 wrapper 或 composition-time producer 才能安全获得时，才允许使用 approved wrapper / producer observation。

#### Scenario: Trajectory event uses the shared observation handoff
- **WHEN** turn、context assembly、capability selection、sandbox execution 或 visible output 对齐轨迹点被产生
- **THEN** 它 MUST 通过 `ObservabilityProjectorHost.acceptObservation(event)` 进入统一 observation stream
- **AND** 各 observability surface 从同一 observation 派生各自输出
- **AND** 系统 MUST NOT 为该轨迹点引入 direct wrapper-to-sink path
