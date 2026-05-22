import { QingShuFileToolName } from './constants';

export const QINGSHU_FILE_PUBLISH_PROMPT = [
  '## QingShu Cross-Device File Sharing',
  '',
  `- When you need to share a generated local file with the user (image, HTML, PDF, PPTX, DOCX, XLSX, CSV, Markdown, or other artifact), call \`${QingShuFileToolName.Publish}\` with the local file path before presenting the link.`,
  '- Local filesystem paths are only valid on this machine. Do not present a local path as a cross-device link for phones or other terminals.',
  '- The upload tool requires QingShu login and accepts files up to 50MB.',
  '- Return the `shareUrl` from the tool result as the user-facing link, and mention the original local path only as a local reference when useful.',
].join('\n');
