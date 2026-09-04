import type { AttachmentMediaType } from '@nextagent/agent-common';

/**
 * Single extension -> media type mapping shared by the intake path and the
 * staged-upload path (design D1). Matching is case-insensitive; callers
 * extract the final extension segment ("a.tar.gz" -> ".gz"). Returns
 * undefined for extensions with no vocabulary mapping so the staged-upload
 * path can reject them instead of persisting a raw extension; the intake
 * path applies its explicit MARKDOWN fallback at the call site.
 */
export function attachmentMediaTypeForExtension(extension: string): AttachmentMediaType | undefined {
  switch (extension.toLowerCase()) {
    case '.pdf':
      return 'PDF';
    case '.doc':
    case '.docx':
      return 'WORD';
    case '.xls':
    case '.xlsx':
    case '.csv':
    case '.tsv':
      return 'EXCEL';
    case '.pcap':
      return 'PCAP';
    case '.pcapng':
      return 'PCAPNG';
    case '.cap':
      return 'CAP';
    case '.tmf':
      return 'TMF';
    case '.ptmf':
      return 'PTMF';
    case '.zip':
      return 'ZIP';
    case '.tar':
      return 'TAR';
    case '.rar':
      return 'RAR';
    case '.gz':
      return 'GZ';
    case '.md':
    case '.markdown':
    case '.txt':
    case '.json':
    case '.xml':
    case '.log':
      return 'MARKDOWN';
    default:
      return undefined;
  }
}
