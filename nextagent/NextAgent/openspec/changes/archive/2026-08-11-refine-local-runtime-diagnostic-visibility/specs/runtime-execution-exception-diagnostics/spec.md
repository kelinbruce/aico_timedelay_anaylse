## REMOVED Requirements

### Requirement: 本地 runtime 执行异常诊断保留受控详细信息

**Reason**: 本地执行异常诊断与 Tool、Model payload 属于同一 operational runtime diagnostic 边界；继续保留独立 capability 会形成两套脱敏和容量策略。

**Migration**: 由 canonical `runtime-logging` 同名 Requirement 接管，并将异常范围扩展到 Model invocation 和 Web request handler；producer 统一提交 caught exception，writer 统一派生 `rawExceptionData`。

### Requirement: 本地执行异常诊断不得扩散到产品输出面

**Reason**: local special field 的禁止扩散是 runtime logging 与 shared redaction boundary 的共同不变量，不应由独立 exception capability 单独拥有。

**Migration**: 由 canonical `runtime-logging` 同名 Requirement 和 `redaction-policy` 的 `Redaction is enforced by the shared observation boundary` 共同接管。

### Requirement: 模型 loop 诊断只记录安全执行元数据

**Reason**: 该 Requirement 禁止模型内容进入本地日志，与本次批准的去 SYSTEM model input 和 visible normalized output 策略冲突，且旧的 direct first-content event 已由 structured trajectory 替代。

**Migration**: 由 canonical `runtime-logging` 的 `本地模型调用诊断记录可定位输入输出` 接管；既有 safe metadata 仍由 observation-derived `model.invocation.*` 提供。
