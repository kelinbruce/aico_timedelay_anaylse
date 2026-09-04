import { Route, Routes } from 'react-router-dom';
import { ChatPage, type ChatPageProps } from '../pages/ChatPage.tsx';
import { CronTaskDashboardPage } from '../pages/CronTaskDashboardPage.tsx';

export interface ChatWorkspaceProps extends Pick<ChatPageProps, 'onOpenHelp' | 'composerBridgeRef'> {
  readonly isConversationSurfaceVisible: boolean;
}

export function ChatWorkspace({ onOpenHelp, composerBridgeRef, isConversationSurfaceVisible }: ChatWorkspaceProps) {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ChatPage onOpenHelp={onOpenHelp} composerBridgeRef={composerBridgeRef} isConversationSurfaceVisible={isConversationSurfaceVisible} />
        }
      />
      <Route
        path="/session/:sessionId"
        element={
          <ChatPage onOpenHelp={onOpenHelp} composerBridgeRef={composerBridgeRef} isConversationSurfaceVisible={isConversationSurfaceVisible} />
        }
      />
      <Route path="/cron-tasks" element={<CronTaskDashboardPage />} />
    </Routes>
  );
}
