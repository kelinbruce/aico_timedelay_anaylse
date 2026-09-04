import { QuestionCircleOutlined } from '@ant-design/icons';
import { Flex, Tooltip, Typography } from 'antd';
import type { KeyboardEventHandler, PointerEventHandler, ReactNode, RefObject, UIEventHandler, WheelEventHandler } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAICOConfig } from '../aico-config/useAICOConfig.ts';
import { PageContentFrame, PageHeader } from './PageLayout.tsx';
import './RightPaneLayout.css';

export interface RightPaneLayoutProps {
  readonly title: string;
  readonly headerExtra?: ReactNode;
  readonly children: ReactNode;
  readonly headerSlot?: ReactNode;
  readonly footer?: ReactNode;
  readonly shellTestId?: string;
  readonly scrollViewportRef?: RefObject<HTMLDivElement | null>;
  readonly onScrollViewport?: UIEventHandler<HTMLDivElement>;
  readonly onWheelViewport?: WheelEventHandler<HTMLDivElement>;
  readonly onPointerDownViewport?: PointerEventHandler<HTMLDivElement>;
  readonly onKeyDownViewport?: KeyboardEventHandler<HTMLDivElement>;
  readonly floatingOverlay?: ReactNode;
  readonly centerContent?: boolean;
}

export function RightPaneLayout({
  title,
  headerExtra,
  children,
  headerSlot,
  footer,
  shellTestId,
  scrollViewportRef,
  onScrollViewport,
  onWheelViewport,
  onPointerDownViewport,
  onKeyDownViewport,
  floatingOverlay,
  centerContent = false,
}: RightPaneLayoutProps): ReactNode {
  const { t } = useTranslation();
  const aicoConfig = useAICOConfig();
  const declaration = aicoConfig?.declaration;
  const declarationHidden = declaration === false;
  const declarationTitle = typeof declaration === 'object' ? declaration.title : t('rightPane.disclaimer');
  const declarationTips = typeof declaration === 'object' ? declaration.tips : t('rightPane.disclaimerTip');
  const internalScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const effectiveScrollViewportRef = scrollViewportRef ?? internalScrollViewportRef;
  const overlayFooterSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [overlayFooterHeight, setOverlayFooterHeight] = useState(0);
  const [scrollbarGutterWidth, setScrollbarGutterWidth] = useState(0);
  const hasFooter = Boolean(footer);

  useLayoutEffect(() => {
    const element = effectiveScrollViewportRef.current;
    if (!element) {
      setScrollbarGutterWidth(0);
      return undefined;
    }

    let animationFrame: number | null = null;
    const updateGutterWidth = () => {
      const nextWidth = Math.max(0, element.offsetWidth - element.clientWidth);
      setScrollbarGutterWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };
    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        updateGutterWidth();
      });
    };

    updateGutterWidth();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
    observer?.observe(element);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      observer?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [effectiveScrollViewportRef]);

  useLayoutEffect(() => {
    if (!hasFooter) {
      setOverlayFooterHeight(0);
      return undefined;
    }

    const element = overlayFooterSurfaceRef.current;
    if (!element) {
      return undefined;
    }

    const updateHeight = () => setOverlayFooterHeight(element.offsetHeight);

    updateHeight();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [hasFooter]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        maxHeight: '100%',
        minHeight: 0,
      }}
    >
      {headerSlot}
      <PageHeader
        title={title}
        testIds={{
          header: 'right-pane-header',
          content: 'right-pane-header-content',
          title: 'right-pane-title',
          actions: 'right-pane-actions',
        }}
        {...(headerExtra !== undefined ? { actions: headerExtra } : {})}
      />

      <div data-testid="right-pane-main" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          ref={effectiveScrollViewportRef}
          data-testid="right-pane-scroll-viewport"
          className="right-pane-scroll-viewport nextagent-themed-scrollbar"
          onScroll={onScrollViewport}
          onWheel={onWheelViewport}
          onPointerDown={onPointerDownViewport}
          onKeyDown={onKeyDownViewport}
          tabIndex={onKeyDownViewport ? 0 : undefined}
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarColor: 'var(--color-scrollbar) transparent',
            scrollbarGutter: 'stable',
            zIndex: 0,
          }}
        >
          <div
            data-testid="right-pane-content-column"
            className={`right-pane-content-column${centerContent ? ' right-pane-content-column--centered' : ''}`}
            style={{
              width: '100%',
              height: centerContent ? '100%' : undefined,
              minHeight: '100%',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              paddingBottom: hasFooter ? overlayFooterHeight : 0,
            }}
          >
            <PageContentFrame contentWidth="contained" testId="right-pane-content-frame">
              <div
                data-testid={shellTestId}
                className="right-pane-content-shell"
                style={{
                  flex: 1,
                  minHeight: 0,
                  boxShadow: 'none',
                  boxSizing: 'border-box',
                  height: centerContent ? '100%' : undefined,
                  padding: '16px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'transparent',
                  overflow: 'visible',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: centerContent ? '100%' : undefined,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: centerContent ? 'center' : 'flex-start',
                    boxSizing: 'border-box',
                    width: '100%',
                  }}
                  data-testid="right-pane-body-shell"
                >
                  {children}
                </div>
              </div>
            </PageContentFrame>
          </div>
        </div>

        {footer ? (
          <div
            data-testid="right-pane-footer-overlay"
            style={{
              position: 'absolute',
              left: 0,
              right: scrollbarGutterWidth,
              bottom: 0,
              zIndex: 4,
              pointerEvents: 'none',
            }}
          >
            {floatingOverlay ? (
              <div
                data-testid="right-pane-floating-overlay"
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  width: '100%',
                  pointerEvents: 'none',
                }}
              >
                <PageContentFrame contentWidth="contained" testId="right-pane-floating-frame">
                  <div className="right-pane-floating-content">
                    <div
                      style={{ pointerEvents: 'auto' }}
                      onWheel={(event) => {
                        onWheelViewport?.(event);
                        const viewport = effectiveScrollViewportRef.current;
                        if (viewport) {
                          viewport.scrollTop += event.deltaY;
                        }
                      }}
                    >
                      {floatingOverlay}
                    </div>
                  </div>
                </PageContentFrame>
              </div>
            ) : null}
            <div
              ref={overlayFooterSurfaceRef}
              data-testid="right-pane-footer-surface"
              style={{
                paddingTop: 12,
                background: 'var(--color-chat-pane-bg)',
              }}
            >
              <PageContentFrame contentWidth="contained" testId="right-pane-footer-content-frame">
                <div style={{ pointerEvents: 'auto' }}>{footer}</div>
              </PageContentFrame>
            </div>
          </div>
        ) : null}
      </div>

      {declarationHidden ? null : (
        <div data-testid="right-pane-disclaimer" style={{ flexShrink: 0, padding: '8px 16px' }}>
          <Flex justify="center" align="center">
            <Tooltip title={declarationTitle} placement="top">
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 1080, flexShrink: 1 }}
              >
                {declarationTitle}
              </Typography.Text>
            </Tooltip>
            <Tooltip title={<div style={{ whiteSpace: 'pre-wrap' }}>{declarationTips}</div>} placement="top">
              <QuestionCircleOutlined
                style={{ fontSize: 12, marginLeft: 4, color: 'var(--color-text-tertiary)', cursor: 'pointer', verticalAlign: 'middle' }}
              />
            </Tooltip>
          </Flex>
        </div>
      )}
    </div>
  );
}
