import '@ant-design/v5-patch-for-react-19';
import 'antd/dist/reset.css';
import { ConfigProvider } from 'antd';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('agent-dev-workbench-root');

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ConfigProvider
        theme={{
          token: {
            borderRadius: 6,
            colorPrimary: '#2563eb',
            colorInfo: '#2563eb',
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          },
        }}
      >
        <App />
      </ConfigProvider>
    </React.StrictMode>,
  );
}
