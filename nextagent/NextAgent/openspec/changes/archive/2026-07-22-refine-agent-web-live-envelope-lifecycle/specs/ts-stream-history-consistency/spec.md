## ADDED Requirements

### Requirement: 已接受的 live process 详情 SHALL 在终态与历史合并期间保持稳定

TS frontend MUST 区分已提交的会话事实与 live process 呈现。可见的 `SessionMessage` 历史 MUST 保持为已提交 user 内容、最终 assistant 内容、最终 capability 结果和消息可见性的来源。当前页面生命周期内接受的 live stream 数据 MUST 保持为 thinking、capability 执行、process timeline 以及可见历史无法安全重建的仅 live 结构化详情的来源。普通终态处理和普通匹配历史合并 MUST NOT 替换、移除或复制这些已接受的 process 详情。

#### Scenario: 终态收敛 live 呈现而无需会话刷新
- **WHEN** frontend 为活动 request 接受一个 terminal envelope
- **THEN** 它 MUST 在一次可观察的状态迁移中收敛该 request 并保留已接受的 live process 呈现
- **AND** Turn MUST NOT 在活动状态和已稳定状态之间消失
- **AND** frontend MUST NOT 启动普通的终态触发的会话刷新

#### Scenario: 已提交历史加载前已稳定的 Turn 保持可见
- **GIVEN** 一个 request 在当前页面生命周期内已到达终态
- **AND** 当前会话历史窗口尚未包含其 root 消息
- **WHEN** 用户在不刷新页面的情况下继续使用同一 session
- **THEN** 已稳定的 live 投影 MUST 继续提供 frontend 已接受的完整可见 Turn
- **AND** 后续 request MUST NOT 移除该 Turn

#### Scenario: 匹配历史提供最终内容而不移除 process 详情
- **GIVEN** 当前页面已为某个 root 消息保留已稳定的 live process 详情
- **WHEN** 会话加载、打开时调和、手动刷新或间隙恢复返回同一 root 的可见已提交消息
- **THEN** user 消息、最终 assistant 内容、最终 capability 结果和可见性 MUST 从已提交历史投影
- **AND** 已接受的 thinking、capability 执行、process timeline 和仅 live 结构化详情 MUST 从已稳定的 live 投影保持可用
- **AND** frontend MUST 为该 root 渲染一个 Turn 和一个最终回答

#### Scenario: Canonical 不可见性抑制保留的 live 投影
- **GIVEN** frontend 为某个 root 消息保留了活动或已稳定的 live 数据
- **WHEN** 已提交会话历史把该 root 标记为不可见，或一次成功的 edit/supersede 操作使该 root 不可见
- **THEN** frontend MUST NOT 从保留的 live 数据渲染该 root
- **AND** 重试、编辑回滚或后继投影 MUST 继续遵循既有的最新 attempt 和可见性语义

#### Scenario: 页面重载从可见消息重建最终历史
- **WHEN** 用户重载页面或 frontend 不再保留会话缓存
- **THEN** 已提交会话内容 MUST 从可见 `SessionMessage` 历史重建
- **AND** frontend MUST NOT 把先前页面生命周期的已稳定 live 缓存当作持久化历史

#### Scenario: 迟到的身份接受与重放不分裂或截断已稳定的 Turn
- **GIVEN** frontend 已在乐观或临时的 request 身份下接受 live 详情
- **AND** 在 pending request 能被安全识别之前，一个 terminal envelope 可能已把匹配的 attempt 移入保留的已稳定呈现
- **WHEN** 后端接受的 root 身份在 live 详情或 terminal 投递之后到达
- **THEN** frontend MUST 把保留的详情调和到被接受的 root 而不渲染两个 Turn
- **AND** frontend MUST 针对该确切的 session、root 和 attempt 重新评估保留的终态，使匹配的 pending request 能够收敛
- **AND** 同一 attempt 的重复 terminal 或重放 event MUST NOT 以仅终态投影替换完整的已稳定呈现
- **AND** 来自较旧 attempt 的迟到 event MUST NOT 替换当前选择的较新 attempt
