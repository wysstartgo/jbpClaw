import { ArrowTopRightOnSquareIcon, FolderOpenIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '@/services/i18n';
import { selectArtifact } from '@/store/slices/artifactSlice';
import type { Artifact, ArtifactType } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <ellipse cx="12" cy="12" rx="4.5" ry="10" />
    <path d="M2 12h20" />
  </svg>
);

const SvgIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const ImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const MermaidIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="8.5" y="14" width="7" height="7" rx="1" />
    <path d="M6.5 10v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
    <path d="M12 12.5V14" />
  </svg>
);

const MarkdownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 15V9l2.5 3L12 9v6" />
    <path d="M17 12l-2 3h4l-2-3z" />
  </svg>
);

const TextIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

const DocumentIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <rect x="8" y="12" width="8" height="6" rx="1" />
  </svg>
);

const TYPE_ICON_MAP: Record<ArtifactType, React.FC<{ className?: string }>> = {
  html: GlobeIcon,
  svg: SvgIcon,
  image: ImageIcon,
  mermaid: MermaidIcon,
  react: GlobeIcon,
  code: GlobeIcon,
  markdown: MarkdownIcon,
  text: TextIcon,
  document: DocumentIcon,
};

const TYPE_LABEL_KEY: Record<ArtifactType, string> = {
  html: 'artifactTypeHtml',
  svg: 'artifactTypeSvg',
  image: 'artifactTypeImage',
  mermaid: 'artifactTypeMermaid',
  react: 'artifactTypeReact',
  code: 'artifactTypeHtml',
  markdown: 'artifactTypeMarkdown',
  text: 'artifactTypeText',
  document: 'artifactTypeDocument',
};

interface ArtifactPreviewCardProps {
  artifact: Artifact;
}

function normalizeLocalFilePath(filePath: string): string {
  let normalized = filePath;
  if (normalized.startsWith('file:///')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file://')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file:/')) {
    normalized = normalized.slice(5);
  }
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function showArtifactToast(message: string): void {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
}

const ArtifactPreviewCard: React.FC<ArtifactPreviewCardProps> = ({ artifact }) => {
  const dispatch = useDispatch();

  const handleClick = () => {
    dispatch(selectArtifact(artifact.id));
  };

  const handleOpenFile = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!artifact.filePath) {
      handleClick();
      return;
    }

    try {
      const result = await window.electron?.shell?.openPath(normalizeLocalFilePath(artifact.filePath));
      if (!result?.success) {
        showArtifactToast(result?.error || t('artifactOpenFailed'));
      }
    } catch (error) {
      console.error('Failed to open artifact file:', error);
      showArtifactToast(t('artifactOpenFailed'));
    }
  };

  const handleRevealInFolder = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!artifact.filePath) return;

    try {
      const result = await window.electron?.shell?.showItemInFolder(normalizeLocalFilePath(artifact.filePath));
      if (!result?.success) {
        showArtifactToast(result?.error || t('showInFolderFailed'));
      }
    } catch (error) {
      console.error('Failed to reveal artifact file:', error);
      showArtifactToast(t('showInFolderFailed'));
    }
  };

  const IconComponent = TYPE_ICON_MAP[artifact.type];
  const title = artifact.fileName || artifact.title;
  const subtitle = t(TYPE_LABEL_KEY[artifact.type]);

  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-border bg-surface-raised hover:bg-surface-hover transition-colors max-w-sm w-full text-left">
      <button
        type="button"
        onClick={handleClick}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <IconComponent className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{title}</div>
          <div className="text-xs text-secondary">{subtitle}</div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1 text-primary text-sm font-medium">
          <ArrowTopRightOnSquareIcon className="w-4 h-4" />
          <span>{t('artifactView')}</span>
        </div>
      </button>

      {artifact.filePath && (
        <div className="flex shrink-0 items-center gap-1 border-l border-border/70 pl-2">
          <button
            type="button"
            onClick={handleOpenFile}
            title={t('artifactOpenWithApp')}
            className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface hover:text-primary"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleRevealInFolder}
            title={t('artifactOpenFolder')}
            className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface hover:text-primary"
          >
            <FolderOpenIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ArtifactPreviewCard;
