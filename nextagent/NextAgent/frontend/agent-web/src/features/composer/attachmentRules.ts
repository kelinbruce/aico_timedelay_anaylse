import i18n from '../../i18n/index.ts';

export const MAX_ATTACHMENT_COUNT = 3;
export const ACCEPTED_ATTACHMENT_EXTENSIONS = ['.md', '.markdown'];

type AttachmentFileLike = Pick<File, 'name' | 'size' | 'lastModified'>;

export type ComposerAttachmentStatus = 'uploading' | 'uploaded' | 'error' | 'expired' | 'invalid';

export interface ComposerAttachmentView {
  readonly localId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly status: ComposerAttachmentStatus;
  readonly progressPercent: number;
  readonly errorMessage: string | null;
}

export function createAttachmentFingerprint(file: AttachmentFileLike): string {
  return `${file.name.toLowerCase()}::${file.size}::${file.lastModified}`;
}

export const FILE_NAME_REGEX = /^(?=.{1,512}$)[a-zA-Z0-9&\u3010\u3011\uff08\uff09()\s_\-\.\u4e00-\u9fa5+\[\]]+\.\w+$/;

export function validateFileName(fileName: string): string | null {
  if (fileName.length > 512) {
    return i18n.t('attachments.fileNameTooLong', { fileName });
  }
  if (!FILE_NAME_REGEX.test(fileName)) {
    return i18n.t('attachments.fileNameInvalid', { fileName });
  }
  return null;
}

/**
 * Normalize bootstrap `chatUploadFileType` patterns into an extension list
 * (".md", ".pcap", ...). Falls back to the markdown-only default when the
 * config is absent or contains no usable extension, mirroring the backend
 * loader's invalid-config fallback.
 */
export function deriveAcceptedExtensions(fileTypes?: readonly string[]): readonly string[] {
  if (fileTypes === undefined || fileTypes.length === 0) {
    return ACCEPTED_ATTACHMENT_EXTENSIONS;
  }
  const extensions = fileTypes
    .map((pattern) => {
      const trimmed = pattern.trim().toLowerCase();
      return trimmed.startsWith('*.') ? trimmed.slice(1) : trimmed;
    })
    .filter((ext) => ext.startsWith('.'));
  return extensions.length === 0 ? ACCEPTED_ATTACHMENT_EXTENSIONS : extensions;
}

export function buildAcceptAttribute(fileTypes?: readonly string[]): string {
  return deriveAcceptedExtensions(fileTypes).join(',');
}

export function buildMaxFileCount(config?: { readonly chatUploadMaxFileNumber?: number }): number {
  return config?.chatUploadMaxFileNumber ?? MAX_ATTACHMENT_COUNT;
}

export function buildMaxFileSizeBytes(config?: { readonly chatUploadMaxFileSize?: number }): number {
  return (config?.chatUploadMaxFileSize ?? 5) * 1024 * 1024;
}

/**
 * Subset of the bootstrap `ChatUploadFileConfig` that client-side attachment
 * validation consumes. Optional so callers without bootstrap config keep the
 * markdown-only defaults.
 */
export interface AttachmentValidationConfig {
  readonly chatUploadFileType?: readonly string[];
  readonly chatUploadMaxFileNumber?: number;
  readonly chatUploadMaxFileSize?: number;
}

export function validateAttachmentFile(file: File, config?: AttachmentValidationConfig): string | null {
  if (config === undefined) {
    return i18n.t('attachments.uploadNotConfigured');
  }
  const nameError = validateFileName(file.name);
  if (nameError !== null) {
    return nameError;
  }
  const accepted = deriveAcceptedExtensions(config?.chatUploadFileType);
  const lower = file.name.toLowerCase();
  if (!accepted.some((ext) => lower.endsWith(ext))) {
    return i18n.t('attachments.unsupportedType', { fileName: file.name, types: accepted.join(', ') });
  }
  const maxSizeBytes = buildMaxFileSizeBytes(config);
  if (file.size > maxSizeBytes) {
    return i18n.t('attachments.tooLarge', { fileName: file.name, maxSizeMB: maxSizeBytes / (1024 * 1024) });
  }
  return null;
}

export function validateAttachmentSelection(
  incomingFiles: readonly File[],
  existingFiles: readonly AttachmentFileLike[],
  config?: AttachmentValidationConfig,
): string | null {
  if (incomingFiles.length === 0) {
    return null;
  }
  if (config === undefined) {
    return i18n.t('attachments.uploadNotConfigured');
  }

  const maxCount = buildMaxFileCount(config);
  if (existingFiles.length + incomingFiles.length > maxCount) {
    return i18n.t('attachments.tooMany', { count: maxCount });
  }

  const fingerprints = new Set(existingFiles.map((file) => createAttachmentFingerprint(file)));
  for (const file of incomingFiles) {
    const duplicateKey = createAttachmentFingerprint(file);
    if (fingerprints.has(duplicateKey)) {
      return i18n.t('attachments.duplicate', { fileName: file.name });
    }
    fingerprints.add(duplicateKey);

    const validationError = validateAttachmentFile(file, config);
    if (validationError) {
      return validationError;
    }
  }

  return null;
}

/**
 * Derive the platform `AttachmentMediaType` vocabulary from a file name, so
 * optimistic client-side attachment chips match the media type the backend
 * persists on `RequestAttachmentRecord.mediaType`. Mirrors the backend's
 * extension→mediaType mapping; unknown extensions fall back to MARKDOWN
 * (the local composer only accepts markdown anyway).
 */
export function deriveAttachmentMediaType(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([^.]+)$/u);
  const ext = match === null ? '' : match[1]!;
  switch (ext) {
    case 'pdf':
      return 'PDF';
    case 'doc':
    case 'docx':
      return 'WORD';
    case 'xls':
    case 'xlsx':
    case 'csv':
    case 'tsv':
      return 'EXCEL';
    case 'pcap':
      return 'PCAP';
    case 'pcapng':
      return 'PCAPNG';
    case 'cap':
      return 'CAP';
    case 'tmf':
      return 'TMF';
    case 'ptmf':
      return 'PTMF';
    case 'zip':
      return 'ZIP';
    case 'tar':
      return 'TAR';
    case 'rar':
      return 'RAR';
    case 'gz':
      return 'GZ';
    default:
      return 'MARKDOWN';
  }
}
