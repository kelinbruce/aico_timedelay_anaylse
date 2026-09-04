# model-provider-adapter Specification

## Purpose
定义模型接入过程中厂商原生失败进入统一安全错误映射的兼容行为，确保调用方只接收稳定、可处理且不泄漏厂商响应、凭据或内部异常细节的失败结果。
## Requirements
### Requirement: Provider adapter forwards failures to safe mapping
Provider-native failures produced by the adapter SHALL be forwarded to provider error safe mapping rather than being exported as raw exceptions across module boundaries.

#### Scenario: Provider adapter receives an error response
- **WHEN** a provider adapter receives a provider-native failure
- **THEN** that failure MUST enter the standard provider/model safe mapping path
