## Function

- **所属 Function**：`FN-6.3 沙箱执行命令`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Local 模式从受信配置限制 API 目标

restricted local sandbox MUST 从 trusted startup/app composition 接收可选 `allowedApis`。`allowedApis` 的每个成员 MUST 是以 `/` 结尾且不含 username、password、query 或 fragment 的绝对 `http:` 或 `https:` URL prefix；配置包含任一非法成员时系统配置 MUST 为 `BLOCKED`。模型输入、客户端 metadata、Skill metadata 和 runtime `Capability` 参数 MUST NOT 新增、删除或覆盖 `allowedApis`。

local sandbox MUST 使用标准 URL 解析结果匹配 API 目标：scheme、lowercase hostname 和 effective port MUST 精确相等，目标的 normalized pathname MUST 以 prefix 的 pathname 开头。系统 MUST NOT 使用原始 URL 字符串前缀匹配。`allowedApis` 缺失或为空时，curl 请求和包含显式 HTTP(S) URL 的 Python 请求 MUST 在启动进程前拒绝；显式目标 URL 全部命中至少一个成员时，请求 MUST 继续接受其余 sandbox policy 校验。该策略仅适用于 restricted local sandbox，remote sandbox 行为 MUST NOT 因此改变。

当拒绝原因包含能够明确解析的未授权 HTTP(S) URL 时，safe result `message` MUST 返回第一个未授权 URL 的规范化安全投影；该投影 MUST 清除 username、password、query 和 fragment。参数歧义、禁止 option、非法 socket 或不存在可明确解析的未授权 URL 时，`message` MUST 保持通用拒绝信息。operational log、reason 和 diagnostics MUST NOT 记录该 URL。

**需求类别**：功能性需求

#### Scenario: 合法受控 API 目标继续执行

- **WHEN** restricted local sandbox 收到可识别的 `curl` 或 Python HTTP(S) 请求
- **AND** 请求中的全部目标 URL 均命中至少一个 trusted `allowedApis` 成员
- **THEN** sandbox MUST 继续执行其余 executable、调用形态、filesystem、timeout、cancellation 和 output policy 校验
- **AND** MUST NOT 因目标 API policy 拒绝该请求

#### Scenario: 空名单默认拒绝网络访问

- **WHEN** `allowedApis` 缺失或为空
- **AND** restricted local sandbox 收到 curl 请求或包含显式 HTTP(S) URL 的 Python 请求
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求
- **AND** safe result MUST 使用 `network-target-not-allowed` reason

#### Scenario: URL origin 相似但不相同

- **WHEN** `allowedApis` 包含 `https://api.example.internal/v1/`
- **AND** 请求目标为 `https://api.example.internal.evil.test/v1/items`、不同 effective port 或不同 scheme 中的任一个
- **THEN** sandbox MUST 判定目标未命中该成员
- **AND** MUST 在启动进程前安全拒绝该请求

#### Scenario: URL path 越过受控 prefix

- **WHEN** `allowedApis` 包含 `https://api.example.internal/v1/`
- **AND** 请求目标的 normalized pathname 不以 `/v1/` 开头
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求

#### Scenario: 拒绝消息返回不支持的 URL

- **WHEN** curl 或 Python 请求包含能够明确解析且未命中 `allowedApis` 的 HTTP(S) URL
- **THEN** safe result `message` MUST 包含第一个未授权 URL 的规范化安全投影
- **AND** 该 URL MUST 不包含 credentials、query 或 fragment
- **AND** operational log、reason 和 diagnostics MUST NOT 包含该 URL

#### Scenario: 不可信输入不能覆盖名单

- **WHEN** model input、client metadata、Skill metadata 或 runtime `Capability` 参数提供额外 API prefix
- **THEN** sandbox MUST NOT 把该值加入 trusted `allowedApis`
- **AND** 未命中 trusted list 的请求 MUST 保持拒绝

### Requirement: Local curl 只执行目标确定的受控请求

restricted local sandbox MUST 在启动 `curl` 前从 argv 中提取可解析为绝对 HTTP(S) URL 的参数作为目标，并按 `allowedApis` 校验。argv 中可解析为 HTTP(S) URL 的参数 MUST 恰好为一个，否则 sandbox MUST 作为多目标或无目标请求拒绝。非 URL 参数（如 shell 重定向 `2>&1`）MUST NOT 影响 URL 提取。目标中包含 curl URL glob 字符 `{`、`}`、`[` 或 `]` 时，sandbox MUST 在进程启动前拒绝。sandbox MUST 拒绝 `--url`、`--config`、`-K`、`--proxy`、`-x`、`--preproxy`、`--resolve`、`--connect-to`、`--request-target`、`--path-as-is`、`--location`、`-L` 和 `--location-trusted`，包括对应 `--name=value` 形式；其他 option 保持由 curl 解释，不由 local sandbox 复制完整 option grammar。

`--unix-socket` MUST 至多出现一次；其值 MUST 逐字精确等于 `/opt/sidecar/ir/http.sock`。使用该 option 时，目标 URL MUST 继续命中 `allowedApis`；socket 路径与 API 目标两个条件 MUST 同时成立。`--abstract-unix-socket` 和其他 Unix Socket 路径 MUST 拒绝。

**需求类别**：功能性需求

#### Scenario: 受控网络 URL 通过校验

- **WHEN** curl argv 中恰好一个参数可解析为绝对 HTTP(S) URL 且其他 argv 项不包含绝对 HTTP(S) URL 或被禁止参数
- **AND** URL 命中 trusted `allowedApis`
- **THEN** sandbox MUST 继续执行其余 sandbox policy 校验

#### Scenario: 固定 Unix Socket 与受控 API 同时匹配

- **WHEN** curl argv 包含一次 `--unix-socket /opt/sidecar/ir/http.sock` 或 `--unix-socket=/opt/sidecar/ir/http.sock`
- **AND** 恰好一个目标 URL 命中 trusted `allowedApis`
- **THEN** sandbox MUST 继续执行其余 sandbox policy 校验

#### Scenario: Unix Socket 路径不匹配

- **WHEN** curl argv 的 Unix Socket option 值不是 `/opt/sidecar/ir/http.sock`
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求

#### Scenario: curl 参数不能确定唯一目标

- **WHEN** curl argv 包含被禁止参数、多个可解析 URL、无可解析 URL 或 URL glob 字符中的任一情况
- **THEN** sandbox MUST 在启动进程前安全拒绝该请求
- **AND** MUST NOT 尝试推测实际网络目标

### Requirement: Local Python 对可识别网络目标执行过渡检查

restricted local sandbox MUST 把 Python source、script content 和 argv 中出现的绝对 HTTP(S) URL literal 视为显式 API 目标，并在启动 Python 前要求每个目标命中 `allowedApis`。未出现 HTTP(S) URL literal 的 Python 请求 MUST 继续按既有执行策略处理，包括 `-m` module invocation。local sandbox MUST NOT 把该检查表示为能够检测运行时字符串拼接、编码、底层 socket 或被调用 module 内部产生的目标。

该检查 MUST 被描述为 local 模式的临时 best-effort 防护，MUST NOT 被表示为恶意 Python 代码隔离、完整网络出口控制或标准沙箱。拒绝结果 MUST 使用安全 reason；除上述 safe result `message` 中去除 credentials、query 和 fragment 后的首个未授权 URL 外，MUST NOT 回显 Python source、其他内部目标 URL 或非固定宿主路径。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: Python 字面量目标全部受控

- **WHEN** Python 请求包含至少一个绝对 HTTP(S) URL literal
- **AND** 全部 URL literal 均命中 trusted `allowedApis`
- **THEN** sandbox MUST 继续执行其余 Python sandbox policy 校验

#### Scenario: Python 显式目标未受控

- **WHEN** Python 请求包含至少一个未命中 trusted `allowedApis` 的绝对 HTTP(S) URL literal
- **THEN** sandbox MUST 在启动 Python 前安全拒绝该请求

#### Scenario: Python 动态目标不在过渡检查范围

- **WHEN** Python 请求不包含绝对 HTTP(S) URL literal
- **THEN** sandbox MUST 继续按既有 Python sandbox policy 处理
- **AND** MUST NOT 声明该请求已经通过完整网络出口验证

#### Scenario: 非网络 Python 计算保持可用

- **WHEN** Python 请求不包含 HTTP(S) URL literal
- **THEN** sandbox MUST 继续按既有 Python invocation、filesystem、timeout、cancellation 和 output policy 处理

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：local 模式在执行 `curl` 或 Python 前按受信 API prefix 限制可识别网络目标，并对唯一固定 sidecar Unix Socket 提供受控访问。
- **依据 Requirements**：`Local 模式从受信配置限制 API 目标`、`Local curl 只执行目标确定的受控请求`、`Local Python 对可识别网络目标执行过渡检查`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在进程启动前提取 curl/Python 的显式 HTTP(S) URL并校验目标；未批准的显式访问安全失败，无显式 URL 的 Python 继续既有执行路径。
- **依据 Requirements**：`Local 模式从受信配置限制 API 目标`、`Local curl 只执行目标确定的受控请求`、`Local Python 对可识别网络目标执行过渡检查`

### 结果

- **变更类型**：修改
- **目标内容**：受控 API 请求继续执行，未批准的显式目标或不受支持的 curl 路由参数在启动进程前返回安全拒绝。
- **依据 Requirements**：`Local 模式从受信配置限制 API 目标`、`Local curl 只执行目标确定的受控请求`、`Local Python 对可识别网络目标执行过渡检查`

### 规格

- **规格项**：local 受控 API 匹配
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：trusted HTTP(S) URL prefix；scheme、hostname、effective port 精确匹配且 normalized pathname 命中 prefix；空名单默认拒绝网络访问。
- **依据 Requirements**：`Local 模式从受信配置限制 API 目标`

- **规格项**：local curl Unix Socket
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：仅支持 `/opt/sidecar/ir/http.sock`，且目标 URL 必须同时命中受控 API。
- **依据 Requirements**：`Local curl 只执行目标确定的受控请求`

- **规格项**：local Python 网络控制等级
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：仅对 source、script 和 argv 中的绝对 HTTP(S) URL literal 执行进程启动前 best-effort 检查；不检测动态目标，不构成恶意代码隔离或标准沙箱保证。
- **依据 Requirements**：`Local Python 对可识别网络目标执行过渡检查`
