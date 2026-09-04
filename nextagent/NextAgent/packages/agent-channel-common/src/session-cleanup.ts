import { getLogger, type IdentityContext, type SessionId } from '@nextagent/agent-common';
import type { RuntimeSessionPort } from '@nextagent/agent-contracts/runtime';

const logger = getLogger({ component: 'agent-channel-common', source: 'session-cleanup' });

export async function cleanupOrphanSession(sessions: RuntimeSessionPort, identity: IdentityContext, sessionId: SessionId): Promise<void> {
  try {
    await sessions.deleteSession({ identityContext: identity, sessionId });
  } catch (error) {
    logger.warn({ err: error, event: 'channel.session.cleanup_failed', sessionId: String(sessionId) });
  }
}
