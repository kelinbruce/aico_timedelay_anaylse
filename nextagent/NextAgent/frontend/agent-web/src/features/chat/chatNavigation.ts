export interface ChatNavigationAdapter {
  readonly sessionId: string | null;
  readonly messageId?: string | null;
  readonly sessionTitle?: string | null;
  readonly openSession: (sessionId: string, options?: { readonly replace?: boolean }) => void;
  readonly openNewSession: (options?: { readonly replace?: boolean }) => void;
  readonly onSessionLoadFailure?: (sessionId: string) => void;
}
