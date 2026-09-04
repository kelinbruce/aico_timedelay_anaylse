import { useEffect, useState } from 'react';
import { FileTypeIcon } from '../../../shared/components/FileTypeIcon.tsx';
import { truncateFileNameMiddle } from '../../../shared/components/AttachmentFileCard.tsx';
import { requestService } from '../../../../services/requestService.ts';

interface FileCardProps {
  readonly content: string;
  readonly sessionId?: string;
  readonly isDark?: boolean;
}

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'dark' || theme === 'evening';
  });
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const observer = new MutationObserver(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      setIsDark(theme === 'dark' || theme === 'evening');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function extractFileName(content: string): string {
  const normalized = content.replaceAll('\\', '/');
  const leaf = normalized.split('/').pop()?.trim() ?? '';
  return leaf.length === 0 ? content : leaf;
}

function hasPathSeparator(content: string): boolean {
  return content.includes('/') || content.includes('\\');
}

export function FileCard({ content, sessionId, isDark: isDarkProp }: FileCardProps) {
  const isDark = isDarkProp ?? useIsDarkTheme();
  const fileName = extractFileName(content);
  const canDownload = hasPathSeparator(content) && sessionId !== undefined;
  const fileNameMaxWidth = canDownload ? 291 - 16 * 2 - 24 - 8 - 8 - 1 - 48 : 291 - 16 * 2 - 24 - 8;
  const displayedFileName = truncateFileNameMiddle(fileName, fileNameMaxWidth, 14);

  const cardBackground = isDark ? 'rgba(243,243,243,0.1)' : 'rgba(201,201,201,0.2)';
  const cardBorder = isDark ? '1px solid rgba(46,134,222,1)' : '1px solid rgba(0,103,209,1)';
  const fileNameColor = isDark ? 'rgba(255,255,255,1)' : 'rgba(25,25,25,1)';
  const metaColor = isDark ? 'rgba(201,201,201,1)' : 'rgba(119,119,119,1)';
  const dividerColor = isDark ? 'rgba(119,119,119,1)' : 'rgba(201,201,201,1)';
  const downloadTextColor = isDark ? 'rgba(92,162,233,1)' : 'rgba(0,103,209,1)';

  const handleDownload = (): void => {
    if (!canDownload || sessionId === undefined) {
      return;
    }
    void requestService.downloadFile(sessionId, content);
  };

  return (
    <div
      data-testid="structured-file-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        width: 291,
        height: 58,
        borderRadius: 8,
        padding: '8px 16px',
        boxSizing: 'border-box',
        background: cardBackground,
        border: cardBorder,
        flexShrink: 0,
      }}
    >
      <FileTypeIcon fileName={fileName} size={24} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginLeft: 8,
          flex: 1,
          minWidth: 0,
          ...(canDownload ? { marginRight: 8 } : {}),
        }}
      >
        <span
          title={fileName}
          style={{
            fontSize: 14,
            lineHeight: '22px',
            color: fileNameColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayedFileName}
        </span>
        <span style={{ fontSize: 12, lineHeight: '20px', color: metaColor }}>已生成</span>
      </div>
      {canDownload ? (
        <>
          <div style={{ width: 1, height: 26, background: dividerColor, flexShrink: 0 }} />
          <div
            data-testid="file-download-button"
            onClick={handleDownload}
            style={{
              width: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 12,
              color: downloadTextColor,
              flexShrink: 0,
            }}
          >
            下载
          </div>
        </>
      ) : null}
    </div>
  );
}
