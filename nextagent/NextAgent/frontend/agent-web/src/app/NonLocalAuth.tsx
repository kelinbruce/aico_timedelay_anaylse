import { useEffect } from 'react';
import { setAuthChallengeHandler } from '../services/apiClient.ts';
import { NON_LOCAL_LOGIN_URL } from '../host/prel.ts';

export function useNonLocalAuthRedirect() {
  useEffect(() => {
    setAuthChallengeHandler(() => {
      window.location.assign(NON_LOCAL_LOGIN_URL);
    });
    return () => setAuthChallengeHandler(null);
  }, []);
}
