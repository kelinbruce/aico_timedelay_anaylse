const EXCEL_EXTENSIONS = new Set(['xls', 'xlsx', 'csv']);
const WORD_EXTENSIONS = new Set(['doc', 'docx']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

type FileTypeKind = 'excel' | 'word' | 'markdown' | 'pdf' | 'archive' | 'generic';

const KIND_COLORS: Record<FileTypeKind, string> = {
  excel: '#1a7f37',
  word: '#2563eb',
  markdown: '#475569',
  pdf: '#d4380d',
  archive: '#d97706',
  generic: '#6b7280',
};

const KIND_LABELS: Record<FileTypeKind, string> = {
  excel: 'XLS',
  word: 'DOC',
  markdown: 'MD',
  pdf: 'PDF',
  archive: 'ZIP',
  generic: 'FILE',
};

export function resolveFileTypeKind(fileName: string): FileTypeKind {
  const dotIndex = fileName.lastIndexOf('.');
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
  if (EXCEL_EXTENSIONS.has(extension)) {
    return 'excel';
  }
  if (WORD_EXTENSIONS.has(extension)) {
    return 'word';
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return 'markdown';
  }
  if (extension === 'pdf') {
    return 'pdf';
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return 'archive';
  }
  return 'generic';
}

interface FileTypeIconProps {
  readonly fileName: string;
  readonly size?: number;
}

export function FileTypeIcon({ fileName, size = 24 }: FileTypeIconProps) {
  const kind = resolveFileTypeKind(fileName);
  const color = KIND_COLORS[kind];
  const label = KIND_LABELS[kind];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      data-testid={`file-type-icon-${kind}`}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h8L20 7.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-18Z" fill={color} />
      <path d="M13.5 1 20 7.5h-5.25A1.25 1.25 0 0 1 13.5 6.25V1Z" fill="rgba(255,255,255,0.35)" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize={label.length > 3 ? 5.5 : 6.5}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#ffffff"
      >
        {label}
      </text>
    </svg>
  );
}
