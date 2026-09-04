import { useState, type ReactNode } from 'react';
import { FileTypeIcon } from './FileTypeIcon.tsx';

export type AttachmentFileCardSurface = 'composer' | 'conversation';

const CARD_WIDTH = 168;
const CARD_HEIGHT = 58;
const CARD_PADDING_X = 16;
const ICON_SIZE = 24;
const ICON_MARGIN_RIGHT = 8;
const NAME_FONT_SIZE = 14;
const NAME_MAX_WIDTH = CARD_WIDTH - CARD_PADDING_X * 2 - ICON_SIZE - ICON_MARGIN_RIGHT;
const REMOVE_BUTTON_CLEARANCE = 18;

const WIDE_CHAR_REGEX = /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/u;

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += WIDE_CHAR_REGEX.test(char) ? fontSize : fontSize * 0.55;
  }
  return width;
}

const ELLIPSIS = '...';

export function truncateFileNameMiddle(fileName: string, maxWidth: number, fontSize: number): string {
  if (estimateTextWidth(fileName, fontSize) <= maxWidth) {
    return fileName;
  }
  const dotIndex = fileName.lastIndexOf('.');
  const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1;
  const baseName = hasExtension ? fileName.slice(0, dotIndex) : fileName;
  const extension = hasExtension ? fileName.slice(dotIndex + 1) : '';
  const budget = maxWidth - estimateTextWidth(ELLIPSIS + extension, fontSize);
  let kept = '';
  for (const char of baseName) {
    if (estimateTextWidth(kept + char, fontSize) > budget) {
      break;
    }
    kept += char;
  }
  return `${kept}${ELLIPSIS}${extension}`;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${sizeBytes} B`;
}

interface AttachmentFileCardProps {
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly isDark: boolean;
  readonly surface: AttachmentFileCardSurface;
  readonly testId?: string;
  readonly expired?: boolean;
  readonly footer?: ReactNode;
  readonly onRemove?: (() => void) | undefined;
  readonly removeTestId?: string;
  readonly removeAriaLabel?: string;
}

export function AttachmentFileCard({
  fileName,
  sizeBytes,
  isDark,
  surface,
  testId,
  expired = false,
  footer,
  onRemove,
  removeTestId,
  removeAriaLabel,
}: AttachmentFileCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const background = isDark ? 'rgba(243,243,243,0.2)' : surface === 'conversation' ? '#ffffff' : 'rgba(25,25,25,0.05)';
  const nameColor = isDark ? '#ffffff' : 'rgba(25,25,25,1)';
  const metaColor = isDark ? 'rgba(201,201,201,1)' : 'rgb(119,119,119)';
  const nameMaxWidth = onRemove && isHovered ? NAME_MAX_WIDTH - REMOVE_BUTTON_CLEARANCE : NAME_MAX_WIDTH;
  return (
    <div
      data-testid={testId}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        padding: `8px ${CARD_PADDING_X}px`,
        borderRadius: 8,
        background,
        opacity: expired ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <FileTypeIcon fileName={fileName} size={ICON_SIZE} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          textAlign: 'left',
          minWidth: 0,
          marginLeft: ICON_MARGIN_RIGHT,
          flex: 1,
        }}
      >
        <span
          title={fileName}
          style={{
            fontSize: NAME_FONT_SIZE,
            lineHeight: '22px',
            color: nameColor,
            maxWidth: '100%',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {truncateFileNameMiddle(fileName, nameMaxWidth, NAME_FONT_SIZE)}
        </span>
        <span style={{ fontSize: 12, lineHeight: '20px', color: metaColor, maxWidth: '100%' }}>{footer ?? formatFileSize(sizeBytes)}</span>
      </div>
      {onRemove ? (
        <button
          type="button"
          data-testid={removeTestId}
          aria-label={removeAriaLabel ?? 'remove attachment'}
          onClick={onRemove}
          tabIndex={isHovered ? 0 : -1}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            opacity: isHovered ? 1 : 0,
            pointerEvents: isHovered ? 'auto' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            padding: 0,
            borderRadius: '50%',
            border: isDark ? '1px solid rgba(243,243,243,0.4)' : '1px solid rgba(25,25,25,0.15)',
            background: isDark ? '#4a4a4a' : '#ffffff',
            cursor: 'pointer',
          }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
            <path
              d="M1.5 1.5l5 5M6.5 1.5l-5 5"
              stroke={isDark ? 'rgba(243,243,243,0.85)' : 'rgba(25,25,25,0.65)'}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
