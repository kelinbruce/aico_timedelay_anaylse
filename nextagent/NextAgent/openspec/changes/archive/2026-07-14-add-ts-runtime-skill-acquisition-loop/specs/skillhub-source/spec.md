## ADDED Requirements

### Requirement: SkillHub Source MUST 支持运行时获取消费

SkillHub source SHALL 可被一条受控的运行时 Skill 获取路径使用，但其内容 MUST 只通过与 catalog refresh 相同的受治理 source lifecycle 变为可执行：可信 scope、remote gateway 访问、规范化的 staged folder、root `SKILL.md` 校验、managed install 发布、provider-private index 更新以及 catalog descriptor 治理。

SkillHub source MUST NOT 改变活动中 model invocation 的 toolset。当运行时获取安装了新的 SkillHub 内容时，该内容 MAY 只在 runtime/core 为后续 model step 请求重建的 capability snapshot 之后才变为可见。

SkillHub source SHALL 为已获取的 SkillHub Skill 提供 Skill source 加载面。发布来自已安装 index 的 descriptor 的同一 provider，MUST 通过 `loadCanonicalBodyView`、`listSkillResources` 和 `readSkillResource` 为这些 Skill 支持受治理的正文加载和资源投影。

#### Scenario: 运行时获取通过受治理安装消费 SkillHub
- **WHEN** 运行时 Skill 获取路径在一个已接受的 request/run 期间请求一个 SkillHub 支撑的 Skill
- **THEN** SkillHub source MUST 使用可信 Owner Scope 和 Agent Scope 进行 list/search 和内容抓取
- **AND** 在能够返回 descriptor 之前，该内容 MUST 安装在配置的 managed install root 下并写入 provider-private installed index
- **AND** 产生的 descriptor MUST 受当前 Agent source 授权和 catalog 冲突规则治理

#### Scenario: SkillHub 获取不绕过 catalog 治理
- **WHEN** SkillHub remote 访问在获取期间返回一个候选或规范化 staged folder
- **THEN** 在 manifest 校验、managed install、index 发布和 catalog 治理全部成功之前，系统 MUST NOT 把该候选暴露为 model 可见的 Skill capability
- **AND** 失败或部分完成的获取 MUST NOT 仅凭 staging、remote payload 或本地 managed cache 使该 Skill 可见

#### Scenario: 已获取的 SkillHub Skill 通过 SkillHub source 投影资源
- **WHEN** 一个已获取的 SkillHub package 在允许的 Skill 资源目录下包含 root `SKILL.md` 和受治理的资源文件
- **AND** 该 package 已发布到 SkillHub installed index
- **THEN** 加载该 Skill MUST 使用 SkillHub provider 的 Skill source 加载面
- **AND** `listSkillResources` 和 `readSkillResource` MUST 只枚举和读取与该 index 事实关联的已安装文件夹中的资源
- **AND** runtime/core MUST NOT 为投影这些资源而直接读取 SkillHub managed 文件夹、staging 文件夹、raw remote payload 或归档字节
