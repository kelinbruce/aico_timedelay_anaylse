import React, { useRef, useState } from 'react';
import { Modal, Input, Button, Switch, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { shareService, type ShareExpiry } from '../../../services/shareService.ts';

/**
 * In remote (immersive/piu) mode the app is embedded in a host service page
 * (e.g. https://{host}:31943/ossfacewebsite/index.html#/). The shared
 * conversation page only exists on the AFWebsite service, so the share URL
 * must point there. In local mode the current page URL is correct as-is.
 */
function resolveShareOriginUrl(isRemoteMode: boolean): string {
  if (!isRemoteMode) {
    return window.location.href;
  }
  const url = new URL(window.location.href);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 0) {
    segments[0] = 'AFWebsite';
    url.pathname = '/' + segments.join('/');
  }
  return url.href;
}

export interface ShareSettingsModalProps {
  readonly open: boolean;
  readonly sessionId: string;
  readonly runIds: readonly string[];
  readonly isRemoteMode: boolean;
  readonly userOps: readonly string[] | null;
  readonly onCancel: () => void;
}

export function ShareSettingsModal({ open, sessionId, runIds, isRemoteMode, userOps, onCancel }: ShareSettingsModalProps) {
  const { t } = useTranslation();
  const [expiresIn, setExpiresIn] = useState<ShareExpiry>('7d');
  const [keepPermissions, setKeepPermissions] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleDragStart = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.ant-modal-header')) {
      return;
    }
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, offsetX: dragOffset.x, offsetY: dragOffset.y };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) {
        return;
      }
      setDragOffset({
        x: dragStartRef.current.offsetX + ev.clientX - dragStartRef.current.mouseX,
        y: dragStartRef.current.offsetY + ev.clientY - dragStartRef.current.mouseY,
      });
    };
    const handleMouseUp = () => {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleGenerate = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setShareUrl(null);
    try {
      const allowedOps = isRemoteMode && keepPermissions && userOps ? userOps : null;
      const result = await shareService.createShare({
        sessionId,
        runIds,
        originUrl: resolveShareOriginUrl(isRemoteMode),
        expiresIn,
        allowedOps,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        return;
      }
      setShareUrl(result.shareUrl);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }
      message.error(t('share.generateFailed'));
    } finally {
      if (controller.signal.aborted) {
        return;
      }
      setLoading(false);
    }
  };

  const handleCopyUrl = () => {
    if (shareUrl) {
      navigator.clipboard?.writeText(shareUrl);
      message.success(t('share.copied'));
      handleClose();
    }
  };

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setShareUrl(null);
    setExpiresIn('7d');
    setKeepPermissions(false);
    setDragOffset({ x: 0, y: 0 });
    onCancel();
  };

  return (
    <Modal
      title={t('share.settings')}
      open={open}
      onCancel={handleClose}
      mask={false}
      centered
      width={452}
      modalRender={(node) => (
        <div style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }} onMouseDown={handleDragStart}>
          {node}
        </div>
      )}
      footer={
        shareUrl
          ? [
              <Button key="copy" icon={<CopyOutlined />} onClick={handleCopyUrl} data-testid="share-copy-url-btn">
                {t('share.copyUrl')}
              </Button>,
              <Button key="close" onClick={handleClose}>
                {t('share.close')}
              </Button>,
            ]
          : [
              <Button key="cancel" onClick={handleClose}>
                {t('share.cancel')}
              </Button>,
              <Button key="generate" type="primary" onClick={handleGenerate} loading={loading} data-testid="share-generate-btn">
                {loading ? t('share.generating') : t('share.generate')}
              </Button>,
            ]
      }
    >
      {shareUrl ? (
        <div data-testid="share-url-display">
          <p style={{ marginBottom: 8, color: 'var(--color-recommend-question)' }}>{t('share.urlLabel')}</p>
          <Input value={shareUrl} readOnly style={{ width: '100%', marginBottom: 16 }} />
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 8, color: 'var(--color-recommend-question)' }}>{t('share.expiry')}</p>
            <div
              data-testid="share-expiry-segmented"
              style={{
                width: 404,
                height: 32,
                borderRadius: 6,
                background: 'var(--bg-input-context)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 2px',
                boxSizing: 'border-box',
              }}
            >
              {(['24h', '7d', '30d', 'permanent'] as const).map((value) => (
                <div
                  key={value}
                  data-testid={`share-expiry-option-${value}`}
                  onClick={() => setExpiresIn(value)}
                  style={{
                    flex: 1,
                    height: 28,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: 14,
                    userSelect: 'none',
                    transition: 'background 120ms ease, color 120ms ease',
                    background: expiresIn === value ? 'var(--send-icon-enabled)' : 'transparent',
                    color: expiresIn === value ? '#ffffff' : 'var(--color-recommend-question)',
                  }}
                >
                  {t(`share.${value}`)}
                </div>
              ))}
            </div>
          </div>
          {isRemoteMode ? (
            <div
              data-testid="share-permission-section"
              style={{
                height: 22,
                marginTop: 16,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <Switch checked={keepPermissions} onChange={(checked) => setKeepPermissions(checked)} />
              <span style={{ fontSize: 14, color: 'var(--color-recommend-question)' }}>{t('share.keepPermissions')}</span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
