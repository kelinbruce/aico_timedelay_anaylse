## Why

共享知识使用者当前只能看到发布者的稳定用户标识，无法在列表和详情中辨认便于阅读的用户名。平台集成方也没有一个可由 LOCAL 与 REMOTE 部署共同实现和注册的用户查询契约；如果各消费场景自行查询用户信息，会形成环境相关接口和身份处理分支。

系统需要提供统一、可选择并可验证的用户查询 Gateway：LOCAL 部署提供确定性的默认用户名，REMOTE 部署允许产品集成方注册同一契约的远端实现。共享知识管理在保留发布者稳定标识的同时使用该能力展示用户名，并在运行期查询失败时保持列表可用。

本 change 依赖已完成的 `add-ts-long-memory-manage`，并在其归档形成 `long-memory-web-management` stable spec 后归档；两者按顺序修改同一管理 Function，不作为并行竞争实现。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 平台集成方可以通过受信 Gateway provider 为 LOCAL 或 REMOTE 部署注册用户查询能力；启动期选择、完整性校验、冲突检测和 readiness 与现有正式 Gateway 一致。
- 用户查询以可信租户和调用者身份为授权上下文，批量接收目标用户标识并返回对应用户名；响应不得包含未请求用户。
- LOCAL 默认部署无需额外配置即可查询用户，并为每个目标用户返回 `${subjectId}-name`。
- 共享知识列表和详情保留发布者用户标识，并在用户查询成功时优先展示用户名；查询失败或目标用户缺失时回退展示用户标识。

**非目标：**

- 本 change 不实现 REMOTE HTTP adapter，不规定远端 URI、认证 header、wire DTO 或供应商错误映射；REMOTE 产品集成方在其他实现仓提供 adapter。
- 本 change 不提供用户搜索、用户修改、组织关系、邮箱、手机号、头像或权限管理。
- 本 change 不改变共享知识的发布、撤销发布、复制、Owner Scope 或 Agent Scope 语义。
- 本 change 不把用户查询归入 Working Memory 或 Long-term Memory persistence binding，也不新增用户持久化表。

## What Changes

- 新增环境中立的用户查询公共契约，输入包含可信 Owner Scope 和一组目标用户标识，输出只包含目标集合中已解析的用户标识与用户名，并接受可选取消信号。
- 新增正式 `user-query` Gateway adapter。LOCAL 默认配置选择该 adapter 并提供确定性默认结果；REMOTE 配置选择后必须由受信 provider 提供同一契约的 binding，否则应用在 ready 前失败。
- 修改共享知识管理结果，在既有发布者用户标识之外提供可选发布者用户名；用户查询普通失败或单个用户缺失时，共享知识内容继续返回并使用用户标识作为展示回退。
- 修改共享知识界面，在用户名可用时显示用户名，否则显示发布者用户标识。

## Feature 影响（Features）

### 修改的 Feature

- `F-8.2 长期记忆`：共享知识管理增加发布者用户名展示，同时保留稳定用户标识和查询失败时的可用性保证；Function 组成不变。
- `F-10.5 集成外部系统`：平台集成方可以为用户查询注册 LOCAL 或 REMOTE Gateway provider；Function 组成不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.5 集成外部系统` → `specs/gateway-configuration/spec.md`
  - 功能边界：稳定 Gateway adapter 集合增加 `user-query`；系统在启动期选择并校验其 provider 和 binding，LOCAL 默认部署提供可用实现，REMOTE 部署由受信集成方提供实现。
  - 系统质量属性：无新增黑盒系统质量属性；实现继续遵守既有安全、可靠性和测试门禁。
  - 映射说明：`gateway-configuration` 是 canonical spec；本 change 不触及 legacy spec。
- `FN-8.15 管理长期记忆` → `specs/long-memory-web-management/spec.md`
  - 功能边界：共享知识管理结果保留发布者稳定标识，并增加可选用户名展示及运行期失败回退。
  - 系统质量属性：无新增黑盒系统质量属性；实现继续遵守既有可靠性和测试门禁。
  - 映射说明：`long-memory-web-management` 是由前置 change `add-ts-long-memory-manage` 建立的 canonical spec；本 change 按顺序追加 Requirement，不触及 legacy spec。

## 影响范围（Impact）

- 公共 Gateway contract、Gateway adapter 配置稳定集合以及 provider binding 合并规则增加用户查询能力。
- LOCAL 默认部署新增一个无外部依赖的用户查询 provider 行为；REMOTE 部署在显式选择 `user-query` 后需要产品集成方注册对应 provider。
- 长期记忆 management view 和 Web response 增加可选发布者用户名字段，既有发布者用户标识保持不变。
- 共享知识列表和详情的展示、Gateway 配置契约测试、composition 测试、长期记忆管理测试及前端测试受到影响。
