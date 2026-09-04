## ADDED Requirements

### Requirement: Sandbox Path Rejection Uses Authorization Safe Error

当 sandbox gateway safe error 的 `safeDetails.reason` 为 `unsafe-path` 或 `unauthorized-path` 时，sandbox capability boundary MUST 将结果归一化为 `CAPABILITY_PATH_REJECTED`、`AUTHORIZATION`、`retryable: false`，并 MUST NOT 将该结果归一化为 `SANDBOX_UNAVAILABLE`。

当 sandbox gateway safe error 的 category 为 `UNAVAILABLE` 且 `safeDetails.reason` 不是 `unsafe-path` 或 `unauthorized-path` 时，sandbox capability boundary MUST 保持既有 `SANDBOX_UNAVAILABLE`、`UNAVAILABLE` 归一化行为。

#### Scenario: Unauthorized path is reported as authorization rejection

- **WHEN** sandbox gateway 返回 category 为 `UNAVAILABLE` 且 `safeDetails.reason` 为 `unauthorized-path` 的 safe error
- **THEN** sandbox capability boundary MUST 返回 code 为 `CAPABILITY_PATH_REJECTED`、category 为 `AUTHORIZATION`、`retryable: false` 的 safe error
- **AND** 返回结果 MUST NOT 使用 `SANDBOX_UNAVAILABLE`

#### Scenario: Existing unsafe path reason remains an authorization rejection

- **WHEN** sandbox gateway 返回 `safeDetails.reason` 为 `unsafe-path` 的 safe error
- **THEN** sandbox capability boundary MUST 返回 code 为 `CAPABILITY_PATH_REJECTED`、category 为 `AUTHORIZATION`、`retryable: false` 的 safe error

#### Scenario: Genuine sandbox unavailability remains unavailable

- **WHEN** sandbox gateway 返回 category 为 `UNAVAILABLE` 且 `safeDetails.reason` 不是 `unsafe-path` 或 `unauthorized-path` 的 safe error
- **THEN** sandbox capability boundary MUST 返回 code 为 `SANDBOX_UNAVAILABLE`、category 为 `UNAVAILABLE` 的 safe error
