## Function

- **所属 Function**：`FN-6.3 沙箱执行命令`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration

restricted local sandbox SHALL 拥有 Bash 请求的本地 executable allow/deny policy。trusted app composition MAY 配置 `deniedExecutables` 和可选的 `allowedExecutables`；字段缺失时系统 MUST 只执行 denylist policy，字段存在时系统 MUST 只允许名称在 `allowedExecutables` 中且不在 `deniedExecutables` 中的 executable。显式空 `allowedExecutables` MUST 拒绝全部 executable；任一名称同时存在于两个名单时，denylist MUST 优先并拒绝该名称。名单 MUST 按请求的 executable 名称精确匹配，不解释通配符或正则表达式。白名单字段存在时，Bash 请求 MUST 只允许不需要 shell interpretation 的 direct execution；任何需要 trusted shell interpreter 的请求 MUST 以 `shell-composition-not-allowed` 原因安全拒绝，且 MUST NOT 启动 shell 或子命令。这些配置 MUST 保持为 trusted startup/app composition input，MUST NOT 从 model input、client metadata 或 runtime `Capability` arguments 读取。

当 `sandbox.enabled=false` 时，adapter MUST 跳过 allowlist、denylist 和白名单 direct-only 拒绝。未配置 `allowedExecutables` 且启用校验时，需要 shell builtins 或 shell composition 的请求 MUST 继续通过 trusted shell interpreter 执行重建后的命令。adapter MUST 继续通过 trusted executable locator 解析 `clipc`，通过 trusted paths 解析 Python interpreters，并通过 git-bin 或 PATH 解析其他 executable。不需要 shell interpretation 的请求 MUST 继续使用 `shell: false` direct execution path。无法解析所需 binary 或 trusted shell interpreter 时，adapter MUST fail closed。

仓库内置 `default-system.yaml` MUST 显式配置 `sandbox.enabled=true`、`allowedExecutables` 和 `deniedExecutables`。默认 allowlist MUST 按顺序精确等于 `clipc`、`curl`、`python`。默认 denylist MUST 按顺序精确等于以下穷尽集合：`bash`、`sh`、`zsh`、`fish`、`cmd`、`cmd.exe`、`powershell`、`powershell.exe`、`pwsh`、`eval`、`exec`、`env`、`xargs`、`node`、`npm`、`npx`、`deno`、`bun`、`pip`、`pip3`、`perl`、`ruby`、`php`、`lua`、`awk`、`find`、`sed`、`wget`、`ssh`、`scp`、`sftp`、`nc`、`netcat`、`socat`、`rm`、`mv`、`cp`、`install`、`tee`、`dd`、`truncate`、`chmod`、`chown`、`chgrp`、`ln`、`tar`、`unzip`、`zip`、`7z`、`kill`、`killall`、`pkill`、`taskkill`、`sudo`、`su`、`runas`、`mount`、`umount`、`systemctl`、`service`、`docker`、`podman`、`kubectl`、`helm`。默认 allowlist 与 denylist MUST 没有共同成员。denylist MUST 只表达高危 executable 的纵深防御，不得为职责去重或普通查询、校验、文本变换命令建立冗余拒绝项。已有专用 Tool 对 Bash executable 的职责去重 MUST 只由 allowlist 成员范围表达。上述默认值 MUST 经过与自定义配置相同的 schema validation 和 trusted composition 投影，不得形成特殊执行分支。默认配置加载后，restricted local sandbox MUST 执行 allowlist、denylist 和白名单 direct-only 校验。

**需求类别**：功能性需求

#### Scenario: 未配置白名单时保持黑名单行为

- **WHEN** trusted app composition 未配置 `allowedExecutables`
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 允许不在 `deniedExecutables` 中且能从 trusted location 解析的 executable 继续执行
- **AND** MUST 安全拒绝 `deniedExecutables` 中的 executable

#### Scenario: 仓库默认配置启用校验并使用最小 executable 白名单

- **WHEN** app 从仓库内置 `default-system.yaml` 加载默认系统配置
- **THEN** 配置 MUST 为 `READY`
- **AND** `sandbox.enabled` MUST 为 `true`
- **AND** `sandbox.allowedExecutables` MUST 按顺序精确等于 `["clipc", "curl", "python"]`
- **AND** `sandbox.deniedExecutables` MUST 按 Requirement 正文声明的顺序精确等于该穷尽集合
- **AND** allowlist 与 denylist MUST 没有共同成员
- **AND** restricted local sandbox MUST 按 enabled 语义执行 allowlist、denylist 和白名单 direct-only 校验

#### Scenario: 默认白名单拒绝其他 executable

- **WHEN** app 使用仓库内置 `default-system.yaml`
- **AND** Bash 请求的 executable 不是 `clipc`、`curl` 或 `python`
- **THEN** restricted local sandbox MUST 在启动进程前安全拒绝该请求
- **AND** capability boundary 的拒绝 MUST 映射为 `COMMAND_NOT_ALLOWED`

#### Scenario: 白名单允许已授权 executable

- **WHEN** trusted app composition 配置的 `allowedExecutables` 包含请求的 executable 名称
- **AND** `deniedExecutables` 不包含该名称
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 继续选择 `shell: false` direct execution path
- **AND** 执行 MUST 继续使用 adapter-owned cwd、sanitized environment、timeout、cancellation 和 output limits

#### Scenario: 白名单拒绝未授权 executable

- **WHEN** trusted app composition 配置了 `allowedExecutables`
- **AND** 请求的 executable 名称不在该名单中
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 安全拒绝该请求
- **AND** capability boundary 的拒绝 MUST 映射为 `COMMAND_NOT_ALLOWED`

#### Scenario: 显式空白名单拒绝全部 executable

- **WHEN** trusted app composition 配置 `allowedExecutables: []`
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 安全拒绝任意 executable 请求

#### Scenario: 黑名单在名单冲突时优先

- **WHEN** 同一 executable 名称同时存在于 `allowedExecutables` 和 `deniedExecutables`
- **AND** `sandbox.enabled` 缺失或为 `true`
- **THEN** restricted local sandbox MUST 安全拒绝该 executable

#### Scenario: 白名单模式拒绝 shell composition

- **WHEN** trusted app composition 配置的 `allowedExecutables` 包含请求的 executable 名称
- **AND** `sandbox.enabled` 缺失或为 `true`
- **AND** Bash 请求需要 shell interpretation
- **THEN** restricted local sandbox MUST 以 `shell-composition-not-allowed` 原因安全拒绝该请求
- **AND** MUST NOT 启动 trusted shell interpreter 或任一子命令

#### Scenario: 白名单模式不解释普通 argv 中的 shell-like 文本

- **WHEN** trusted app composition 配置的 `allowedExecutables` 包含请求的 executable 名称
- **AND** `sandbox.enabled` 缺失或为 `true`
- **AND** 请求不需要 shell interpretation，但普通 argv 包含 `>` 或其他 shell-like 文本
- **THEN** restricted local sandbox MUST 通过 `shell: false` direct execution 传递原始 argv
- **AND** MUST NOT 将该文本解释为重定向或 shell expansion

#### Scenario: 关闭校验时跳过两种名单

- **WHEN** trusted app composition 设置 `sandbox.enabled=false`
- **AND** 请求的 executable 不在已配置的 `allowedExecutables` 中或存在于 `deniedExecutables` 中
- **THEN** restricted local sandbox MUST NOT 基于 allowlist 或 denylist 拒绝该请求
- **AND** MUST 继续选择 trusted direct 或 shell execution path

#### Scenario: 无法解析的 executable 安全失败

- **WHEN** policy 允许一个 executable 请求
- **AND** required direct executable path 或 trusted shell interpreter 无法从 trusted locations 解析
- **THEN** restricted local sandbox MUST 返回显式 unavailable safe result
- **AND** MUST NOT 回退到 unsandboxed execution

#### Scenario: clipc locator 缺失时安全失败

- **WHEN** policy 允许 Bash 提交 `clipc`
- **AND** trusted locator 缺失、为空、位于声明目录之外、文件不存在或不是 regular file
- **THEN** restricted local sandbox MUST 返回显式 unavailable safe result
- **AND** MUST NOT 搜索任意 host location 或回退到 unsandboxed execution

#### Scenario: 带引号的 Windows 环境目录被规范化

- **WHEN** trusted app composition 提供被一对匹配双引号包围的 `clipc` executable directory
- **THEN** restricted local sandbox MUST 在路径解析前只移除最外层这一对双引号
- **AND** resolved binary MUST 继续通过相同的 realpath 和 regular-file validation

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统从可信启动配置读取 executable policy；仓库默认配置启用校验，只允许 `clipc`、`curl`、`python` 进行 direct execution，以精确 denylist 对高风险 executable 保持拒绝优先，并在进程启动前拒绝其他 executable 和 shell composition。
- **依据 Requirements**：`Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`

### 结果

- **变更类型**：修改
- **目标内容**：默认名单成员进入受控 direct execution；名单外 executable 和 shell composition 安全失败；显式自定义配置继续按既有策略生效。
- **依据 Requirements**：`Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`

### 规格

- **规格项**：仓库默认 executable policy
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：校验默认启用；默认 allowlist 精确为 `clipc`、`curl`、`python`；默认 denylist 精确为 Requirement 声明的 64 个高危成员；两表无共同成员；只允许 direct execution。
- **依据 Requirements**：`Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`
