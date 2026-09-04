import { ArrowLeftOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import './PageLayout.css';

export type PageContentWidth = 'contained' | 'fluid';
export type PageScrollOwner = 'layout' | 'content';

export interface PageBackAction {
  readonly ariaLabel: string;
  readonly onClick: () => void;
}

interface PageHeaderTestIds {
  readonly header?: string;
  readonly content?: string;
  readonly title?: string;
  readonly actions?: string;
}

interface PageHeaderProps {
  readonly title: string;
  readonly backAction?: PageBackAction;
  readonly actions?: ReactNode;
  readonly testIds?: PageHeaderTestIds;
}

export interface PageContentFrameProps {
  readonly contentWidth?: PageContentWidth;
  readonly children: ReactNode;
  readonly testId?: string;
}

export interface PageLayoutProps {
  readonly title: string;
  readonly backAction?: PageBackAction;
  readonly actions?: ReactNode;
  readonly contentWidth?: PageContentWidth;
  readonly scrollOwner?: PageScrollOwner;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}

export function PageHeader({ title, backAction, actions, testIds }: PageHeaderProps): ReactNode {
  const hasActions = actions !== undefined && actions !== null;

  return (
    <header
      className="page-header"
      data-testid={testIds?.header ?? 'page-layout-header'}
      style={{
        height: 48,
        paddingLeft: 16,
        paddingRight: 16,
        background: 'transparent',
        boxShadow: 'none',
      }}
    >
      <div className="page-header__content" data-testid={testIds?.content ?? 'page-layout-header-content'} style={{ flexWrap: 'nowrap' }}>
        <div className="page-header__leading">
          {backAction ? (
            <button type="button" className="page-header__back" aria-label={backAction.ariaLabel} onClick={backAction.onClick}>
              <ArrowLeftOutlined />
            </button>
          ) : null}
          <h1
            className="page-header__title"
            data-testid={testIds?.title ?? 'page-layout-title'}
            title={title}
            style={{
              fontSize: 16,
              fontWeight: 500,
              lineHeight: '28px',
            }}
          >
            {title}
          </h1>
        </div>

        {hasActions ? (
          <div className="page-header__actions" data-testid={testIds?.actions ?? 'page-layout-actions'}>
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function PageContentFrame({ contentWidth = 'contained', children, testId = 'page-layout-content-frame' }: PageContentFrameProps): ReactNode {
  return (
    <div
      className={`page-content-frame page-content-frame--${contentWidth}`}
      data-content-width={contentWidth}
      data-testid={testId}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        margin: '0 auto',
        paddingLeft: 16,
        paddingRight: 16,
        maxWidth: contentWidth === 'contained' ? 1080 : undefined,
      }}
    >
      {children}
    </div>
  );
}

export function PageLayout({
  title,
  backAction,
  actions,
  contentWidth = 'contained',
  scrollOwner = 'layout',
  footer,
  children,
}: PageLayoutProps): ReactNode {
  return (
    <div className="page-layout" data-testid="page-layout-root">
      <PageHeader title={title} {...(backAction ? { backAction } : {})} {...(actions !== undefined ? { actions } : {})} />
      <main className={`page-layout__main page-layout__main--${scrollOwner}`} data-testid="page-layout-main">
        {scrollOwner === 'layout' ? (
          <div className="page-layout__scroll-viewport nextagent-themed-scrollbar" data-testid="page-layout-scroll-viewport">
            <PageContentFrame contentWidth={contentWidth}>{children}</PageContentFrame>
          </div>
        ) : (
          <PageContentFrame contentWidth={contentWidth}>{children}</PageContentFrame>
        )}
      </main>
      {footer ? (
        <footer className="page-layout__footer" data-testid="page-layout-footer">
          <PageContentFrame contentWidth={contentWidth} testId="page-layout-footer-frame">
            {footer}
          </PageContentFrame>
        </footer>
      ) : null}
    </div>
  );
}
