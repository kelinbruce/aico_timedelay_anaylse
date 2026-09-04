import { useCallback, useMemo } from 'react';
import { Button, Tooltip } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useAICOConfigSnapshot } from './useAICOConfig.ts';
import { aicoConfigStore } from './AICOConfigStore.ts';
import { PiuRenderer } from './PiuRenderer.tsx';

export interface CustomPanelRendererProps {
  readonly isDark: boolean;
  readonly style?: React.CSSProperties;
}

export function CustomPanelRenderer({ isDark, style }: CustomPanelRendererProps) {
  const snapshot = useAICOConfigSnapshot();
  const data = snapshot.activePanelOperatorData;

  const backFunc = useCallback(() => {
    aicoConfigStore.setActivePanelOperator(null);
  }, []);

  // PiuRenderer's useEffect depends on extraPayload; an inline { backFunc }
  // literal creates a new object every render, causing the effect to re-run
  // (cleanup wipes DOM + async re-emit) on every parent re-render such as
  // drag/resize. useMemo keeps the reference stable.
  const piuExtraPayload = useMemo(() => ({ backFunc }), [backFunc]);

  if (!data) {
    return null;
  }

  return (
    <div data-testid="custom-panel-container" style={{ width: '100%', height: '100%', position: 'relative', ...style }}>
      <Tooltip title="返回">
        <Button
          type="text"
          size="small"
          onClick={backFunc}
          icon={<ArrowLeftOutlined />}
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 1 }}
        />
      </Tooltip>
      <PiuRenderer
        piuInfo={data}
        theme={isDark ? 'evening' : 'lightday'}
        extraPayload={piuExtraPayload}
        containerStyle={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

export function useIsCustomPanelActive(): boolean {
  return useAICOConfigSnapshot().panelType === 'CUSTOM_PANEL';
}
