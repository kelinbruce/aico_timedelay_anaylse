# agent-web-pending-input-ui Specification

## Purpose
定义 Agent Web 对 canonical active pending input 的响应面投影、与普通 Composer 的互斥和恢复、展示型过期状态及 owning-request 取消委托；runtime、channel 和既有 Pending Input capability 继续拥有 kind、payload、authority 与生命周期。
## Requirements
### Requirement: Active pending input replaces the normal Composer

agent-web SHALL treat the current active pending input as an exclusive Composer state. While the current conversation has an active pending input, agent-web MUST render one pending-input response surface and MUST NOT render the normal message Composer. For `QUESTION`、`CONFIRMATION`、`AUTHORIZATION` and `HUMAN_HANDOFF`, the response surface MUST select controls for that canonical kind; accepted answer values and answer shapes remain governed by the existing Pending Input capabilities and are not redefined by this capability.

#### Scenario: Question pending input activates question controls
- **WHEN** the current conversation frontend state activates a canonical `QUESTION` pending input
- **THEN** agent-web MUST replace the normal message Composer with question response controls
- **AND** the normal message textarea MUST NOT remain available at the same time

#### Scenario: Confirmation pending input activates confirmation controls
- **WHEN** the current conversation frontend state activates a canonical `CONFIRMATION` pending input
- **THEN** agent-web MUST replace the normal message Composer with confirmation response controls
- **AND** this capability MUST NOT define fallback confirmation answer values

#### Scenario: Authorization pending input activates authorization controls
- **WHEN** the current conversation frontend state activates a canonical `AUTHORIZATION` pending input
- **THEN** agent-web MUST replace the normal message Composer with authorization response controls

#### Scenario: Human handoff pending input activates handoff controls
- **WHEN** the current conversation frontend state activates a canonical `HUMAN_HANDOFF` pending input
- **THEN** agent-web MUST replace the normal message Composer with controls for the handoff mode and handoff content defined by the existing `human-handoff` capability

### Requirement: Resolved pending input restores the normal Composer

agent-web SHALL clear its local active pending-input UI and restore the normal message Composer after the answer request for that active input succeeds. agent-web MUST also restore the normal message Composer when the current conversation stream reports the active pending input as received、timed out or canceled. This capability defines only the frontend state transition and MUST NOT redefine the answer route、stream payload or runtime resolution lifecycle.

#### Scenario: Successful answer restores the Composer
- **WHEN** agent-web successfully submits ordered answers for the current active pending input
- **THEN** agent-web MUST remove the pending-input response surface
- **AND** the normal message Composer MUST become available again

#### Scenario: Received outcome restores the Composer
- **WHEN** the current conversation stream reports canonical `USER_INPUT_RECEIVED` for the active pending input
- **THEN** agent-web MUST remove the pending-input response surface
- **AND** the normal message Composer MUST become available again

#### Scenario: Timeout outcome restores the Composer
- **WHEN** the current conversation stream reports canonical `USER_INPUT_TIMEOUT` for the active pending input
- **THEN** agent-web MUST remove the pending-input response surface
- **AND** the normal message Composer MUST become available again

#### Scenario: Canceled outcome restores the Composer
- **WHEN** the current conversation stream reports canonical `USER_INPUT_CANCELED` for the active pending input
- **THEN** agent-web MUST remove the pending-input response surface
- **AND** the normal message Composer MUST become available again

### Requirement: Projected pending-input expiration is display-only

When the current active pending input includes a projected expiration coordinate, agent-web SHALL display a remaining-time or expired status that reflects the passage of local time. Reaching the projected expiration locally MUST NOT submit an answer, authorize an operation, request cancellation, or clear the active pending-input response surface. The frontend MUST wait for a canonical resolved outcome before restoring the normal Composer. Without a projected expiration coordinate, this capability does not require an expiration indicator. This requirement does not define timeout policy, timer cadence, exact formatting, or stream payload shape.

#### Scenario: Projected expiration is shown
- **GIVEN** the current active pending input includes a projected expiration coordinate in the future
- **WHEN** agent-web renders its response surface
- **THEN** agent-web MUST display a remaining-time status
- **AND** that status MUST reflect the passage of local time

#### Scenario: Local countdown expiry does not resolve the input
- **GIVEN** the current active pending input includes a projected expiration coordinate
- **WHEN** local time reaches or passes that coordinate before a canonical resolved outcome arrives
- **THEN** agent-web MUST keep the pending-input response surface active
- **AND** MUST NOT submit an answer, authorize an operation, request cancellation, or restore the normal Composer because of the local countdown alone

#### Scenario: Missing expiration coordinate has no countdown obligation
- **GIVEN** the current active pending input has no projected expiration coordinate
- **WHEN** agent-web renders its response surface
- **THEN** this capability MUST NOT require an expiration indicator

### Requirement: Pending-input cancel actions delegate to the owning request

The canonical `QUESTION` and `HUMAN_HANDOFF` response surfaces SHALL expose a cancel action. When the user activates that action, agent-web MUST delegate cancellation using the active pending input's owning request coordinate. The frontend MUST NOT synthesize `USER_INPUT_CANCELED` or clear the response surface merely because the cancel request succeeds; it MUST wait for a canonical resolved outcome before restoring the normal Composer. Runtime cancellation authority, idempotency, and terminal lifecycle remain outside this capability. This requirement does not define whether other pending-input kinds expose a cancel action.

#### Scenario: Question cancel delegates to the owning request
- **GIVEN** a canonical `QUESTION` pending input is active for a request
- **WHEN** the user activates its cancel action
- **THEN** agent-web MUST request cancellation for that owning request
- **AND** MUST keep the response surface active until a canonical resolved outcome arrives

#### Scenario: Human handoff exposes the same owning-request cancel action
- **GIVEN** a canonical `HUMAN_HANDOFF` pending input is active for a request
- **WHEN** the user activates its cancel action
- **THEN** agent-web MUST request cancellation for that owning request

#### Scenario: Canonical canceled outcome completes frontend restoration
- **GIVEN** agent-web has requested cancellation for the active pending input's owning request
- **WHEN** the current conversation stream reports canonical `USER_INPUT_CANCELED` for that input
- **THEN** agent-web MUST remove the response surface
- **AND** MUST restore the normal message Composer
