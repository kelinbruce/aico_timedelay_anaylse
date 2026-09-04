## Why

运维人员在 local 模式保留 `curl`、`python` 和 `python3` 执行能力时，进程当前继承宿主网络可达性，模型生成的命令或代码可以绕过业务 API 治理直接访问内部接口。executable allowlist 只能决定能否启动程序，不能限制程序访问的 API 目标；在标准沙箱接管网络隔离前，系统需要一个范围明确、默认拒绝且可快速落地的过渡控制，避免受支持 executable 任意访问 local 环境中的 API。

本 change 定义“受控 API”：由 trusted system configuration 声明的 HTTP(S) URL prefix。local sandbox 在执行 `curl` 或 Python 前提取显式 HTTP(S) URL，并要求目标命中受控 API；名单为空或显式目标不匹配时，在进程启动前拒绝执行。该控制是标准沙箱上线前的临时应用层防护，不检测 Python 运行时动态构造的目标，也不等同于操作系统网络隔离。

规范上下文：

- 适用部署：仅 local gateway 的 restricted local sandbox。
- 信任来源：仅 trusted startup/app composition；模型输入、客户端 metadata、Skill metadata 和 runtime `Capability` 参数不得修改受控 API 列表。
- 默认策略：`allowedApis` 缺失或为空时，`curl` 和包含显式 HTTP(S) URL 的 Python 请求默认拒绝；不含显式 URL 的受支持 Python 执行继续可用。
- 固定 Unix Socket：`curl --unix-socket` 仅支持 `/opt/sidecar/ir/http.sock`，且 URL 仍必须命中同一受控 API 列表。
- 生命周期：标准沙箱提供强制网络隔离后，本过渡控制由后续 change 替换或移除。
- 前置依赖：`harden-default-sandbox-executable-policy` 先完成默认 executable policy，使 local 配置中的 `curl`、`python` 和 `python3` 进入已启用的 executable 校验路径；本 change 只在其后增加 API 目标约束。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 运维人员可以通过受信配置声明 local sandbox 可访问的 HTTP(S) API prefix。
- `curl` 只有在唯一目标 URL 命中受控 API 且参数属于明确支持的安全子集时才能启动。
- `curl --unix-socket` 只有在 socket 路径精确等于 `/opt/sidecar/ir/http.sock` 且 URL 命中受控 API 时才能启动。
- Python source、script 和 argv 中的显式 HTTP(S) URL 全部命中受控 API 时才能启动；没有显式 URL 的 Python 请求继续现有执行路径。
- 对能够明确解析的未授权目标，拒绝结果的 `message` 返回去除 credentials、query 和 fragment 后的规范化 URL；不得回显受控 API 列表、原始代码或 argv。

**非目标：**

- 不把应用层检测声明为对恶意 Python 代码的强隔离或标准沙箱替代品。
- 不实现 DNS pinning、CIDR/IP 分类、redirect 逐跳校验、透明代理、network namespace、容器或操作系统防火墙。
- 不允许配置其他 Unix Socket 路径，不支持 abstract Unix Socket。
- 不新增通用 HTTP Tool，不改变 `ApiCall` 或 CLIP 的治理契约。
- 不改变 executable allowlist/denylist、filesystem root、超时、取消或输出限制；safe error 只增加未授权 URL 的安全 message 投影。

## What Changes

- **BREAKING**：local 模式中，现有 curl 请求和包含显式 HTTP(S) URL 的 Python 请求在未配置匹配 `allowedApis` 时将从可执行变为进程启动前拒绝。
- local sandbox 配置新增 trusted `allowedApis` 列表，每项为一个规范化 HTTP(S) URL prefix。
- local sandbox 在启动 `curl` 前从 argv 中提取可解析为 HTTP(S) URL 的参数作为目标，要求恰好一个 URL 且命中 `allowedApis`，并拒绝可以替换目标、改变连接路由或跟随 redirect 的少量高风险参数。
- local sandbox 支持 `curl --unix-socket /opt/sidecar/ir/http.sock` 和等价 `--unix-socket=/opt/sidecar/ir/http.sock` 形式；其他 socket 路径和 `--abstract-unix-socket` 均拒绝。
- local sandbox 在启动 Python 前提取 source、script 和 argv 中的显式 HTTP(S) URL，并要求全部目标命中 `allowedApis`；无显式 URL时不增加拒绝。
- 非网络 Python 执行保持现有行为；受控 API 检查失败统一返回安全的 network-policy rejection，且不得启动子进程。

## Feature 影响（Features）

### 修改的 Feature

- `F-6.3 沙箱执行`：local 模式在标准沙箱上线前增加调用方可依赖的受控 API 过渡防护；组成 Function 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.3 沙箱执行命令` → `specs/sandbox-runtime/spec.md`
  - 功能边界：在 restricted local sandbox 启动 `curl` 或 Python 前，从受信配置执行受控 API 目标校验，并支持唯一固定的 sidecar Unix Socket。
  - 系统质量属性：安全；默认拒绝未批准的显式 local API 访问，不把临时检测扩大为动态目标检测或标准沙箱保证。
  - 映射说明：`sandbox-runtime` 是 canonical spec；不触及 legacy spec。

## 影响范围（Impact）

- 使用 local 模式且依赖 `curl` 或 Python 显式访问 API 的部署需要配置 `allowedApis`；未配置时 curl 和带显式 URL 的 Python 请求会在进程启动前失败。
- 既有不含显式 URL 的 Python 路径继续可用；运行时动态拼装 URL 或底层 socket 不在本过渡策略的检测范围内，仍需由部署风险控制承接并等待标准沙箱能力。
- local sandbox 配置 schema、可信 composition、gateway adapter 和相关 contract/negative tests 需要同步；remote sandbox 行为和公共 Web API 不受影响。
