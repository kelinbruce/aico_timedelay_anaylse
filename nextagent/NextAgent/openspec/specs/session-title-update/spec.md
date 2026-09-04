# session-title-update Specification

## Purpose
定义手工会话标题更新的 owner-and-Agent scope、Web raw body 与 session-owner 分层校验、trim 后安全标题持久化，以及 `titleSource="manual"` 对后续自动覆盖的阻断语义。
## Requirements
### Requirement: Manual session title update SHALL be owner-and-Agent scoped

The Web route `PUT /api/v1/sessions/:sessionId/title` SHALL resolve trusted identity and delegate to the runtime session facade without accepting Agent scope from the request body. The runtime/session boundary SHALL resolve the session's trusted Agent scope before calling the session owner. A session outside that owner-and-Agent scope or not found SHALL return the existing safe not-found contract rather than revealing another scope's data.

#### Scenario: Scoped session title update succeeds
- **GIVEN** the target session belongs to the trusted owner and Agent scope
- **WHEN** the client sends a valid title update
- **THEN** the session owner SHALL persist and return the updated session projection

#### Scenario: Missing scoped session is safe not found
- **WHEN** no session is found in the trusted owner and Agent scope
- **THEN** the update SHALL fail with the existing safe session-not-found contract

### Requirement: Manual title validation SHALL match current session-owner rules

The Web title route SHALL reject a raw `title` value longer than 100 characters through the existing request-validation contract. A title that reaches the session owner SHALL be trimmed before validation and persistence. A trimmed title between 1 and 100 characters inclusive SHALL be accepted unless it matches the implemented secret- or XSS-sensitive patterns. An empty or whitespace-only title SHALL be rejected and SHALL NOT clear or modify the stored title.

#### Scenario: Raw Web title above the body limit is rejected
- **WHEN** the Web client submits a raw title longer than 100 characters
- **THEN** the route SHALL fail with the existing request-validation contract without delegating the update

#### Scenario: Single-character title is accepted
- **WHEN** the session owner receives a safe title whose trimmed value contains one character
- **THEN** the session owner SHALL persist that one-character title

#### Scenario: Empty or whitespace-only title is rejected
- **WHEN** the session owner receives a title whose trimmed value is empty
- **THEN** the update SHALL fail with the existing safe too-short contract
- **AND** the stored session title SHALL remain unchanged

#### Scenario: Valid title is trimmed before persistence
- **WHEN** the session owner receives a valid title with leading or trailing whitespace
- **THEN** the session owner SHALL persist the trimmed title

#### Scenario: Unsafe title is rejected after trimming
- **WHEN** the trimmed title matches the implemented secret- or XSS-sensitive patterns
- **THEN** the update SHALL fail without changing the stored session title

### Requirement: Manual title source SHALL block later automatic overwrite

Every successful manual title update SHALL persist `titleSource="manual"`. Later automatic title generation SHALL preserve the manual source and SHALL NOT replace the title.

#### Scenario: Manual title remains protected
- **GIVEN** the user has successfully set a manual session title
- **WHEN** automatic title generation later runs
- **THEN** it SHALL preserve the manual title and `titleSource="manual"`

### Requirement: Unsafe title content SHALL report a category-specific safe message

When the trimmed title matches a prohibited-content pattern, the session owner SHALL reject the update with a `SESSION_TITLE_UNSAFE_CONTENT` SafeError whose message identifies the matched content category. The system SHALL distinguish the XSS-sensitive category (HTML tags, `javascript:` URLs, or event-handler attributes) from the secret-sensitive category (credentials, API keys, tokens, or passwords) and SHALL report a message referencing the matched category. The error SHALL NOT include the unsafe title content or any matched substring.

When the trimmed title matches both categories, the system SHALL report a single deterministic category (the XSS-sensitive category).

#### Scenario: XSS-sensitive title is rejected with an XSS-specific message

- **WHEN** the trimmed title matches the implemented XSS-sensitive pattern (HTML tags, `javascript:` URLs, or event-handler attributes)
- **THEN** the update SHALL fail with a `SESSION_TITLE_UNSAFE_CONTENT` SafeError
- **AND** the error message SHALL reference HTML tags, `javascript:` URLs, or event handlers
- **AND** the error SHALL NOT include the unsafe title content

#### Scenario: Secret-sensitive title is rejected with a secret-specific message

- **WHEN** the trimmed title matches the implemented secret-sensitive pattern (credentials, API keys, tokens, or passwords)
- **THEN** the update SHALL fail with a `SESSION_TITLE_UNSAFE_CONTENT` SafeError
- **AND** the error message SHALL reference credentials, API keys, or secrets
- **AND** the error SHALL NOT include the unsafe title content

#### Scenario: Title matching both categories reports the XSS category

- **WHEN** the trimmed title matches both the XSS-sensitive and the secret-sensitive patterns
- **THEN** the update SHALL fail with a single `SESSION_TITLE_UNSAFE_CONTENT` SafeError reporting the XSS-sensitive category
- **AND** the error SHALL NOT include the unsafe title content
