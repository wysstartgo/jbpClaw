import { type Artifact, type ArtifactType, ArtifactTypeValue } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';

export function normalizeFilePathForDedup(filePath: string): string {
  let normalized = filePath;
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized.replace(/\\/g, '/').toLowerCase();
}

const LANGUAGE_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'code',
  tsx: 'code',
  markdown: 'markdown',
  md: 'markdown',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
};

const EXTENSION_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.mermaid': 'mermaid',
  '.mmd': 'mermaid',
  '.jsx': 'code',
  '.tsx': 'code',
  '.css': 'code',
  '.md': 'markdown',
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'document',
  '.tsv': 'document',
  '.xls': 'document',
  '.docx': 'document',
  '.xlsx': 'document',
  '.pptx': 'document',
  '.pdf': 'document',
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);
const FILE_LINK_RE = /\[([^\]]+)\]\(file:\/\/([^)]+)\)/g;
const BARE_FILE_PATH_RE = /(?:^|[\s"'`(（，。；：、!?！？])(\/?(?:[^\s"'`()（）\[\]，。；：、!?！？]+\/)*[^\s"'`()（）\[\]，。；：、!?！？]+\.(?:html?|svg|png|jpe?g|gif|webp|mermaid|mmd|jsx|tsx|css|docx|xlsx|pptx|pdf|md|txt|log|csv|tsv|xls))(?=[\s"'`)，。；：、!?！？]|$)/gim;
const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^`\n]+?)`?\s*$/gim;
const LOCAL_SERVICE_URL_RE = /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`)\]]*)?/gi;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const LOCAL_SERVICE_TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？、]+$/;
const WRITE_TOOL_NAMES = new Set(['write', 'writefile', 'write_file']);

export function getArtifactTypeFromLanguage(language: string): ArtifactType | null {
  return LANGUAGE_TO_ARTIFACT_TYPE[language.toLowerCase()] ?? null;
}

export function getArtifactTypeFromExtension(extension: string): ArtifactType | null {
  return EXTENSION_TO_ARTIFACT_TYPE[extension.toLowerCase()] ?? null;
}

export function isImageExtension(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

export function isBinaryDocumentExtension(extension: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(extension.toLowerCase());
}

function trimLocalServiceUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  while (url.endsWith(')') && !url.includes('(')) {
    url = url.slice(0, -1);
  }
  while (url.endsWith(']') && !url.includes('[')) {
    url = url.slice(0, -1);
  }
  return url.replace(LOCAL_SERVICE_TRAILING_PUNCTUATION_RE, '');
}

export function normalizeLocalServiceUrlForDedup(url: string): string {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimLocalServiceUrl(url).toLowerCase();
  }
}

function isLocalServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isHttp) return false;

    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '0.0.0.0'
      || parsed.hostname === '[::1]'
      || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function buildLocalServiceTitle(url: string, linkText?: string): string {
  const title = linkText?.trim();
  if (title && !/^https?:\/\//i.test(title)) {
    return title;
  }

  try {
    const parsed = new URL(url);
    const pathPart = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
    return pathPart || parsed.host;
  } catch {
    return url;
  }
}

export function parseLocalServiceUrlsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const seenUrls = new Set<string>();
  let index = 0;

  const addUrl = (rawUrl: string, linkText?: string) => {
    const url = trimLocalServiceUrl(rawUrl);
    if (!url || !isLocalServiceUrl(url)) return;

    const normalized = normalizeLocalServiceUrlForDedup(url);
    if (seenUrls.has(normalized)) return;
    seenUrls.add(normalized);

    artifacts.push({
      id: `artifact-local-service-${messageId}-${index}`,
      messageId,
      sessionId,
      type: ArtifactTypeValue.LocalService,
      title: buildLocalServiceTitle(url, linkText),
      content: url,
      url,
      source: 'tool',
      createdAt: Date.now(),
    });
    index += 1;
  };

  const markdownRe = new RegExp(MARKDOWN_LINK_RE.source, 'gi');
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRe.exec(messageContent)) !== null) {
    addUrl(markdownMatch[2], markdownMatch[1]);
  }

  const urlRe = new RegExp(LOCAL_SERVICE_URL_RE.source, 'gi');
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRe.exec(messageContent)) !== null) {
    addUrl(urlMatch[0]);
  }

  return artifacts;
}

export function parseCodeBlockArtifacts(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = /```(artifact:)?(\w+)(?:\s+title="([^"]*)")?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const isExplicitArtifact = Boolean(match[1]);
    const language = match[2];
    const explicitTitle = match[3];
    const content = match[4].trimEnd();
    const artifactType = getArtifactTypeFromLanguage(language);

    if (!artifactType && !isExplicitArtifact) {
      continue;
    }

    const type = artifactType ?? 'code';
    artifacts.push({
      id: `artifact-${messageId}-${index}`,
      messageId,
      sessionId,
      type,
      title: explicitTitle || generateTitle(type, language, content),
      content,
      language: type === 'code' ? language : undefined,
      source: 'codeblock',
      createdAt: Date.now(),
    });

    index += 1;
  }

  return artifacts;
}

export function stripFileLinksFromText(text: string): string {
  return text.replace(FILE_LINK_RE, '');
}

export function stripLocalServiceUrlsFromText(text: string): string {
  const withoutMarkdownLinks = text.replace(MARKDOWN_LINK_RE, (fullMatch, _linkText: string, url: string) => (
    isLocalServiceUrl(url) ? '' : fullMatch
  ));
  return withoutMarkdownLinks.replace(LOCAL_SERVICE_URL_RE, (url) => (
    isLocalServiceUrl(url) ? '' : url
  ));
}

export function parseMediaTokensFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(MEDIA_TOKEN_RE.source, 'gim');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = normalizeFileProtocolPath(match[1].trim());
    if (!filePath) continue;
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);
    artifacts.push({
      id: `artifact-media-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      source: 'tool',
      createdAt: Date.now(),
    });

    index += 1;
  }

  return artifacts;
}

export function parseFilePathsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
  idPrefix = 'artifact-path',
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(BARE_FILE_PATH_RE.source, 'gm');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = normalizeFileProtocolPath(match[1]);
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);
    artifacts.push({
      id: `${idPrefix}-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      source: 'tool',
      createdAt: Date.now(),
    });

    index += 1;
  }

  return artifacts;
}

export function parseFileLinksFromMessage(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(FILE_LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const linkText = match[1];
    let filePath: string;
    try {
      filePath = decodeURIComponent(match[2]);
    } catch {
      filePath = match[2];
    }
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);
    artifacts.push({
      id: `artifact-link-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: linkText || fileName,
      content: '',
      fileName,
      filePath,
      source: 'tool',
      createdAt: Date.now(),
    });

    index += 1;
  }

  return artifacts;
}

export function parseToolArtifact(
  toolUseMsg: CoworkMessage,
  toolResultMsg: CoworkMessage | undefined,
  sessionId: string,
): Artifact | null {
  const toolName = toolUseMsg.metadata?.toolName;
  if (!toolName || !WRITE_TOOL_NAMES.has(normalizeToolName(toolName))) {
    return null;
  }
  if (toolResultMsg?.metadata?.isError) {
    return null;
  }

  const toolInput = toolUseMsg.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!toolInput) return null;

  const filePath = extractFilePath(toolInput);
  if (!filePath) return null;

  const ext = getFileExtension(filePath);
  const artifactType = getArtifactTypeFromExtension(ext);
  if (!artifactType) return null;

  const fileName = getFileName(filePath);
  const isImage = isImageExtension(ext);
  const isBinaryDoc = isBinaryDocumentExtension(ext);
  const content = isImage || isBinaryDoc ? '' : (typeof toolInput.content === 'string' ? toolInput.content : '');

  return {
    id: `artifact-tool-${toolUseMsg.id}`,
    messageId: toolUseMsg.id,
    sessionId,
    type: artifactType,
    title: fileName,
    content,
    fileName,
    filePath,
    source: 'tool',
    createdAt: toolUseMsg.timestamp || Date.now(),
  };
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

function normalizeFileProtocolPath(filePath: string): string {
  if (filePath.startsWith('file:///')) {
    return filePath.slice(7);
  }
  if (filePath.startsWith('file://')) {
    return filePath.slice(7);
  }
  if (filePath.startsWith('file:/')) {
    return filePath.slice(5);
  }
  return filePath;
}

function extractFilePath(toolInput: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

function generateTitle(type: ArtifactType, language: string, content: string): string {
  switch (type) {
    case 'html': {
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
      return titleMatch ? titleMatch[1] : 'HTML Page';
    }
    case 'svg':
      return 'SVG Image';
    case 'mermaid':
      return 'Mermaid Diagram';
    case 'image':
      return 'Image';
    case 'markdown':
      return 'Markdown Document';
    case 'text':
      return 'Text File';
    case 'document':
      return 'Document';
    case 'react':
      return 'React Component';
    case 'code':
      return `${language.charAt(0).toUpperCase() + language.slice(1)} Code`;
    case 'local-service':
      return 'Local Service';
  }
}
