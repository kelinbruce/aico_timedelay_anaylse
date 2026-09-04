import { useState } from 'react';
import { Modal } from 'antd';
import { MarkdownContent } from '../chat/components/MarkdownContent.tsx';

export interface KnowledgeSourceItem {
  readonly source: string;
  readonly title: string;
  readonly knowledge: string;
}

export interface RenderKnowledgePayload {
  readonly containerId: string;
  readonly data: readonly KnowledgeSourceItem[];
}

// List item title resolution (priority descending):
// 1. source split by "|", take first segment, trim, non-empty -> use
// 2. empty -> title, trim, non-empty -> use
// 3. empty -> first 100 chars of knowledge
export function resolveKnowledgeTitle(item: KnowledgeSourceItem): string {
  const firstSourceSegment = (item.source.split('|')[0] ?? '').trim();
  if (firstSourceSegment.length > 0) {
    return firstSourceSegment;
  }
  const trimmedTitle = item.title.trim();
  if (trimmedTitle.length > 0) {
    return trimmedTitle;
  }
  return item.knowledge.slice(0, 100);
}

interface KnowledgeSourceListProps {
  readonly data: readonly KnowledgeSourceItem[];
}

export function KnowledgeSourceList({ data }: KnowledgeSourceListProps) {
  const [activeItem, setActiveItem] = useState<KnowledgeSourceItem | null>(null);

  return (
    <div data-testid="knowledge-source-list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {data.length === 0
        ? null
        : data.map((item, index) => {
            const title = resolveKnowledgeTitle(item);
            return (
              <button
                key={`knowledge-${index}`}
                data-testid="knowledge-source-item"
                onClick={() => setActiveItem(item)}
                style={{
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  padding: '8px 12px',
                  borderRadius: 6,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 14,
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                }}
              >
                {title}
              </button>
            );
          })}
      <Modal
        open={activeItem !== null}
        onCancel={() => setActiveItem(null)}
        footer={null}
        width={800}
        destroyOnClose
        centered
        title={'\u200B'}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        classNames={{ body: 'nextagent-trackless-scrollbar' }}
      >
        {activeItem ? <MarkdownContent content={activeItem.knowledge} /> : null}
      </Modal>
    </div>
  );
}
