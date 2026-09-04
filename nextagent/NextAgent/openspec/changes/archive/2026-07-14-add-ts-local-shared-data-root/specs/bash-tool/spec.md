## MODIFIED Requirements

### Requirement: Bash 以 workspace 为 scope 且网络 CLI 被拒绝

可执行文件的拒绝决策 SHALL 由 sandbox gateway denylist policy 或更强的平台 sandbox 执行机制来实施。Bash MAY 提供模型指引，但 MUST NOT 成为可执行策略的最终安全边界。Root 感知路径约束、文件系统 root 检查、环境校验和文件类型检查 MUST 从 sandbox filesystem layout 和平台 sandbox 边界推导，而不是来自 Bash 私有的 root allowlist。

Bash MAY 仅在 LOCAL deployment 模式下，且仅当 sandbox request 包含已授权的 `shared-data/` root 时，向 sandbox gateway 提交显式 root 限定的共享数据路径，例如 `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json`。Bash MUST NOT 把 `shared-data/` 加入 `PATH`、`PYTHONPATH`、隐式可执行查找或命令发现，并且 MUST NOT 把 `shared-data/` 之下的文件当作无需显式解释器即可直接执行的文件。

#### Scenario: 被拒绝的可执行文件被 sandbox 策略拒绝

- **WHEN** Bash 提交一个位于已配置 denylist 中的可执行文件
- **THEN** sandbox gateway MUST 安全地拒绝该请求
- **AND** 面向 capability 的结果 MUST 保留安全的 sandbox 拒绝原因

#### Scenario: 未被拒绝的 shell 组合仍归 gateway 所有

- **WHEN** Bash 提交一条不在已配置 denylist 中的确定性分词 shell 组合命令
- **THEN** 策略所有权 MUST 保持在 sandbox gateway 边界
- **AND** Bash MUST NOT 为 shell 组合增加第二条命令类别拒绝路径

#### Scenario: Bash 通过显式路径运行共享 Python 脚本

- **WHEN** Bash 提交 `python shared-data/scripts/diagnose.py --case shared-data/cases/alarm.json`
- **AND** 本地 sandbox filesystem 把 `shared-data/` 作为只读 root 包含在内
- **THEN** Bash MUST 通过 sandbox dependency 提交解析后的命令
- **AND** 脚本路径和 case 路径 MUST 由 sandbox filesystem root 映射解析
- **AND** Bash MUST NOT 在 model 可见输出或安全诊断中把该命令改写为宿主绝对路径

#### Scenario: 共享数据不会成为命令搜索路径

- **WHEN** `shared-data/scripts/diagnose.py` 存在
- **AND** Bash 提交 `diagnose.py`
- **THEN** Bash MUST NOT 从 `shared-data/` 解析该命令
- **AND** sandbox gateway MUST 把它当作普通命令查找处理，不带 shared-data 搜索权限
