## Why

运维人员未启用调测插件、系统也没有接受任何插件开发诊断记录时，日志目录仍会出现空的 `nextagent-plugin-diagnostic` 文件，并在后续启动中形成解压后仍为空的 gzip archive。这些空产物会造成“插件诊断已经开启或产生了数据”的错误判断，也产生没有诊断价值的文件和压缩维护开销。插件开发诊断物理产物应由实际记录触发，而不是由应用启动触发。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 没有任何合法插件开发诊断记录被接受、且不存在历史文件族成员时，系统不创建该文件族的 active segment 或空压缩产物。
- 应用启动后继续维护已经存在的精确所属历史文件，确保压缩、保留期限和 archive 数量上限不会因当前进程没有新记录而失效；该维护不得创建 active segment。
- 第一条合法记录仍获得与后续记录一致的 `ACCEPTED`/`DROPPED` 结果、可信插件身份绑定、容量限制、隔离边界和文件生命周期保证。
- 插件诊断 sink 在受支持部署模式中继续默认可写；Agent activation 继续决定内置调测插件是否生成记录。

**非目标：**

- 不新增 `developerDiagnostics` 或其他 artifact 输出配置开关。
- 不改变插件输入、物理记录 schema、文件名、目录、轮转阈值、压缩格式、保留期限或 archive 数量上限。
- 不改变 operational、audit、metrics 文件族，也不改变插件 Hook activation 或执行语义。

## What Changes

- 修改插件开发诊断物理产物的触发边界：仅在系统接受第一条合法记录时创建 active segment；应用启动、flush 或从未写入的关闭过程不得产生空 active segment 或由该空 segment 形成的压缩产物。
- 将历史文件 maintenance 与 active destination 解耦：应用启动后只维护已经存在的精确所属成员，首条合法记录到来后再切换到包含 active destination 的完整 lifecycle。
- 明确 sink 默认可写且没有独立 artifact 输出配置开关；未激活内置调测插件时不生成记录，未接受记录时不产生物理文件副作用。
- 保持第一条记录触发后的既有异步写入、轮转、压缩、保留、失败隔离和安全状态语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.32 管理插件开发诊断产物` → `specs/plugin-developer-diagnostic-artifacts/spec.md`
  - 功能边界：active destination 从应用启动触发收敛为第一条合法记录触发；无历史成员且无记录时不产生空文件或空压缩产物，历史成员仍受既有有界 lifecycle 维护。
  - 系统质量属性：性能/容量、安全。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 运维人员在日志目录中只会看到由实际已接受记录形成的插件开发诊断内容，不再看到进程启动产生的空产物；既有历史成员仍可能按既有规则被压缩或删除。
- 插件开发者继续使用相同 sink 和返回结果，不需要修改插件或 Agent activation 配置。
- 系统配置 schema 和公共 API 不变；实现与测试将集中在插件开发诊断 writer、共享文件轮转边界及其 composition lifecycle。
