## ADDED Requirements

### Requirement: Skill 资源投影 SHALL 在每个服务进程内首次激活时刷新

对每个服务进程和执行 scope，受治理 Skill 资源投影身份的首次激活 SHALL 依据当前受治理的 `SKILL.md` 和符合条件的 `scripts/`、`references/`、`assets/` 资源重建已提交的投影，即使执行 workspace 中已存在来自先前进程的已提交投影 manifest。重建 SHALL 使用既有的锁、staging 校验和原子发布路径。同一 scope 和进程内同一身份的并发首次激活 SHALL 共享同一初始化，且 SHALL NOT 发布相互竞争的投影。

在该 scope 和进程内首次成功激活之后，同一投影身份的后续激活 SHALL 复用已提交的不可变投影，而不重新枚举或重新复制源资源。进程持续运行期间本地 Skill source 的变更 SHALL NOT 改变投影；运维者 MUST 重启服务或使用未来的显式刷新能力。

#### Scenario: 重启后的服务刷新被编辑的 Skill 脚本路径

- **WHEN** 一个先前的服务进程曾以版本 `unversioned` 投影一个受治理 Skill，其 `SKILL.md` 指向执行 `scripts/query.py`
- **AND** 运维者在服务重启之前修改该受治理 Skill，使 `SKILL.md` 指向执行 `scripts/query1.py`，删除 `scripts/query.py` 并新增 `scripts/query1.py`，且不改变 Skill 版本
- **AND** 一个新的服务进程使用同一执行 workspace 首次激活该 Skill
- **THEN** 返回的 Skill 资源根 SHALL 包含 `scripts/query1.py`
- **AND** 它 SHALL NOT 包含 `scripts/query.py`

#### Scenario: 同一进程内的后续激活复用已刷新的投影

- **WHEN** 一个服务进程已成功完成某个受治理 Skill 投影身份的首次激活
- **AND** 该进程的源资源保持不变
- **WHEN** 同一 Skill 再次被激活
- **THEN** 系统 SHALL 复用已提交的投影，而不再次列举或读取源资源
