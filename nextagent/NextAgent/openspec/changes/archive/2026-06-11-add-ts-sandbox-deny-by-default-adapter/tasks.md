## 1. Spec

- [x] 1.1 新增 `sandbox-deny-by-default-adapter` spec，冻结 deny-by-default / unavailable adapter 的触发边界、输入前置、输出契约和失败降级规则。
  来源：proposal 影响范围
- [x] 1.2 明确 `agent-app` 在哪些运行形态和配置条件下必须装配 deny-by-default / unavailable adapter。
  来源：spec requirement "The app composes a deny-by-default or unavailable adapter when real sandbox capability is absent"；design D1
- [x] 1.3 明确 deny-by-default adapter 只返回标准化 sandbox 结果，不执行任何宿主动态命令。
  来源：spec requirement "Deny-by-default adapter returns a standardized sandbox result without host-side execution"；design D3
- [x] 1.4 明确 deny/unavailable 结果与 logging、metrics、audit、release gate 的接入边界。
  来源：spec requirement "Deny-by-default results remain consumable by downstream governance and observability"；design D5

## 2. Design

- [x] 2.1 写清 deny-by-default adapter 只消费既有 sandbox contract，不新增公共 DTO 或新的 gateway port。
  来源：design 非目标、D3
- [x] 2.2 写清动态执行请求的固定判断顺序：提交请求、判定装配状态、识别 deny/unavailable 原因、返回标准结果。
  来源：design D2
- [x] 2.3 写清”restricted local / remote sandbox 不可用时 fail closed，而不是回落宿主执行”的安全兜底原则。
  来源：design 第一性原理、D4
- [x] 2.4 写清平台不支持、远端不可达、解释器缺失和配置禁用时的统一降级口径。
  来源：design D4

## 3. Validation

- [x] 3.1 覆盖正常路径：未装配可用 restricted local / remote sandbox 时通过 `SandboxGatewayPort` 返回标准 deny/unavailable 结果。
  来源：spec requirement scenario "Missing real sandbox configuration selects the deny-by-default adapter"、"Denied execution returns a safe result instead of running the command"；design D6
- [x] 3.2 覆盖边界路径：平台不支持、配置显式禁用、远端 gateway 未配置、解释器前置条件缺失。
  来源：spec requirement scenario "Unsupported platform yields a stable deny reason"；design D6
- [x] 3.3 覆盖失败路径：adapter 自身异常、safe error 生成失败、上游取消或超时。
  来源：spec requirement scenario "Adapter exception does not trigger host fallback"、"Remote sandbox unavailability does not pretend success"；design D6
- [x] 3.4 覆盖安全路径：不存在任何回落到宿主直接执行的绕过路径。
  来源：spec requirement "Dynamic execution always enters the sandbox gateway boundary"；design D6
