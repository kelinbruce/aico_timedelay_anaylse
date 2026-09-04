# Runtime Capability Acquisition

## 核心边界（Core Boundary）

Runtime Skill 获取是一条受控 capability 路径，在被接受的 request/run 期间获取 SkillHub 支撑的 Skill。它不修改活跃 model invocation 的 toolset。一次成功的获取只能影响获取结果已记录且 capability 快照已重建之后的后续 planning/model step。

稳定路径是：

```text
model step N
-> acquire_skill capability invocation
-> agent-capability Skill acquisition service
-> SkillHub source search/fetch/install/index/catalog governance
-> safe acquisition result
-> agent-core ends the current planning turn and replans
-> model step N+1 receives a rebuilt capability snapshot
```

`agent-runtime` 保持 request lifecycle、checkpoint、timeline 和 terminal commit 归属。获取证据使用通用 capability timeline/message 事实，如 `CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED` 和普通 capability result message。Runtime 不新增 SkillHub 专用 timeline event，不访问 SkillHub endpoint，也不读取 staging 或托管安装目录。

## 模块归属（Module Ownership）

- `agent-core` 拥有获取/重规划协议。它识别安全获取结果，保持当前 invocation toolset 冻结，通过普通 tool-loop 处理 append 获取结果，并启动一个重新查询 catalog 的后续 planning 轮次。
- `agent-capability` 拥有 `SkillAcquisitionService`、SkillHub source 复用、托管 install/index 发布、descriptor 治理、runtime 生成的本地 Skill 发现和安全获取结果映射。
- `agent-platform-gateway-remote` 或部署 adapter 拥有具体的 SkillHub 协议访问、credential、wire DTO、archive/物化和远程 safe error 映射。
- `agent-runtime` 拥有通用执行证据、checkpoint/recovery 坐标和 terminal 正确性。它绝不把获取成功当作 terminal 成功。

## 快照规则（Snapshot Rule）

每次 model invocation 使用一个冻结的 capability 快照。在 provider invocation 启动后，runtime、core、hook、capability provider 和获取代码不得添加、移除或修改已披露的 tool。新获取的 Skill 只有在一个 step 边界和重建后的 catalog/context 快照之后才可见。

Runtime 生成的 Skill 遵循同一快照规则。对 `generated-skills/<skill-name>/SKILL.md` 的一次受治理写入会为后续 capability 解析创建一个本地执行范围 source，但它不会被复制到 SkillHub 托管 install/index，也不是组织级发布。

## 失败与恢复（Failure and Recovery）

获取失败通过普通 capability result 语义降级：`NOT_FOUND`、`UNAVAILABLE`、`REJECTED`、`INSTALL_FAILED`、`UNAUTHORIZED` 或等价安全结果。安全结果可以包含 provider id、provider kind、安全 Skill id 和有界结果码。它们不得包含 endpoint、credential、托管安装路径、staging 路径、原始 package 字节、原始 provider 响应、archive 元数据或 provider 私有加载 key。

恢复不得执行 staging 内容或原始远程 payload。一个恢复的 request 可以依赖持久的受治理 catalog/index 事实，或通过同一幂等 install/治理路径重复获取。Terminal commit 和 session history 仍由 runtime 和 gateway Working Memory 拥有。

## 延期范围（Deferred Scope）

本设计不定义后台 SkillHub 刷新、marketplace UI、全局 warmup、动态 plugin/tool 创建、model invocation 热 toolset 修改，或生成 Skill 到 SkillHub 的自动发布。发布生成的 Skill 需要单独的受治理发布 capability。

## 验证关注点（Verification Focus）

- 同一 run 内先获取再在后续 step 调用 Skill；
- 活跃 model invocation toolset 不可变性；
- SkillHub 获取使用与 catalog 刷新相同的 install/index/catalog 治理；
- 生成的 Skill 不进入 SkillHub 托管 index；
- 安全 timeline/result 序列化不泄漏 provider 私有事实；
- architecture 测试阻止 runtime/core 导入远程 gateway 或 SkillHub adapter 内部实现。
