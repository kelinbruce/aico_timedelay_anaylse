import { useCallback, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from 'antd';
import { LocalLoginPage } from '#auth/LocalLoginPage';
import { AppProviders, useAppHostContext } from './app/AppProviders.tsx';
import { ChatWorkspace } from './app/ChatWorkspace.tsx';
import { FAVORITES_MAIN_CONTENT_PATH, resolveRoutedMainContentView } from './app/mainContentRoutes.ts';
import { SharedConversationPage } from './pages/SharedConversationPage.tsx';
import { CommandHelpModal } from './features/composer/components/CommandHelpModal.tsx';
import { Sidebar } from './features/sidebar/components/Sidebar.tsx';
import { FavoriteTurnsPanel } from './features/favorites/components/FavoriteTurnsPanel.tsx';
import { useUserOps } from './features/auth/useUserOps.ts';
import { PermissionUnavailable } from './features/auth/PermissionUnavailable.tsx';
import { SessionActivityConnectionController } from './features/session-activity/SessionActivityConnectionController.tsx';
import { apiClient, setAuthChallengeHandler, type AuthChallenge } from './services/apiClient.ts';
import type { ThemePreference } from './config/themePreference.ts';

const AUTH_FLAVOR = import.meta.env.VITE_AUTH_FLAVOR ?? 'local-and-iam';

export function App() {
  return (
    <AppProviders mode="local">
      <LocalAppShell />
    </AppProviders>
  );
}

function LocalAppShell() {
  const { themePreference, setLocalThemePreference } = useAppHostContext();
  const [isCommandHelpOpen, setIsCommandHelpOpen] = useState(false);
  const [authChallenge, setAuthChallenge] = useState<AuthChallenge | null>(null);
  const openCommandHelp = useCallback(() => setIsCommandHelpOpen(true), []);
  const closeCommandHelp = useCallback(() => setIsCommandHelpOpen(false), []);
  const handleAuthenticated = useCallback(() => {
    setAuthChallenge(null);
  }, []);
  const handleLogout = useCallback(async () => {
    await apiClient.post('/api/v1/auth/local/logout', {});
    setAuthChallenge({
      authMode: 'LOCAL_CONFIG',
      loginUrl: '/login',
      iamStatus: 'DISABLED',
      localLoginEnabled: true,
    });
  }, []);

  useEffect(() => {
    setAuthChallengeHandler((challenge) => setAuthChallenge(challenge));
    return () => setAuthChallengeHandler(null);
  }, []);

  const shouldShowLocalLogin = AUTH_FLAVOR !== 'iam-only' && authChallenge?.authMode === 'LOCAL_CONFIG' && authChallenge.localLoginEnabled;
  const shouldShowIamUnavailable =
    authChallenge?.authMode === 'IAM' ||
    (authChallenge?.authMode === 'LOCAL_CONFIG' && (AUTH_FLAVOR === 'iam-only' || !authChallenge.localLoginEnabled));
  const canLogout = AUTH_FLAVOR !== 'iam-only';

  const userOps = useUserOps();
  if (userOps !== null && userOps.length === 0) {
    return <PermissionUnavailable />;
  }

  const content = (
    <HashRouter>
      <Routes>
        <Route path="/shared/:shareId" element={<SharedConversationPage />} />
        <Route
          path="*"
          element={
            shouldShowLocalLogin ? (
              <LocalLoginPage onAuthenticated={handleAuthenticated} />
            ) : shouldShowIamUnavailable ? (
              <IamUnavailablePage challenge={authChallenge} />
            ) : (
              <LocalAuthenticatedShell
                onOpenHelp={openCommandHelp}
                onLogout={canLogout ? handleLogout : undefined}
                themePreference={themePreference}
                onThemePreferenceChange={setLocalThemePreference}
              />
            )
          }
        />
      </Routes>
    </HashRouter>
  );

  return (
    <>
      {content}
      <CommandHelpModal open={isCommandHelpOpen} onClose={closeCommandHelp} />
    </>
  );
}

function LocalAuthenticatedShell({
  onOpenHelp,
  onLogout,
  themePreference,
  onThemePreferenceChange,
}: {
  readonly onOpenHelp: () => void;
  readonly onLogout?: (() => void | Promise<void>) | undefined;
  readonly themePreference: ThemePreference;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const routedContentView = resolveRoutedMainContentView(location.pathname);
  const contentView = routedContentView === 'favorites' ? 'favorites' : 'conversation';
  const isConversationSurfaceVisible = contentView === 'conversation' && (location.pathname === '/' || /^\/session\/[^/]+$/.test(location.pathname));

  const openFavorite = useCallback(
    (sessionId: string, rootMessageId: string) => {
      navigate(`/session/${encodeURIComponent(sessionId)}?messageId=${encodeURIComponent(rootMessageId)}`);
    },
    [navigate],
  );

  const selectFavorites = useCallback(() => {
    navigate(FAVORITES_MAIN_CONTENT_PATH, {
      replace: location.pathname === FAVORITES_MAIN_CONTENT_PATH,
    });
  }, [location.pathname, navigate]);

  return (
    <>
      <SessionActivityConnectionController />
      <div style={{ display: 'flex', height: '100vh' }}>
        <Sidebar
          onOpenHelp={onOpenHelp}
          onLogout={onLogout}
          themePreference={themePreference}
          onThemePreferenceChange={onThemePreferenceChange}
          onSelectFavorites={selectFavorites}
          favoritesActive={contentView === 'favorites'}
          isConversationSurfaceVisible={isConversationSurfaceVisible}
        />
        <div data-testid="local-main-content" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {contentView === 'favorites' ? (
            <FavoriteTurnsPanel onOpenFavorite={openFavorite} />
          ) : (
            <ChatWorkspace onOpenHelp={onOpenHelp} isConversationSurfaceVisible={isConversationSurfaceVisible} />
          )}
        </div>
      </div>
    </>
  );
}

function IamUnavailablePage({ challenge }: { readonly challenge: AuthChallenge | null }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Alert
        type="warning"
        showIcon
        message={challenge?.authMode === 'LOCAL_CONFIG' ? 'Authentication mode is unavailable' : 'IAM identity is unavailable'}
      />
    </main>
  );
}
