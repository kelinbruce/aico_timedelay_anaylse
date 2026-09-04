import type { SafeError } from '@nextagent/agent-common';
import type { UserQueryGateway } from '@nextagent/agent-contracts/gateway';

export function createLocalUserQueryGateway(): UserQueryGateway {
  return {
    async queryUsers(request, signal) {
      if (signal?.aborted === true) {
        return canceledUserQueryError();
      }
      return {
        users: request.targetSubjectIds.map((subjectId) => ({ subjectId, userName: `${subjectId}-name` })),
      };
    },
  };
}

function canceledUserQueryError(): SafeError {
  return {
    code: 'USER_QUERY_CANCELED',
    message: 'User query was canceled.',
    category: 'CANCELED',
    retryable: false,
  };
}
