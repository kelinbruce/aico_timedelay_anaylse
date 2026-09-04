import { useEffect, useId, useRef, useContext, type CSSProperties } from 'react';
import { PiuContext } from '../features/chat/context/PiuContext.tsx';
import type { HostTheme } from '../app/hostTypes.ts';
import type { PIUInfoItem } from './types.ts';

export interface PiuRendererProps {
  readonly piuInfo: PIUInfoItem;
  readonly extraPayload?: Readonly<Record<string, unknown>>;
  readonly containerStyle?: CSSProperties;
  readonly containerClassName?: string;
  readonly theme?: HostTheme;
}

export function PiuRenderer({ piuInfo, extraPayload, containerStyle, containerClassName, theme }: PiuRendererProps) {
  const { piu } = useContext(PiuContext);
  const rawId = useId();
  const containerId = `piu-renderer-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const containerEl = containerRef.current;
    if (!piu || !window.Prel) {
      return undefined;
    }
    let cancelled = false;
    void window.Prel.autoLoad(piuInfo.piuName, piuInfo.piuVersion).then(() => {
      if (cancelled) {
        return;
      }
      piu.emit(piuInfo.renderFunc, {
        ...piuInfo.data,
        ...extraPayload,
        theme,
        containerId,
      });
    });
    return () => {
      cancelled = true;
      if (containerEl) {
        containerEl.replaceChildren();
      }
    };
  }, [piu, piuInfo.piuName, piuInfo.piuVersion, piuInfo.renderFunc, piuInfo.data, extraPayload, theme, containerId]);

  if (!piu || !window.Prel) {
    return (
      <div
        data-testid="piu-renderer-placeholder"
        style={{ padding: '8px 0', fontSize: 13, color: 'var(--color-text-tertiary, #9ca3af)', ...containerStyle }}
        className={containerClassName}
      >
        PIU 内容（本地不可预览）
      </div>
    );
  }

  return <div ref={containerRef} id={containerId} data-testid="piu-renderer-container" style={containerStyle} className={containerClassName} />;
}
