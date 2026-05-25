import { ArtifactBrowserPartition } from '@shared/artifactPreview/constants';
import type { LocalWebService } from '@shared/localWebServices/constants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '@/services/i18n';
import type { RootState } from '@/store';
import {
  activateArtifactPreviewTab,
  addArtifact,
  ArtifactContentView,
  ArtifactSpecialTab,
  closeArtifactPreviewTab,
  closePanel,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  openArtifactPreviewTab,
  selectActivePreviewTab,
  selectActiveTab,
  selectArtifact,
  selectPanelWidth,
  selectPreviewTabs,
  selectSelectedArtifact,
  setActiveTab,
  setPanelWidth,
  setPreviewTabContentView,
} from '@/store/slices/artifactSlice';
import type { ArtifactType } from '@/types/artifact';
import type { Artifact } from '@/types/artifact';
import { ArtifactTypeValue, PREVIEWABLE_ARTIFACT_TYPES } from '@/types/artifact';

import CopyIcon from '../icons/CopyIcon';
import ArtifactRenderer from './ArtifactRenderer';
import FileDirectoryView from './FileDirectoryView';
import CodeRenderer from './renderers/CodeRenderer';

const t = (key: string) => i18nService.t(key);

const BROWSER_OPENABLE_TYPES = new Set<ArtifactType>(['html', 'svg', 'mermaid', 'react']);

const SYSTEM_OPENABLE_TYPES = new Set<ArtifactType>(['document']);

const NON_CODE_TYPES = new Set<ArtifactType>(['document', 'image', 'text', ArtifactTypeValue.LocalService]);

const COPYABLE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

const PANEL_CLOSE_DRAG_THRESHOLD = 48;

function isCopyableArtifact(artifact: Artifact): boolean {
  if (artifact.type === 'document') return false;
  if (artifact.type === ArtifactTypeValue.LocalService) return false;
  if (artifact.type === 'image') {
    const filename = artifact.fileName || artifact.filePath || '';
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return COPYABLE_IMAGE_EXTENSIONS.has(ext);
  }
  return true;
}

function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Failed to get canvas context')); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert image to blob'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

function buildBrowserHtml(artifact: Artifact): string | null {
  switch (artifact.type) {
    case 'html':
      return artifact.content;
    case 'svg':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${artifact.title}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5}</style></head><body>${artifact.content}</body></html>`;
    case 'mermaid':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${artifact.title}</title><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:system-ui,sans-serif}</style></head><body><pre class="mermaid">${escapeHtml(artifact.content)}</pre><script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'});<\/script></body></html>`;
    default:
      return null;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const showArtifactToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

interface ArtifactPanelProps {
  sessionId?: string;
  artifacts: Artifact[];
  activeSpecialTab?: ArtifactSpecialTab;
  minPanelWidth?: number;
  maxPanelWidth?: number;
  browserAddress?: string;
  browserUrl?: string;
  onBrowserAddressChange?: (value: string) => void;
  onBrowserUrlChange?: (value: string) => void;
  onOpenFileListTab?: () => void;
  onOpenBrowserTab?: () => void;
  onBrowserAnnotationCaptured?: (payload: BrowserAnnotationPayload) => void;
}

export const BrowserAnnotationShape = {
  Rectangle: 'rectangle',
} as const;

export type BrowserAnnotationShape = typeof BrowserAnnotationShape[keyof typeof BrowserAnnotationShape];

export const BrowserAnnotationColor = {
  Blue: 'blue',
} as const;

export type BrowserAnnotationColor = typeof BrowserAnnotationColor[keyof typeof BrowserAnnotationColor];

export interface BrowserAnnotationElementInfo {
  tagName: string;
  text: string;
  color: string;
  fontFamily: string;
  width: number;
  height: number;
}

export interface BrowserAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserAnnotationScreenshotInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface BrowserAnnotationMarkInfo extends BrowserAnnotationRect {
  shape: BrowserAnnotationShape;
  color: BrowserAnnotationColor;
}

export interface BrowserAnnotationPayload {
  comment: string;
  imageDataUrl: string;
  pageUrl: string;
  pageTitle: string;
  screenshot: BrowserAnnotationScreenshotInfo;
  annotation: BrowserAnnotationMarkInfo;
  element: BrowserAnnotationElementInfo;
}

const ArtifactPanel: React.FC<ArtifactPanelProps> = ({
  sessionId,
  artifacts,
  activeSpecialTab = ArtifactSpecialTab.FileList,
  minPanelWidth = MIN_PANEL_WIDTH,
  maxPanelWidth = MAX_PANEL_WIDTH,
  browserAddress: controlledBrowserAddress,
  browserUrl: controlledBrowserUrl,
  onBrowserAddressChange,
  onBrowserUrlChange,
  onOpenFileListTab,
  onOpenBrowserTab,
  onBrowserAnnotationCaptured,
}) => {
  const dispatch = useDispatch();
  const effectiveSessionId = useMemo(() => (
    sessionId
    ?? artifacts.find((artifact) => artifact.sessionId)?.sessionId
    ?? artifacts.find((artifact) => artifact.conversationId)?.conversationId
    ?? null
  ), [artifacts, sessionId]);
  const activePreviewTab = useSelector((state: RootState) => (
    effectiveSessionId ? selectActivePreviewTab(state, effectiveSessionId) : null
  ));
  const previewTabs = useSelector((state: RootState) => (
    effectiveSessionId ? selectPreviewTabs(state, effectiveSessionId) : []
  ));
  const selectedArtifactFallback = useSelector(selectSelectedArtifact);
  const panelWidth = useSelector(selectPanelWidth);
  const legacyActiveTab = useSelector(selectActiveTab);
  const [showFileList, setShowFileList] = useState(false);
  const [localBrowserAddress, setLocalBrowserAddress] = useState('');
  const [localBrowserUrl, setLocalBrowserUrl] = useState('');
  const fileListRef = useRef<HTMLDivElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);

  const previewableArtifacts = artifacts.filter(a => PREVIEWABLE_ARTIFACT_TYPES.has(a.type));
  const artifactsById = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts]);
  const selectedArtifact = activePreviewTab
    ? artifactsById.get(activePreviewTab.artifactId) ?? selectedArtifactFallback
    : selectedArtifactFallback;
  const selectedArtifactId = selectedArtifact?.id ?? null;
  const activeTab = activePreviewTab?.contentView ?? legacyActiveTab;

  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const previousBodyCursor = useRef('');
  const [panelIsResizing, setPanelIsResizing] = useState(false);
  const constrainedMaxPanelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, maxPanelWidth));
  const constrainedMinPanelWidth = Math.min(
    constrainedMaxPanelWidth,
    Math.max(MIN_PANEL_WIDTH, minPanelWidth),
  );
  const constrainedPanelWidth = Math.max(constrainedMinPanelWidth, Math.min(constrainedMaxPanelWidth, panelWidth));
  const browserAddress = controlledBrowserAddress ?? localBrowserAddress;
  const browserUrl = controlledBrowserUrl ?? localBrowserUrl;

  const handleBrowserAddressChange = useCallback((value: string) => {
    setLocalBrowserAddress(value);
    onBrowserAddressChange?.(value);
  }, [onBrowserAddressChange]);

  const handleBrowserUrlChange = useCallback((value: string) => {
    setLocalBrowserUrl(value);
    onBrowserUrlChange?.(value);
  }, [onBrowserUrlChange]);

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = constrainedPanelWidth;
    previousBodyCursor.current = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    document.body.classList.add('select-none');
    setPanelIsResizing(true);

    const stopResizing = () => {
      isResizing.current = false;
      document.body.style.cursor = previousBodyCursor.current;
      document.body.classList.remove('select-none');
      setPanelIsResizing(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isResizing.current) return;
      moveEvent.preventDefault();
      const nextWidth = startWidth.current + startX.current - moveEvent.clientX;
      if (nextWidth < constrainedMinPanelWidth - PANEL_CLOSE_DRAG_THRESHOLD) {
        stopResizing();
        dispatch(closePanel());
        return;
      }
      const clampedWidth = Math.max(
        constrainedMinPanelWidth,
        Math.min(constrainedMaxPanelWidth, nextWidth),
      );
      dispatch(setPanelWidth(clampedWidth));
    };

    const handlePointerUp = () => {
      stopResizing();
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
  }, [constrainedMaxPanelWidth, constrainedMinPanelWidth, constrainedPanelWidth, dispatch]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = previousBodyCursor.current;
      document.body.classList.remove('select-none');
    };
  }, []);

  useEffect(() => {
    if (!showFileList) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        fileListRef.current && !fileListRef.current.contains(e.target as Node) &&
        toggleBtnRef.current && !toggleBtnRef.current.contains(e.target as Node)
      ) {
        setShowFileList(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFileList]);

  // Auto-refresh when the previewed file changes on disk
  useEffect(() => {
    const filePath = selectedArtifact?.filePath;
    if (!filePath) return;

    let cleanup: (() => void) | undefined;
    let watchedPath: string | null = null;

    window.electron?.artifact?.watchFile(filePath);
    watchedPath = filePath;

    cleanup = window.electron?.artifact?.onFileChanged(({ filePath: changedPath }) => {
      if (changedPath === watchedPath) {
        handleRefreshRef.current();
      }
    });

    return () => {
      if (cleanup) cleanup();
      if (watchedPath) window.electron?.artifact?.unwatchFile(watchedPath);
    };
  }, [selectedArtifact?.filePath]);

  const handleClose = useCallback(() => dispatch(closePanel()), [dispatch]);
  const handleSelectArtifact = useCallback((id: string) => {
    const artifact = artifacts.find((item) => item.id === id);
    if (artifact?.type === ArtifactTypeValue.LocalService) {
      const url = artifact.url || artifact.content;
      if (url) {
        handleBrowserAddressChange(url);
        handleBrowserUrlChange(url);
        onOpenBrowserTab?.();
      }
      setShowFileList(false);
      return;
    }
    if (effectiveSessionId) {
      dispatch(openArtifactPreviewTab({ sessionId: effectiveSessionId, artifactId: id }));
      setShowFileList(false);
      onOpenFileListTab?.();
      return;
    }
    dispatch(selectArtifact(id));
    setShowFileList(false);
    onOpenFileListTab?.();
  }, [
    artifacts,
    dispatch,
    effectiveSessionId,
    handleBrowserAddressChange,
    handleBrowserUrlChange,
    onOpenBrowserTab,
    onOpenFileListTab,
  ]);

  const handleActivatePreviewTab = useCallback((tabId: string) => {
    if (!effectiveSessionId) return;
    dispatch(activateArtifactPreviewTab({ sessionId: effectiveSessionId, tabId }));
  }, [dispatch, effectiveSessionId]);

  const handleClosePreviewTab = useCallback((event: React.MouseEvent, tabId: string) => {
    event.stopPropagation();
    if (!effectiveSessionId) return;
    dispatch(closeArtifactPreviewTab({ sessionId: effectiveSessionId, tabId }));
  }, [dispatch, effectiveSessionId]);

  const handleSetContentView = useCallback((contentView: ArtifactContentView) => {
    if (effectiveSessionId && activePreviewTab) {
      dispatch(setPreviewTabContentView({
        sessionId: effectiveSessionId,
        tabId: activePreviewTab.id,
        contentView,
      }));
      return;
    }
    dispatch(setActiveTab(contentView));
  }, [activePreviewTab, dispatch, effectiveSessionId]);

  const handleCopy = useCallback(async () => {
    if (!selectedArtifact) return;
    if (selectedArtifact.type === 'image') {
      if (selectedArtifact.filePath) {
        const result = await window.electron?.clipboard?.writeImageFromFile(selectedArtifact.filePath);
        if (!result?.success) {
          window.dispatchEvent(new CustomEvent('app:showToast', { detail: result?.error || t('copyFailed') }));
          return;
        }
      } else if (selectedArtifact.content) {
        const blob = await dataUrlToPngBlob(selectedArtifact.content);
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      }
    } else {
      await navigator.clipboard.writeText(selectedArtifact.content);
    }
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: t('messageCopied') }));
  }, [selectedArtifact]);

  const handleRevealInFolder = useCallback(() => {
    if (!selectedArtifact?.filePath) return;
    void window.electron?.shell?.showItemInFolder(selectedArtifact.filePath).then((result) => {
      if (!result?.success) {
        showArtifactToast(result?.error || t('showInFolderFailed'));
      }
    }).catch(() => {
      showArtifactToast(t('showInFolderFailed'));
    });
  }, [selectedArtifact]);

  const handleOpenInBrowser = useCallback(() => {
    if (!selectedArtifact) return;

    // Mermaid needs HTML wrapper with mermaid.js to render in browser
    if (selectedArtifact.type === 'mermaid') {
      if (!selectedArtifact.content) return;
      const html = buildBrowserHtml(selectedArtifact);
      if (html) {
        window.electron?.shell?.openHtmlInBrowser(html);
      }
      return;
    }

    // Has file on disk: open directly via native path
    // NOTE: shell.openExternal with file:// URLs fails on Windows when path contains
    // non-ASCII characters (e.g. Chinese) — ERROR_FILE_NOT_FOUND (0x2).
    // Use shell.openPath which handles native Unicode paths correctly.
    if (selectedArtifact.filePath) {
      void window.electron?.shell?.openPath(selectedArtifact.filePath).then((result) => {
        if (!result?.success) {
          showArtifactToast(result?.error || t('artifactOpenFailed'));
        }
      }).catch(() => {
        showArtifactToast(t('artifactOpenFailed'));
      });
      return;
    }

    // No file path: generate HTML and open via temp file
    if (!selectedArtifact.content) return;
    const html = buildBrowserHtml(selectedArtifact);
    if (html) {
      window.electron?.shell?.openHtmlInBrowser(html);
    }
  }, [selectedArtifact]);

  const handleOpenWithApp = useCallback(() => {
    if (selectedArtifact?.filePath) {
      void window.electron?.shell?.openPath(selectedArtifact.filePath).then((result) => {
        if (!result?.success) {
          showArtifactToast(result?.error || t('artifactOpenFailed'));
        }
      }).catch(() => {
        showArtifactToast(t('artifactOpenFailed'));
      });
    }
  }, [selectedArtifact]);

  const handleRefresh = useCallback(async () => {
    if (!selectedArtifact?.filePath) return;
    try {
      const result = await window.electron.dialog.readFileAsDataUrl(selectedArtifact.filePath);
      if (result?.success && result.dataUrl) {
        const isTextType = selectedArtifact.type !== 'image' && selectedArtifact.type !== 'document';
        let content = result.dataUrl;
        if (isTextType) {
          try {
            const base64 = result.dataUrl.split(',')[1] || '';
            const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            content = new TextDecoder('utf-8').decode(bytes);
          } catch {
            content = result.dataUrl;
          }
        }
        dispatch(addArtifact({
          sessionId: selectedArtifact.sessionId || selectedArtifact.conversationId || 'default',
          artifact: { ...selectedArtifact, content },
        }));
      }
    } catch {
      // File unreadable or missing
    }
  }, [selectedArtifact, dispatch]);

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;

  return (
    <>
      {/* Drag handle */}
      <div
        className="w-1 shrink-0 touch-none cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        onPointerDown={handleResizeStart}
      />
      <aside
        style={{ width: constrainedPanelWidth, maxWidth: constrainedMaxPanelWidth }}
        className="shrink border-l border-border bg-background flex flex-col h-full overflow-hidden relative"
      >
        {panelIsResizing && (
          <div className="absolute inset-0 z-30 cursor-col-resize bg-transparent" />
        )}

        {/* Floating file list overlay */}
        {showFileList && (
          <div
            ref={fileListRef}
            className="absolute top-10 right-2 z-20 w-[240px] max-h-[60%] bg-background border border-border rounded-lg shadow-lg flex flex-col overflow-hidden"
          >
            <div className="h-9 flex items-center px-3 border-b border-border shrink-0">
              <span className="text-xs font-medium text-secondary">{t('artifactFileList')}</span>
            </div>
            <FileDirectoryView
              artifacts={previewableArtifacts}
              selectedId={selectedArtifactId}
              onSelect={handleSelectArtifact}
              compact
            />
          </div>
        )}

        {selectedArtifact ? (
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            {previewTabs.length > 0 && (
              <div className="flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-border bg-surface/60 px-2 pt-1">
                {previewTabs.map((tab) => {
                  const artifact = artifactsById.get(tab.artifactId);
                  const title = artifact?.fileName || artifact?.title || tab.artifactId;
                  const active = activePreviewTab?.id === tab.id;
                  return (
                    <div
                      key={tab.id}
                      className={`group flex h-8 min-w-0 max-w-[180px] items-center gap-1 rounded-t-lg border text-xs transition-colors ${
                        active
                          ? 'border-border border-b-background bg-background text-foreground'
                          : 'border-transparent text-secondary hover:bg-surface-raised hover:text-foreground'
                      }`}
                      title={title}
                    >
                      <button
                        type="button"
                        onClick={() => handleActivatePreviewTab(tab.id)}
                        className="min-w-0 flex-1 truncate px-2 py-1 text-left"
                      >
                        {title}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => handleClosePreviewTab(event, tab.id)}
                        className={`mr-1 rounded px-1 text-sm leading-none transition-colors ${
                          active
                            ? 'text-secondary hover:bg-surface-raised hover:text-foreground'
                            : 'text-secondary/70 hover:bg-surface hover:text-foreground'
                        }`}
                        aria-label={t('close')}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Header: file list toggle + filename + type + actions */}
            <div className="h-10 flex items-center gap-2 px-3 border-b border-border shrink-0">
              <span className="text-sm font-medium truncate">{selectedArtifact.fileName || selectedArtifact.title}</span>
              <span className="flex-1" />
              {selectedArtifact.filePath && (
                <button
                  onClick={handleRefresh}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactRefresh')}
                >
                  <RefreshIcon />
                </button>
              )}
              {isCopyableArtifact(selectedArtifact) && (
                <button
                  onClick={handleCopy}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactCopyCode')}
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {BROWSER_OPENABLE_TYPES.has(selectedArtifact.type) && (
                <button
                  onClick={handleOpenInBrowser}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactOpenInBrowser')}
                >
                  <BrowserIcon />
                </button>
              )}
              {SYSTEM_OPENABLE_TYPES.has(selectedArtifact.type) && selectedArtifact.filePath && (
                <button
                  onClick={handleOpenWithApp}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactOpenWithApp')}
                >
                  <OpenExternalIcon />
                </button>
              )}
              {selectedArtifact.filePath && (
                <button
                  onClick={handleRevealInFolder}
                  className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
                  title={t('artifactOpenFolder')}
                >
                  <FolderIcon />
                </button>
              )}
              <button
                ref={toggleBtnRef}
                onClick={() => setShowFileList(v => !v)}
                className={`p-1 rounded transition-colors ${
                  showFileList
                    ? 'text-primary bg-primary/10'
                    : 'text-secondary hover:text-foreground hover:bg-surface'
                }`}
                title={t('artifactFileList')}
              >
                <FileListIcon />
              </button>
            </div>

            {/* Preview/Code tabs */}
            <div className="flex border-b border-border shrink-0">
              <button
                onClick={() => handleSetContentView(ArtifactContentView.Preview)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === ArtifactContentView.Preview
                    ? 'border-primary text-primary'
                    : 'border-transparent text-secondary hover:text-foreground'
                }`}
              >
                {t('artifactPreview')}
              </button>
              {!NON_CODE_TYPES.has(selectedArtifact.type) && (
                <button
                  onClick={() => handleSetContentView(ArtifactContentView.Code)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 ${
                    activeTab === ArtifactContentView.Code
                      ? 'border-primary text-primary'
                      : 'border-transparent text-secondary hover:text-foreground'
                  }`}
                >
                  {t('artifactCode')}
                </button>
              )}
            </div>

            {/* Render area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeTab === ArtifactContentView.Preview ? (
                <ArtifactRenderer artifact={selectedArtifact} sessionArtifacts={artifacts} />
              ) : (
                <CodeRenderer artifact={selectedArtifact} />
              )}
            </div>
          </div>
        ) : activeSpecialTab === ArtifactSpecialTab.Browser ? (
          <BrowserTabContent
            address={browserAddress}
            currentUrl={browserUrl}
            artifacts={previewableArtifacts}
            onAddressChange={handleBrowserAddressChange}
            onCurrentUrlChange={handleBrowserUrlChange}
            onAnnotationCaptured={onBrowserAnnotationCaptured}
          />
        ) : (
          /* No artifact selected: show full-width file list */
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="h-10 flex items-center px-3 border-b border-border shrink-0">
              <span className="text-xs font-medium text-secondary">{t('artifactFiles')}</span>
              <span className="flex-1" />
              <button
                onClick={handleClose}
                className="p-1 rounded text-secondary hover:text-foreground hover:bg-surface transition-colors"
              >
                <CloseIcon />
              </button>
            </div>
            <FileDirectoryView
              artifacts={previewableArtifacts}
              selectedId={selectedArtifactId}
              onSelect={handleSelectArtifact}
            />
          </div>
        )}
      </aside>
    </>
  );
};

interface BrowserTabContentProps {
  address: string;
  currentUrl: string;
  artifacts: Artifact[];
  onAddressChange: (value: string) => void;
  onCurrentUrlChange: (value: string) => void;
  onAnnotationCaptured?: (payload: BrowserAnnotationPayload) => void;
}

type BrowserWebviewElement = HTMLElement & {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  capturePage?: () => Promise<{ toDataURL: () => string; getSize?: () => { width: number; height: number } }>;
  loadURL?: (url: string) => Promise<void>;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  stop?: () => void;
  getURL?: () => string;
};

function normalizeBrowserUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(https?|file):\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

const BrowserTabContent: React.FC<BrowserTabContentProps> = ({
  address,
  currentUrl,
  artifacts,
  onAddressChange,
  onCurrentUrlChange,
  onAnnotationCaptured: _onAnnotationCaptured,
}) => {
  const [webviewNode, setWebviewNode] = useState<BrowserWebviewElement | null>(null);
  const [isWebviewReady, setIsWebviewReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [discoveredServices, setDiscoveredServices] = useState<LocalWebService[]>([]);
  const [isLoadingLocalServices, setIsLoadingLocalServices] = useState(false);
  const webviewNodeRef = useRef<BrowserWebviewElement | null>(null);
  const lastRequestedUrlRef = useRef('');
  const localServices = useMemo(
    () => artifacts.filter((artifact) => artifact.type === ArtifactTypeValue.LocalService),
    [artifacts],
  );
  const serviceCards = useMemo(() => {
    const seen = new Set<string>();
    const cards: Array<{ id: string; title: string; url: string; subtitle: string; online: boolean }> = [];
    for (const artifact of localServices) {
      const url = artifact.url || artifact.content;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      cards.push({
        id: artifact.id,
        title: artifact.title,
        url,
        subtitle: url,
        online: false,
      });
    }
    for (const service of discoveredServices) {
      if (seen.has(service.url)) continue;
      seen.add(service.url);
      cards.push({
        id: service.id,
        title: service.title,
        url: service.url,
        subtitle: `${service.host}:${service.port}`,
        online: service.online,
      });
    }
    return cards.slice(0, 10);
  }, [discoveredServices, localServices]);

  const handleWebviewRef = useCallback((node: BrowserWebviewElement | null) => {
    if (webviewNodeRef.current === node) return;
    webviewNodeRef.current = node;
    lastRequestedUrlRef.current = '';
    setIsWebviewReady(false);
    setWebviewNode(node);
  }, []);

  const syncNavigationState = useCallback((node: BrowserWebviewElement | null) => {
    if (!node) return;
    setCanGoBack(node.canGoBack?.() ?? false);
    setCanGoForward(node.canGoForward?.() ?? false);
    const nextUrl = node.getURL?.();
    if (nextUrl && nextUrl !== 'about:blank') {
      onCurrentUrlChange(nextUrl);
      onAddressChange(nextUrl);
    }
  }, [onAddressChange, onCurrentUrlChange]);

  const loadLocalServices = useCallback(async () => {
    setIsLoadingLocalServices(true);
    try {
      const preferredPorts = localServices
        .map((artifact) => {
          const rawUrl = artifact.url || artifact.content;
          try {
            const parsed = new URL(rawUrl);
            const port = Number(parsed.port);
            return Number.isInteger(port) ? port : null;
          } catch {
            return null;
          }
        })
        .filter((port): port is number => typeof port === 'number');
      const services = await window.electron?.artifact?.listLocalWebServices?.({ preferredPorts });
      setDiscoveredServices(services ?? []);
    } catch {
      setDiscoveredServices([]);
    } finally {
      setIsLoadingLocalServices(false);
    }
  }, [localServices]);

  useEffect(() => {
    if (currentUrl) return;
    void loadLocalServices();
  }, [currentUrl, loadLocalServices]);

  useEffect(() => {
    if (!webviewNode) return;
    const handleStartLoading = () => setIsLoading(true);
    const handleStopLoading = () => {
      setIsLoading(false);
      syncNavigationState(webviewNode);
    };
    const handleNavigate = (event: Event) => {
      const nextUrl = (event as Event & { url?: string }).url;
      if (nextUrl && nextUrl !== 'about:blank') {
        onCurrentUrlChange(nextUrl);
        onAddressChange(nextUrl);
      }
      syncNavigationState(webviewNode);
    };
    const handleFailLoad = (event: Event) => {
      const detail = event as Event & { errorCode?: number };
      setIsLoading(false);
      if (detail.errorCode === -3) return;
      syncNavigationState(webviewNode);
    };
    const handleDomReady = () => {
      setIsWebviewReady(true);
      handleStopLoading();
    };

    webviewNode.addEventListener('did-start-loading', handleStartLoading);
    webviewNode.addEventListener('did-stop-loading', handleStopLoading);
    webviewNode.addEventListener('did-fail-load', handleFailLoad);
    webviewNode.addEventListener('did-navigate', handleNavigate);
    webviewNode.addEventListener('did-navigate-in-page', handleNavigate);
    webviewNode.addEventListener('dom-ready', handleDomReady);
    return () => {
      webviewNode.removeEventListener('did-start-loading', handleStartLoading);
      webviewNode.removeEventListener('did-stop-loading', handleStopLoading);
      webviewNode.removeEventListener('did-fail-load', handleFailLoad);
      webviewNode.removeEventListener('did-navigate', handleNavigate);
      webviewNode.removeEventListener('did-navigate-in-page', handleNavigate);
      webviewNode.removeEventListener('dom-ready', handleDomReady);
    };
  }, [onAddressChange, onCurrentUrlChange, syncNavigationState, webviewNode]);

  useEffect(() => {
    if (!currentUrl || !isWebviewReady || !webviewNode?.loadURL) return;
    if (webviewNode.getURL?.() === currentUrl || lastRequestedUrlRef.current === currentUrl) return;
    lastRequestedUrlRef.current = currentUrl;
    setIsLoading(true);
    try {
      void webviewNode.loadURL(currentUrl).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('ERR_ABORTED') || message.includes('(-3)')) return;
        lastRequestedUrlRef.current = '';
        setIsLoading(false);
      });
    } catch {
      lastRequestedUrlRef.current = '';
      setIsLoading(false);
    }
  }, [currentUrl, isWebviewReady, webviewNode]);

  const handleNavigate = useCallback(() => {
    const nextUrl = normalizeBrowserUrl(address);
    if (!nextUrl) return;
    onAddressChange(nextUrl);
    onCurrentUrlChange(nextUrl);
  }, [address, onAddressChange, onCurrentUrlChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleNavigate();
    }
  }, [handleNavigate]);

  const handleOpenExternal = useCallback(() => {
    if (!currentUrl) return;
    void window.electron?.shell?.openExternal(currentUrl);
  }, [currentUrl]);

  const handleSelectLocalService = useCallback((service: { url: string }) => {
    const url = service.url;
    if (!url) return;
    onAddressChange(url);
    onCurrentUrlChange(url);
  }, [onAddressChange, onCurrentUrlChange]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <button
          type="button"
          onClick={() => webviewNode?.goBack?.()}
          disabled={!canGoBack}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={t('artifactBrowserBack')}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => webviewNode?.goForward?.()}
          disabled={!canGoForward}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={t('artifactBrowserForward')}
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => (isLoading ? webviewNode?.stop?.() : webviewNode?.reload?.())}
          disabled={!currentUrl}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={isLoading ? t('artifactBrowserStop') : t('artifactBrowserReload')}
        >
          {isLoading ? '×' : <RefreshIcon />}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2 focus-within:border-primary">
          <BrowserIcon />
          <input
            type="text"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('artifactBrowserUrlPlaceholder')}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
          />
        </div>
        <button
          type="button"
          onClick={handleNavigate}
          className="h-7 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('artifactOpen')}
        </button>
        <button
          type="button"
          onClick={handleOpenExternal}
          disabled={!currentUrl}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
          title={t('artifactBrowserOpenExternal')}
        >
          <OpenExternalIcon />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {currentUrl ? (
          <div className="h-full w-full bg-white">
            {React.createElement('webview', {
              ref: handleWebviewRef,
              src: 'about:blank',
              partition: ArtifactBrowserPartition.Default,
              className: 'h-full w-full bg-white',
              allowpopups: 'false',
            })}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-10">
            <div className="w-full max-w-[420px]">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="text-xs text-muted">{t('artifactBrowserLocalServices')}</div>
              <button
                type="button"
                onClick={loadLocalServices}
                disabled={isLoadingLocalServices}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                title={t('artifactBrowserLocalServicesRefresh')}
              >
                <RefreshIcon />
              </button>
            </div>
            {serviceCards.length > 0 ? (
              <div className="space-y-2">
                {serviceCards.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => handleSelectLocalService(service)}
                    className="group flex w-full items-center gap-3 rounded-lg border border-border bg-background p-2 text-left transition-colors hover:border-primary/35 hover:bg-surface"
                  >
                    <div className="flex h-[52px] w-[84px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-sm">
                      <div className="flex h-3 items-center gap-1 border-b border-border px-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-400/70" />
                        <span className="h-1.5 w-1.5 rounded-full bg-yellow-400/70" />
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400/70" />
                      </div>
                      <div className="flex flex-1 items-center px-2 text-[8px] leading-tight text-muted">
                        <span className="line-clamp-2">{service.title}</span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{service.title}</div>
                      <div className="truncate text-xs text-muted">{service.subtitle}</div>
                    </div>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${service.online ? 'bg-emerald-400' : 'bg-muted'}`} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                {isLoadingLocalServices ? t('artifactBrowserLocalServicesLoading') : t('artifactBrowserEmpty')}
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4.5A1.5 1.5 0 013.5 3h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H12.5A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" />
  </svg>
);

const BrowserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
    <path d="M2 8h12" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v3.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 012 12.5v-7A1.5 1.5 0 013.5 4H7" />
    <path d="M10 2h4v4" />
    <path d="M7 9l7-7" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const FileListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 2.881c0-.644.522-1.167 1.167-1.167h2.552c.323 0 .635.117.878.33l.58.507c.243.213.555.33.877.33h3.351c.736 0 1.333.597 1.333 1.333v5.945c0 .49-.398.889-.889.889" />
    <path d="M1.143 6.476c0-.736.597-1.333 1.333-1.333h2.314c.323 0 .635.117.878.33l.58.507c.242.213.554.33.877.33h3.351c.736 0 1.333.597 1.333 1.334v4.833c0 .736-.597 1.333-1.333 1.333H2.476c-.736 0-1.333-.597-1.333-1.333V6.476z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 8a5.5 5.5 0 01-9.55 3.75" />
    <path d="M2.5 8a5.5 5.5 0 019.55-3.75" />
    <path d="M12.05 1.25v3h-3" />
    <path d="M3.95 14.75v-3h3" />
  </svg>
);

export default ArtifactPanel;
