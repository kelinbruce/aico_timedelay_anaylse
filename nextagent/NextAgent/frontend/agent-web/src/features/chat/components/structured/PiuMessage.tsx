import { useContext, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PiuContext } from '../../context/PiuContext.tsx';
import { EXPAND_PANEL_DIV_ID, expandPanelStore } from '../../../expand-panel/ExpandPanelStore.ts';

interface PiuContent {
  readonly piuName?: string;
  readonly piuVersion?: string;
  readonly data?: unknown;
  readonly method?: string;
  readonly uuid?: string;
}

interface PiuMessageProps {
  readonly content: PiuContent;
  readonly pendingContents?: readonly PiuContent[];
  readonly isHistory?: boolean | undefined;
}

export function parsePiuContent(raw: unknown): PiuContent {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as PiuContent;
      }
    } catch {
      // ignore parse error, fall through to empty object
    }
    return {};
  }
  return (raw ?? {}) as PiuContent;
}

// 适配既有 PIU handler 契约：这些 PIU 的 handler 只接收扁平化的 content.data 业务字段，
// 不接受路由元信息（piuName/piuVersion/method）。后端 structuredPayload 不发声明字段，
// 因此用前端 view 层编译期常量白名单做受控例外。特例增多时迁移为后端声明字段方案。
const SPREAD_DATA_PIU_NAMES: ReadonlySet<string> = new Set(['dte-bi-agent']);

interface PiuHostFields {
  readonly isHistory: boolean;
  readonly wrapperId: string;
  readonly containerId: string;
  readonly handleExpandPanelOpen: () => void;
  readonly handleExpandPanelClose: () => void;
  readonly expandPanelId: string;
}

// hostFields 后置展开，确保宿主能力字段覆盖 content/data 中的同名 key。
function buildPiuEmitPayload(content: PiuContent, hostFields: PiuHostFields): unknown {
  if (SPREAD_DATA_PIU_NAMES.has(content.piuName ?? '')) {
    // content 来自不可信 stream（parsePiuContent 用 as 强转，无 runtime 校验），
    // data 可能是字符串/数组等非对象，spread 会产生垃圾 index key。此处只展开对象。
    const data = content.data;
    return { ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}), ...hostFields };
  }
  return { ...content, ...hostFields };
}

function piuContentDependency(content: PiuContent): string | object {
  try {
    return JSON.stringify(content) ?? content;
  } catch {
    return content;
  }
}

export function PiuMessage({ content, pendingContents, isHistory = false }: PiuMessageProps) {
  const { t } = useTranslation();
  const { piu } = useContext(PiuContext);
  const wrapperId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const emittedKeysRef = useRef<Set<string>>(new Set());

  const piuName = content.piuName ?? '';
  const piuVersion = content.piuVersion ?? '';
  const isValidName = piuName.length > 0;
  const contentDependency = piuContentDependency(content);
  const pendingDependency = pendingContents?.map((c) => piuContentDependency(c)).join('\n') ?? '';

  // Unmount-only cleanup: clear the PIU container when the component is removed.
  // This is separate from the emit effect so that re-renders (new pendingContents)
  // do NOT destroy the PIU host's rendered DOM between emits.
  useEffect(() => {
    const container = containerRef.current;
    let cancelled = false;
    if (!isValidName || !piu || !window.Prel) {
      return () => {
        cancelled = true;
      };
    }
    // 有 pendingContents 时按列表依次 emit（每条都执行），无则只 emit 当前 content。
    // emittedKeysRef 去重：同一 JSON 内容且同一 isHistory 不重复 emit，避免流式重发导致重复渲染。
    const contentsToEmit = pendingContents ?? [content];
    const newContents = contentsToEmit.filter((c) => {
      const key = `${isHistory}\n${JSON.stringify(c) ?? String(c)}`;
      return !emittedKeysRef.current.has(key);
    });
    if (newContents.length === 0) {
      return () => {
        cancelled = true;
      };
    }
    void window.Prel.autoLoad(piuName, piuVersion).then(() => {
      if (cancelled) {
        return;
      }
      for (const c of newContents) {
        const key = `${isHistory}\n${JSON.stringify(c) ?? String(c)}`;
        emittedKeysRef.current.add(key);
        piu.emit(
          c.method ?? '',
          buildPiuEmitPayload(c, {
            isHistory,
            wrapperId,
            containerId: wrapperId,
            handleExpandPanelOpen: () => {
              expandPanelStore.getState().close();
              expandPanelStore.getState().open();
            },
            handleExpandPanelClose: () => {
              expandPanelStore.getState().close();
            },
            expandPanelId: EXPAND_PANEL_DIV_ID,
          }),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [contentDependency, pendingDependency, piu, isValidName, piuName, piuVersion, wrapperId, isHistory]);

  useEffect(() => {
    const container = containerRef.current;
    return () => {
      container?.replaceChildren();
    };
  }, []);

  if (!isValidName || !piu || !window.Prel) {
    return (
      <div ref={containerRef} className="piu-message-wrapper" data-testid="structured-piu-message">
        {t('turn.piuLocalPreviewUnavailable')}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="piu-message-wrapper"
      id={wrapperId}
      data-testid="structured-piu-message"
      style={{ padding: '8px 0', fontSize: 13, color: 'var(--color-text-tertiary, #9ca3af)' }}
    >
      {t('turn.piuWaitingHostRender', { piuName, piuVersion })}
    </div>
  );
}
