## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-6.3 沙箱执行命令` | local restricted sandbox 在启动 curl/Python 前按 trusted API prefix 拒绝未批准的显式目标，并仅支持固定 sidecar Unix Socket | `sandbox-runtime` | `FN-6.3 沙箱执行命令` |

## `FN-6.3 沙箱执行命令`

### 目标与规范依据

本设计在不引入标准沙箱、网络 namespace 或通用 egress broker 的前提下，为 local 模式补充一个可删除的进程启动前目标检查。它必须保持默认拒绝、信任来源不可由模型覆盖，并明确 Python 检查只是过渡性 best-effort 防护。

实施依赖 `harden-default-sandbox-executable-policy` 先落地并保持 `curl`、`python`、`python3` 的 executable policy；本 change 不重新定义或复制该名单。

#### 本 Function 的目标 Requirements

canonical spec：`sandbox-runtime`

- `ADDED`：`Local 模式从受信配置限制 API 目标`
- `ADDED`：`Local curl 只执行目标确定的受控请求`
- `ADDED`：`Local Python 对可识别网络目标执行过渡检查`

### 当前实现

- `packages/agent-app/src/config/validation.ts` 的 sandbox schema 只接受 `enabled`、`allowedExecutables`、`deniedExecutables` 和 `clipcExecutableDirectoryEnv`，不存在 API 目标配置。
- `loadAppCompositionConfiguration` 把可信 sandbox 配置冻结到 `SandboxGatewayFactoryInput`；默认 local provider 同时通过 `GatewayProviderCreateInput.runtime.sandbox` 接收 executable policy。
- `RestrictedLocalSandboxGateway.validateRequest` 只校验 executable 名单和 shell composition；校验通过后 `executeProcess` / `startBackgroundProcess` 使用 `spawn(..., { shell: false })` 在宿主网络环境启动进程。
- Bash 把 `curl` 作为 direct executable 请求提交；Python inline source 会先写入本次 temp root 后以 `python temp/<id>.py` 提交，existing script 和 Skill script/module 使用既有路径翻译规则。
- 当前 adapter 没有 curl argv parser、URL prefix matcher 或 Python network-intent classifier，也没有限制 `/opt/sidecar/ir/http.sock` 的逻辑。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| trusted `allowedApis` 经过 schema validation 和 app composition | 当前配置和 composition 不含该字段 | 需要增加 local-only 配置值及冻结投影，同时避免扩大 frozen `agent-contracts/gateway` runtime contract |
| curl 只允许唯一、可确定且受控的目标 | 当前所有 argv 原样进入宿主 curl | 需要最小 URL classifier（从 argv 过滤可解析 URL 而非取末项）、少量 forbidden route option 和 fail-closed 校验 |
| Unix Socket 只允许固定 sidecar 路径且仍校验 URL | 当前 `--unix-socket` 不受约束 | 需要把固定路径作为 adapter-owned constant 与同一请求 URL 联合判断 |
| Python 对显式目标执行临时防护 | 当前 Python source/script 可使用宿主网络 | 需要在既有路径翻译后、spawn 前读取受治理 source 并校验 HTTP(S) URL literal；动态目标明确不覆盖 |
| safe rejection 不泄漏内部目标 | 当前没有 network policy rejection | 需要新增稳定内部 reason，并复用既有 sandbox safe-error mapping，不把原始目标写入 safe details |

### 修改方案

唯一实施路径是把 `allowedApis` 作为 app-owned trusted local configuration 投影到 local sandbox adapter，在 `RestrictedLocalSandboxGateway.validateRequest` 完成 executable policy 后、`prepareExecution` / spawn 前执行无副作用分类。该 change 不建立网络代理，不修改 `SandboxExecutionRequest`，也不修改 `agent-contracts/gateway` 的 `GatewayProviderSandboxConfig`。

#### 配置与 composition

- `SandboxConfig` 和 raw schema 新增 optional `allowedApis: string[]`，缺失规范化为冻结空数组。
- schema 自定义校验把每个成员解析为 WHATWG `URL`，只接受 `http:` / `https:`、空 username/password/search/hash、以 `/` 结尾的 pathname；规范化结果保留 serialized URL prefix，重复规范化值使配置 `BLOCKED`。
- app-owned `SandboxGatewayFactoryInput` 增加 readonly `allowedApis`；`loadAppCompositionConfiguration` 沿既有 factory path 投影 frozen list。
- `LocalGatewayProviderOptions` 增加 readonly `allowedApis`，默认 local provider 从闭包把同一 frozen list 传给 `createRestrictedLocalSandboxGateway`。`create-app` 与 local runtime package 在已加载 system config 后创建内置 provider 时传入该 list。provider 继续从当前 `GatewayProviderCreateInput.runtime.sandbox` 消费 executable policy；不要向 frozen `agent-contracts/gateway` 增加字段。
- provider binding 在当前 composition 中优先于 fallback factory，因此两个既有创建入口必须接收同一 list；它们复用同一个 restricted local sandbox policy，不形成两套判断。调用方显式注入自定义 provider 或 sandbox gateway 时，该 trusted injection 继续拥有自己的策略，app 不覆盖。

`RestrictedLocalSandboxOptions` 增加 required-at-composition、default-empty 的 `allowedApis`。adapter constructor 将每个值预解析为 immutable matcher：

```ts
interface AllowedApiMatcher {
  readonly protocol: 'http:' | 'https:';
  readonly hostname: string;
  readonly effectivePort: string;
  readonly pathnamePrefix: string;
}
```

该对象仅存在于 local adapter 私有内存，不持久化。`effectivePort` 将缺失端口规范化为 `http:80` 或 `https:443`；目标也使用同一规则。pathname 使用 `URL.pathname`，prefix 已强制以 `/` 结尾，因此 `/v1/` 不匹配 `/v1-other`。

#### curl 分类

新增 local adapter 私有纯函数 `classifyCurlNetworkRequest(args)`，保持单遍、最小规则：

- argv 中可解析为绝对 HTTP(S) URL 的参数必须恰好为一个；零个或多个 URL 均拒绝。非 URL 参数（如 shell 重定向 `2>&1`）不影响 URL 提取。此前出现多个绝对 HTTP(S) URL 时作为多目标拒绝。
- 目标包含 `{`、`}`、`[` 或 `]` 时拒绝 curl URL glob。
- 只维护 spec 中少量会替换目标、改变连接路由或跟随 redirect 的 forbidden option 集；匹配 long `--name=value` 和独立 token。其他 option 保持由 curl 解释，不建立完整 option parser。
- `--unix-socket` 仅解析两种明确形式，至多一次且值逐字等于 adapter-owned constant `/opt/sidecar/ir/http.sock`。不执行 path canonicalization、文件 stat 或 symlink 检查；此路径由 sidecar 部署拥有，当前控制只批准精确 argv 值，实际缺失由 curl 返回普通执行失败。

#### Python 分类

在 `prepareExecution` 完成受治理路径翻译之后、调用 spawn 之前分类 Python：

- inline source 和 script mode 从已验证、已翻译且位于 sandbox roots 的 `.py` 文件读取有界 source；最大读取量复用当前 Python script/input budget，不新增无限制文件读取。
- `-m` mode 不解析或 import module；只检查其可见 argv 中的显式 HTTP(S) URL，没有显式 URL 时继续既有 module invocation 路径。
- 使用单一 private classifier 在 source 与 argv 字符串中提取绝对 HTTP(S) URL literal；存在 literal 时全部匹配才继续，没有 literal 时不增加拒绝。该 classifier 不执行 Python AST、import 或代码。
- classifier 明确不覆盖字符串拼接、编码、底层 socket 或 module 内部目标。选择它是为了在标准沙箱到位前阻断最常见的显式内部 API 访问，同时维持 Python 能力；文档、diagnostic 和 safe error 都不得将其表述为强隔离。

同步和后台执行必须调用同一 `validateNetworkAccess`，避免 background path 绕过。拒绝使用 adapter private reason `network-target-not-allowed`，并可携带第一个明确解析的未授权 URL。safe result `message` 返回该 URL 去除 username、password、query 和 fragment 后的规范化安全投影；没有明确未授权 URL 的歧义拒绝保持通用 message。rejection 日志省略 error object，只记录 reason 与 executable kind，避免 URL 进入 operational log；source、argv 和 allowed list 仍不回显。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Local Python 对可识别网络目标执行过渡检查` | trusted config、显式 URL classifier、同步/后台共用校验、safe diagnostic 不含目标内容，并显式限制保证等级 | 空名单、origin/path 绕过、curl 路由 option、固定 socket、Python 显式/动态目标边界、后台执行和日志泄漏 negative cases |

#### 备选方案（Alternatives Considered）

- 标准 sandbox、容器网络隔离或 egress broker 能提供强边界，但超出本次“快速过渡”时限；后续必须用它替换本策略。
- 只检查 curl 会完全遗漏常见 Python 字面量 URL；未选择。
- Python marker 黑名单、AST 或 monkey patch socket 增加复杂度且仍不是强隔离；未选择。第一版只检查显式 URL并公开动态目标不受保护的限制。
- 修改 public `GatewayProviderSandboxConfig` 能统一传值，但会扩大 frozen gateway contract；通过 local provider private options 与 app-internal factory input 避免该变化。

## 验证策略（Verification Strategy）

- configuration contract tests 覆盖合法 URL prefix、非法 scheme/credentials/query/fragment、缺失和空名单，以及 app composition 到 provider/fallback factory 两条既有创建入口的投影。
- local sandbox unit/characterization tests 通过可观察的子进程是否启动、safe reason 和结果验证 curl/Python normal、boundary、background 和 negative paths；不锁定 private helper 形状。
- security negative tests 覆盖相似 hostname、不同 scheme/port、path sibling、curl forbidden route option、多 URL、glob、非固定/重复/abstract socket，以及 Python 显式目标；动态目标和 `-m` 用例验证其继续既有路径且不产生强隔离声明。
- contract 与 architecture tests 证明 `SandboxExecutionRequest`、`GatewayProviderSandboxConfig`、remote sandbox 和 package dependency direction 未改变。
- OpenSpec strict validation 与模型语义检视确认过渡保证没有被表述为标准沙箱隔离。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：合并 local 受控 API、curl 固定 Unix Socket 和 Python best-effort Requirements。
- `openspec/designs/functions/D6-安全与治理/D6.2-执行与风险治理/FN-6.3-沙箱执行命令.md`：刷新描述、处理过程、结果和规格表，转换为当前三列表格格式。
- `openspec/designs/features/D6-安全与治理/D6.2-执行与风险治理/F-6.3-沙箱执行.md`：增加 local 过渡网络防护的用户可依赖边界与限制。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/configuration-boundary.md`：补充 trusted local `allowedApis` 来源及不可由 runtime input 覆盖的边界。
- `openspec/designs/modules/agent-app.md`：补充配置校验和 provider/fallback factory 投影职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充进程启动前网络目标分类、固定 Unix Socket 与 best-effort 限制。
- `openspec/designs/adr/`：无；该策略是待标准沙箱替换的过渡实现，不建立长期技术决策。
- `openspec/designs/spec-to-design-map.md`：把新增 Requirements 导航到配置边界、两个模块和验证入口。

## 风险与取舍（Risks / Trade-offs）

- Python 文本分类无法阻止刻意混淆、运行时构造或底层 socket 网络访问。缓解方式是明确降低保证等级、只阻断显式 URL，并把标准沙箱替换作为退出条件；不得把本 change 用于不可信代码强隔离声明。
- curl 保留大部分既有 option，只拒绝改变目标或连接路由的少量 option。这保持实现简单，但 curl 新增的等价路由 option 可能形成漏检；在标准沙箱替换前由安全回归维护 forbidden set。
- `allowedApis` 的 hostname 只做 URL 结构匹配，不检查 DNS 解析结果，因此仍存在 DNS 和目标基础设施变化风险。该风险由部署可信域名控制临时接受，标准沙箱或 egress broker 后续接管。
- 固定 Unix Socket 的实际文件类型和权限由 sidecar 部署负责；本 change 只限制模型能提交的路径值。socket 缺失时 curl 普通失败，不降级到其他路径。

## 迁移与回滚（Migration / Rollback）

发布前，使用 local 模式访问 API 的部署必须把所需 HTTP(S) prefix 写入 trusted `allowedApis`，并把 curl 命令收敛到单一末项 URL。未配置的部署仍可运行不含显式 URL 的 Python，但 curl 和带显式 URL 的 Python 请求会被拒绝。若策略误拒绝必要路径，优先增加更精确的 trusted prefix或调整调用形态；只有分类器导致 local 主路径不可用且无法快速修正时才回滚该 change。回滚后 executable policy 保持不变，但 local API 访问恢复为无目标限制状态，必须由部署侧风险控制承接。

## 待确认问题（Open Questions）

无。
