## Why

平台集成方在 REMOTE 部署中调用会话派生时，NextAgent 当前需要先取得源会话截至锚点的完整持久化消息前缀，再把预构造的子会话事实发送给 REMOTE WorkingMemory（AgentMemory）。长会话会使跨服务请求随历史长度增长，可能超过远端服务或中间网络设施支持的请求大小。LOCAL 与 REMOTE 若使用不同创建契约，也会形成两套集成与验收边界。

Working Memory provider 已经持有 session、message、request/run、active context 和过程事件等事实。会话派生不应传输这些完整历史，只提交可信源坐标；若前缀引用 provider 无法直接读取的规范化工具结果，则额外传输由 provider 发现且受预算约束的对应内容。选定的 Working Memory provider 在数据本地完成事实复制和原子提交。

## 术语

- **provider-owned fork materialization**：NextAgent 先以可信 owner scope、Agent Scope、源会话、独立的源消息或源请求锚点及幂等键取得有界 ref 准备清单，只处理清单中的 execution-bound 内容，再由选定 Working Memory provider 读取完整源事实并原子产生 child session。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- LOCAL 与 REMOTE 部署通过同一套“准备清单、暂存清单内容、最终原子创建”契约完成派生，并获得相同形态的 child session 结果。
- Working Memory provider 在自身数据边界内读取从源会话开头到最终消息锚点的完整持久化前缀；NextAgent 不读取或传输完整前缀及预构造 child facts。
- 消息锚点和请求锚点使用两个独立 optional 字段表达，每次调用恰好提供一个；请求锚点由 Working Memory provider 唯一解析为符合资格的持久化 assistant message。
- 准备操作只返回有界的 execution-bound ref 清单和 fork attempt，不创建可见 child；NextAgent 通过既有可信内容访问边界读取清单内容并暂存到选定 Working Memory provider。
- 最终创建操作校验同一 attempt 所需 ref 已全部准备完成，重写为 child-accessible durable refs，并原子创建 child；不增加第二个最终确认操作。
- Working Memory provider 复制其拥有的 session、message、request/run、active context、process snapshot 和 fork source 等事实，并保持完整前缀、child-owned identity、原子提交、幂等重放和安全失败语义。
- LOCAL SQLite Working Memory 与 REMOTE AgentMemory 对相同输入满足同一组 contract tests。

**非目标：**

- 不要求 REMOTE WorkingMemory 直接访问 NextAgent execution workspace；仅 NextAgent 通过既有可信内容访问边界读取规范化 `tool-results/<refId>` 内容。
- 不新增第二个最终确认操作、generic host-file read、任意路径上传或第二套 ref 复制协议。source run workspace path、host path、未知 execution-bound ref 仍在 child 可见前安全失败。
- 不新增附件记录复制或重绑能力。已经 owner+agent scoped 且按既有读取规则对 child 可访问的 durable attachment/artifact ref 可继续保留；其余 ref 安全失败。继承附件的后续 retry/edit 继续遵守既有重新校验规则。
- 不改变 Web 会话派生 route、request body、成功 response schema、派生按钮条件、用户可见标题、fork notice、conversation 内容或后续 child session 行为；fork failure `error.message` 的统一属于下述显式变化。
- 不新增 LOCAL 专用或 REMOTE 专用的平行 fork contract。
- 不改变既有已提交 fork/promoted content 的读取结果，也不改变普通 active context append、compaction、request lifecycle 或 terminal commit。
- 不在本代码仓实现 REMOTE WorkingMemory 的服务端 fork 逻辑或 transport；本仓只发布公共契约、NextAgent 调用侧、LOCAL SQLite 实现、共享 conformance 资产和外部实现指导。

## What Changes

- **BREAKING**：会话派生 gateway 创建契约从“调用方取得完整前缀并提交预构造 child facts”调整为“准备清单、暂存清单内容、最终原子创建”。跨 provider 只传可信坐标、有界 ref 清单对应的内容和 fork attempt，不传完整前缀。
- **BREAKING**：旧的公共 prefix query、成功幂等预查、预构造 composite write和批量过程状态不再属于公共契约；既有 promotion stage/abort/read/cleanup 继续保留并绑定 prepare attempt。
- 规范化 `tool-results/<refId>` 继续由 NextAgent 的可信内容访问边界读取并通过 Working Memory 内容暂存边界保存；最终创建操作原子提交 child 与对应 promoted content。无法安全解析或不在准备清单中的 ref 安全失败。
- **BREAKING**：成功、校验失败、资源超限、取消和服务不可用在 LOCAL 与 REMOTE 下使用相同结果类别、安全错误语义与重试含义。
- **BREAKING**：所有会话派生失败的 Web `error.message` 统一为 `Session fork failed.`；既有 HTTP status、error envelope shape 和 `error.code` 保持。
- Web 面向消息和请求的既有派生入口继续通过 Runtime-owned 窄命令工作；Runtime 完成 trusted scope/session 校验和 prepare 清单内的可信内容解析，不读取完整历史，也不按部署模式分支。
- 保留 fork 创建后仍由会话读取、过程历史恢复、模型上下文内容解析和维护任务消费的窄读取或维护能力。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.11 从消息派生子会话` → `specs/session-fork-from-message/spec.md`
  - 功能边界：会话派生改为先取得有界 ref 准备清单、由 NextAgent 完成清单内内容 promotion，再由 selected Working Memory provider 返回完整 child；消息锚点、请求锚点、LOCAL 与 REMOTE 使用同一契约。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可测试性。
  - 映射说明：canonical spec；本 change 同时收敛 `ts-core-contracts` 中被触及的 legacy fork contract Requirements。
- `FN-8.1 持久化运行数据` → `specs/gateway-store-provider-ownership/spec.md`
  - 功能边界：selected Working Memory provider 从接收预构造派生材料调整为准备有界 ref 清单、接收对应 staged content，并依据可信 source 坐标原子产生全部 child WorkingMemory facts；LOCAL 与 REMOTE 对调用方提供同一行为。
  - 映射说明：canonical spec 为 `gateway-store-provider-ownership`。

## Feature 影响

### 修改的 Feature

- `F-1.6 基于历史回复新建会话`
  - 用户仍可从页面上具有可用 assistant/request anchor 和回答内容的轮次发起派生。
  - 当完整源前缀包含可由既有可信 resolver 解析的规范化工具结果 ref 时，系统先准备并暂存对应内容，再完成派生；无法安全读取的路径或未知 ref 仍显示既有通用失败提示。
  - 页面不新增 ref 或附件预判，也不改变派生按钮的展示、权限和 busy 条件。

## 影响范围（Impact）

- 外部 REMOTE AgentMemory 在其现有 fork gateway 基础上新增准备与最终创建能力，并调整既有 stage/abort 的 attempt 绑定；现有创建后读取与清理逻辑继续复用。该实现不在本代码仓交付，也不需要直接访问 NextAgent execution workspace。
- NextAgent 的会话派生入口、`WorkingMemoryGatewayBindings.sessionForks`公共契约、可信内容解析调用、LOCAL provider 和 fork 测试需要切换到新流程。
- 准备结果与暂存内容受既有 ref 数量和 bytes 预算约束；页面不增加 ref 预判，客户端继续处理既有 fork failure。
- 会话派生是长耗时远程操作，调用链传递取消信号，并通过幂等键恢复提交后响应丢失的结果。
- 既有容量上限继续作为 Working Memory provider 内部派生预算生效。
- 本 change 直接基于当前`WorkingMemoryGatewayBindings`、LOCAL SQLite和外部REMOTE注入模式实施；后续`refine-ts-agent-gateway-state-store-boundary`负责把已完成的fork contract与实现迁入最终StateStore命名和binding，不反向阻塞本change。
- 本 change 修改 frozen `agent-contracts`；完成契约升级确认与 roadmap 准入前只能保留为 proposed artifact，不得实施。
