## MODIFIED Requirements

### Requirement: Python tool 只通过 sandbox gateway 执行

Python tool 执行已经经由 sandbox gateway 路由，且不使用 tool 私有的命令 allowlist。在 Bash 可执行策略被委托给 sandbox gateway 策略的同时，该行为 SHALL 保持不变。

当一次 Python 调用在 LOCAL deployment 模式下通过显式 root 限定路径引用 `shared-data/...`，且 sandbox request 包含本地只读共享数据根时，文件系统访问 MUST 受与 Bash 和内建 file tool 相同的 sandbox filesystem 映射治理。Python tool 实现 MUST NOT 把 `shared-data/` 加入 Python 模块搜索路径、`PYTHONPATH`、当前解释器状态、package 发现或隐式 import 解析。REMOTE/PaaS Python 执行在本 capability 请求本地 `shared-data/...` 访问时，MUST 在 sandbox 调用之前失败。

#### Scenario: Python 保持独立于 Bash 命令策略

- **WHEN** Bash 命令策略所有权发生变化
- **THEN** Python tool 调用 MUST 继续经由 Python tool handler 路由
- **AND** Python 输入 MUST NOT 使用 Bash 命令规则解析或授权

#### Scenario: Python 片段通过显式路径读取共享数据

- **WHEN** Python 代码打开 `shared-data/cases/alarm.json`
- **AND** 本地 sandbox filesystem 把 `shared-data/` 作为只读 root 包含在内
- **THEN** 该读取 MUST 受 sandbox filesystem root 映射治理
- **AND** 向 `shared-data/` 之下写入的尝试 MUST 失败或被置为只读

#### Scenario: 共享数据不会成为 import 搜索路径

- **WHEN** `shared-data/scripts/helper.py` 存在
- **AND** Python 代码执行 `import helper` 而未通过代码显式添加已授权路径
- **THEN** Python tool MUST NOT 仅因该文件存在于 `shared-data/` 之下而使该 import 成功
- **AND** `shared-data/` MUST NOT 被注入 `PYTHONPATH`
