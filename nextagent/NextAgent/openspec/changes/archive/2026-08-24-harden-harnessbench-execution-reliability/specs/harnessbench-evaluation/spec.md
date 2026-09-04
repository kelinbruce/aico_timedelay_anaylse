## Function

- **所属 Function**：`FN-10.13 HarnessBench 评测`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 候选模型调用与任务执行采用分层预算

系统 MUST 为全量和定向 HarnessBench 运行生成隔离 candidate，并将该 candidate 的每次模型调用预算固定为 `300,000 ms`；HarnessBench generic CLI adapter 的 task 进程预算与 NextAgent 已接受请求的 terminal 等待预算 MUST 分别固定为 `600 s`。单次模型调用达到模型调用预算时，系统 MUST 以模型调用超时结束该次调用；已接受请求的 terminal 等待达到 `600 s` 时，系统 MUST 取消该请求并以 `timed_out` 形成终态结论。

**需求类别**：系统质量属性
**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: 长模型调用在任务总预算内继续执行

- **WHEN** 一个状态为 `execute` 的 task 发起单次耗时超过 `120,000 ms` 且小于 `300,000 ms` 的模型调用
- **THEN** 系统 MUST NOT 因旧的 `120,000 ms` 预算终止该次模型调用
- **AND** task MUST 继续受 `600 s` 总执行预算约束

#### Scenario: 任务总预算仍然生效

- **WHEN** 一个状态为 `execute` 的 task 已接受请求且等待 terminal result 达到 `600 s`
- **THEN** 系统 MUST 取消该 task 已接受但未终止的请求
- **AND** task MUST 以 `timed_out` 和 `taskScore=0` 形成终态结论

### Requirement: 本机 mock endpoint 不依赖公网 tunnel

系统 MUST 为状态为 `execute` 且依赖 HarnessBench 本机 mock HTTP endpoint 的 task 提供该 endpoint 的本机可达 URL。标准评测运行 MUST 将 `HARNESSBENCH_PUBLIC_URL_TEMPLATE` 固定为 `{local_url}`，MUST 以该值覆盖调用者进程中的同名环境变量，并且 MUST NOT 要求安装或启动公网 tunnel 工具。

**需求类别**：系统质量属性
**质量属性**：可测试性
**适用范围**：该 Function

#### Scenario: 本机 mock endpoint 直接暴露

- **WHEN** 一个状态为 `execute` 的 task 启动 HarnessBench 本机 mock HTTP endpoint
- **THEN** task hook MUST 取得该 endpoint 的本机 URL
- **AND** 系统 MUST NOT 启动公网 tunnel 进程

#### Scenario: 外部模板不得重定向标准评测

- **WHEN** 调用者进程已设置其他 `HARNESSBENCH_PUBLIC_URL_TEMPLATE` 值
- **THEN** 标准评测传给 task hook 的值 MUST 仍为 `{local_url}`
- **AND** task MUST 继续使用本机 mock HTTP endpoint

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统以分层预算执行 task，并把依赖 mock HTTP endpoint 的 execute task 直接连接到同机 endpoint。
- **依据 Requirements**：`候选模型调用与任务执行采用分层预算`、`本机 mock endpoint 不依赖公网 tunnel`

### 规格

- **规格项**：HarnessBench 执行预算
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：隔离 candidate 的每次模型调用 `300,000 ms`；generic CLI adapter task 进程与已接受请求 terminal 等待分别为 `600 s`
- **依据 Requirements**：`候选模型调用与任务执行采用分层预算`

- **规格项**：本机 mock endpoint 暴露方式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`HARNESSBENCH_PUBLIC_URL_TEMPLATE={local_url}`；不要求公网 tunnel
- **依据 Requirements**：`本机 mock endpoint 不依赖公网 tunnel`
