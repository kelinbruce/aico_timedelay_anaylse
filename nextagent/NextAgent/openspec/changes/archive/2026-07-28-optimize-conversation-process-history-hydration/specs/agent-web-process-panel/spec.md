## ADDED Requirements

### Requirement: 冷历史加载保持稳定的 process 入口

对一个带所选展示 run 的已完成历史 turn，agent-web MUST 在 event history 加载期间保持任何既有的折叠 process 入口标题和行几何稳定。当 message 派生的 process 事实尚不要求入口时，后台加载 MUST NOT 在该 run 进入 `LOADING` 满 300 毫秒之前创建一个仅加载中的行。在该边界之前到达 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE` 的后台加载 MUST NOT 显示瞬态的加载标签。若该 run 在 300 毫秒时仍为 `LOADING`，折叠入口 MUST 使用稳定的 process 标题和行高，并 MUST 在标题旁显示非文本加载指示。

当用户在 event history 可用之前展开 process 入口时，panel 主体 MUST 显示本地化的历史加载消息，且该 run MUST 获得显式用户 hydration 优先级。在存活的 session 中，普通的折叠、移出屏幕过渡或较新的交互 generation MUST NOT 取消一个已启动的请求。排队中或未启动的展开 generation 只 MAY 被十六个显式意图容量规则替换；替换 MUST 释放该 generation 的 demand/pin 而不改变展开状态。若仍展开的 turn 稍后重新变为 demand 合格，它 MUST 创建新的 generation。每个正常收敛的活动请求 MUST 释放其活动请求 pin。当 session、活动身份和校验守卫通过时，来自过期交互 generation 的结果 MUST 只更新其 run 作用域缓存，MUST NOT 重新打开 panel、恢复旧的展开/导航意图或移动 viewport。Session 拆除 MUST 取消排队中/在途工作，并 MUST NOT 创建新的可见加载结果。

#### Scenario: 快速后台 hydration 不闪烁加载文本
- **GIVEN** 一个已完成历史 turn 没有缓存的 event history 且其 process 入口处于折叠状态
- **WHEN** hydration 进入 `LOADING` 并在 300 毫秒内到达 `AVAILABLE`
- **THEN** 既有的标题行 MUST NOT 显示本地化的历史加载文本
- **AND** 缺失的标题行 MUST NOT 仅为显示加载而被创建
- **AND** 用户展开 panel 时已完成的 process MUST 可用

#### Scenario: 缓慢的后台 hydration 保留标题
- **GIVEN** 一个已完成历史 turn 保持 `LOADING` 至少 300 毫秒
- **WHEN** 其 process 入口处于折叠状态
- **THEN** 入口标题 MUST 保持不变
- **AND** 任何可见的加载指示 MUST NOT 替换标题或改变行高

#### Scenario: 历史加载期间用户展开
- **WHEN** 用户展开一个所选 run 处于 `IDLE`、排队中或 `LOADING` 的已完成历史 turn
- **THEN** 该 run MUST 以显式用户 hydration 优先级被选中
- **AND** panel 主体 MUST 显示本地化的历史加载消息直到终态加载结果到达
- **AND** 已提交的最终回答 MUST 在 panel 之外保持可见

#### Scenario: 展开中的加载原地成功
- **GIVEN** 用户已展开一个显示历史加载消息的 panel
- **WHEN** 该 run 变为 `AVAILABLE`
- **THEN** 同一 panel MUST 显示已完成的 process entry
- **AND** 折叠标题行 MUST NOT 被替换或以加载状态行重新挂载
- **AND** 展开显式目标和展开 pin MUST 被释放

#### Scenario: 历史加载失败
- **WHEN** 一个历史 run event 查询在校验或传输加载中失败
- **THEN** 已提交的最终回答 MUST 保持可见
- **AND** panel MUST 只暴露安全的 process-history 失败和重试操作
- **AND** 原始 parser、provider 或传输详情 MUST NOT 被显示
- **AND** 展开显式目标和展开 pin MUST 被释放

#### Scenario: 展开的 panel 在完成前被折叠或移出屏幕
- **GIVEN** 展开已为某个 run 启动了 event history 加载
- **WHEN** panel 在加载完成之前被折叠或其 turn 离开 viewport
- **THEN** 活动请求 MUST 继续到其唯一的加载结果
- **AND** 同一展开 MUST NOT 创建第二个请求

#### Scenario: 排队的展开被替换而不折叠展开状态
- **GIVEN** 一个展开的 panel 拥有最旧的排队中或未启动的显式 generation
- **WHEN** 较新的显式意图超过每 session 十六个的上限
- **THEN** frontend MUST 移除该最旧 generation 并释放其展开 demand/pin
- **AND** MUST 保持 panel 展开状态不变
- **WHEN** 仍展开的 turn 稍后重新进入 demand 合格状态
- **THEN** frontend MUST 在重新排队之前创建新的显式 generation

#### Scenario: Session 拆除取消加载而不产生 UI 结果
- **GIVEN** 一个 process panel 拥有排队中或活动的 event-history 工作
- **WHEN** 其 session 被清除或销毁
- **THEN** frontend MUST 取消该工作并释放所有相关的 demand/pin
- **AND** MUST NOT 产生 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE` 作为新的 panel 结果

#### Scenario: Legacy 历史是终态
- **WHEN** 一个展开的历史 run 到达 `LEGACY_UNAVAILABLE`
- **THEN** panel MUST 显示安全的终态不可用呈现
- **AND** 展开显式目标和展开 pin MUST 被释放
- **AND** panel MUST NOT 渲染重试控件或发出重试请求

#### Scenario: 展开状态在缓存逐出后保留
- **GIVEN** 一个展开的屏外 panel 已到达 `AVAILABLE` 且不再有其他 pin 来源
- **WHEN** 其整 run 缓存事实被容量强制逐出
- **THEN** panel 展开状态 MUST 保持展开
- **AND** 把该 turn 带回 viewport MUST 把该 run 重新加载进同一展开的 panel
