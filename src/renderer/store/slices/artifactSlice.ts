import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeFilePathForDedup, normalizeLocalServiceUrlForDedup } from '../../services/artifactParser';
import { type Artifact, ArtifactTypeValue } from '../../types/artifact';
import type { RootState } from '../index';

const DEFAULT_PANEL_WIDTH = 560;
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 1000;

export type ArtifactPanelView = 'files' | 'preview';
export const ArtifactContentView = {
  Preview: 'preview',
  Code: 'code',
} as const;
export type ArtifactContentView = typeof ArtifactContentView[keyof typeof ArtifactContentView];

export const ArtifactSpecialTab = {
  FileList: 'fileList',
  Browser: 'browser',
} as const;
export type ArtifactSpecialTab = typeof ArtifactSpecialTab[keyof typeof ArtifactSpecialTab];

export type ArtifactActiveTab = ArtifactContentView;

export interface ArtifactPreviewTab {
  id: string;
  artifactId: string;
  contentView: ArtifactContentView;
  openedAt: number;
}

interface ArtifactState {
  artifactsBySession: Record<string, Artifact[]>;
  previewTabsBySession: Record<string, ArtifactPreviewTab[]>;
  activePreviewTabIdBySession: Record<string, string | null>;
  panelOpenBySession: Record<string, boolean>;
  selectedArtifactId: string | null;
  isPanelOpen: boolean;
  activeTab: ArtifactActiveTab;
  panelView: ArtifactPanelView;
  panelWidth: number;
}

const initialState: ArtifactState = {
  artifactsBySession: {},
  previewTabsBySession: {},
  activePreviewTabIdBySession: {},
  panelOpenBySession: {},
  selectedArtifactId: null,
  isPanelOpen: false,
  activeTab: ArtifactContentView.Preview,
  panelView: 'files',
  panelWidth: DEFAULT_PANEL_WIDTH,
};

const getPreviewTabId = (artifactId: string): string => `artifact:${artifactId}`;

const findArtifactSessionId = (state: ArtifactState, artifactId: string): string | null => {
  for (const [sessionId, artifacts] of Object.entries(state.artifactsBySession)) {
    if (artifacts.some((artifact) => artifact.id === artifactId)) {
      return sessionId;
    }
  }
  return null;
};

const activatePreviewTab = (state: ArtifactState, sessionId: string, tabId: string | null): void => {
  state.activePreviewTabIdBySession[sessionId] = tabId;
  if (!tabId) {
    state.selectedArtifactId = null;
    state.activeTab = ArtifactContentView.Preview;
    return;
  }

  const tab = state.previewTabsBySession[sessionId]?.find((item) => item.id === tabId);
  state.selectedArtifactId = tab?.artifactId ?? null;
  state.activeTab = tab?.contentView ?? ArtifactContentView.Preview;
  state.panelView = 'preview';
  state.isPanelOpen = true;
  state.panelOpenBySession[sessionId] = true;
};

const setPanelOpen = (state: ArtifactState, sessionId: string | undefined, isOpen: boolean): void => {
  state.isPanelOpen = isOpen;
  if (sessionId) {
    state.panelOpenBySession[sessionId] = isOpen;
  }
};

const openPreviewTab = (state: ArtifactState, sessionId: string, artifactId: string): void => {
  if (!state.previewTabsBySession[sessionId]) {
    state.previewTabsBySession[sessionId] = [];
  }

  const tabId = getPreviewTabId(artifactId);
  const existing = state.previewTabsBySession[sessionId].find((tab) => tab.id === tabId);
  if (!existing) {
    state.previewTabsBySession[sessionId].push({
      id: tabId,
      artifactId,
      contentView: ArtifactContentView.Preview,
      openedAt: Date.now(),
    });
  }

  activatePreviewTab(state, sessionId, tabId);
};

const replacePreviewTabArtifactId = (
  state: ArtifactState,
  sessionId: string,
  oldArtifactId: string,
  nextArtifactId: string,
): void => {
  if (oldArtifactId === nextArtifactId) return;

  const oldTabId = getPreviewTabId(oldArtifactId);
  const nextTabId = getPreviewTabId(nextArtifactId);
  for (const tab of state.previewTabsBySession[sessionId] ?? []) {
    if (tab.artifactId === oldArtifactId) {
      tab.id = nextTabId;
      tab.artifactId = nextArtifactId;
    }
  }
  if (state.activePreviewTabIdBySession[sessionId] === oldTabId) {
    state.activePreviewTabIdBySession[sessionId] = nextTabId;
  }
  if (state.selectedArtifactId === oldArtifactId) {
    state.selectedArtifactId = nextArtifactId;
  }
};

const artifactSlice = createSlice({
  name: 'artifact',
  initialState,
  reducers: {
    setSessionArtifacts(state, action: PayloadAction<{ sessionId: string; artifacts: Artifact[] }>) {
      const { sessionId, artifacts } = action.payload;
      state.artifactsBySession[sessionId] = artifacts;

      const knownIds = new Set(artifacts.map((artifact) => artifact.id));
      const tabs = state.previewTabsBySession[sessionId] ?? [];
      state.previewTabsBySession[sessionId] = tabs.filter((tab) => knownIds.has(tab.artifactId));
      const activeTabId = state.activePreviewTabIdBySession[sessionId];
      if (activeTabId && !state.previewTabsBySession[sessionId].some((tab) => tab.id === activeTabId)) {
        activatePreviewTab(
          state,
          sessionId,
          state.previewTabsBySession[sessionId][0]?.id ?? null,
        );
      }
    },
    addArtifact(state, action: PayloadAction<{ sessionId: string; artifact: Artifact }>) {
      const { sessionId, artifact } = action.payload;
      if (!state.artifactsBySession[sessionId]) {
        state.artifactsBySession[sessionId] = [];
      }

      const artifacts = state.artifactsBySession[sessionId];
      const existing = artifacts.findIndex((item) => item.id === artifact.id);
      if (existing >= 0) {
        const old = artifacts[existing];
        if (artifact.content || !old.content) {
          artifacts[existing] = artifact;
        }
        return;
      }

      if (artifact.filePath) {
        const normalizedPath = normalizeFilePathForDedup(artifact.filePath);
        const duplicate = artifacts.findIndex((item) => (
          Boolean(item.filePath) && normalizeFilePathForDedup(item.filePath!) === normalizedPath
        ));
        if (duplicate >= 0) {
          const old = artifacts[duplicate];
          if (artifact.content || !old.content) {
            artifacts[duplicate] = artifact;
            replacePreviewTabArtifactId(state, sessionId, old.id, artifact.id);
          }
          return;
        }
      }

      if (artifact.type === ArtifactTypeValue.LocalService) {
        const normalizedUrl = normalizeLocalServiceUrlForDedup(artifact.url || artifact.content);
        const duplicate = artifacts.findIndex((item) => (
          item.type === ArtifactTypeValue.LocalService
          && normalizeLocalServiceUrlForDedup(item.url || item.content) === normalizedUrl
        ));
        if (duplicate >= 0) {
          const old = artifacts[duplicate];
          artifacts[duplicate] = artifact;
          replacePreviewTabArtifactId(state, sessionId, old.id, artifact.id);
          return;
        }
      }

      artifacts.push(artifact);
    },
    selectArtifact(state, action: PayloadAction<string | null>) {
      const artifactId = action.payload;
      if (!artifactId) {
        state.selectedArtifactId = null;
        state.activeTab = ArtifactContentView.Preview;
        for (const sessionId of Object.keys(state.activePreviewTabIdBySession)) {
          state.activePreviewTabIdBySession[sessionId] = null;
        }
        return;
      }
      const sessionId = findArtifactSessionId(state, artifactId);
      if (!sessionId) {
        state.selectedArtifactId = artifactId;
        state.panelView = 'preview';
        state.isPanelOpen = true;
        state.activeTab = ArtifactContentView.Preview;
        return;
      }
      openPreviewTab(state, sessionId, artifactId);
    },
    openArtifactPreviewTab(state, action: PayloadAction<{ sessionId: string; artifactId: string }>) {
      openPreviewTab(state, action.payload.sessionId, action.payload.artifactId);
    },
    activateArtifactPreviewTab(state, action: PayloadAction<{ sessionId: string; tabId: string }>) {
      activatePreviewTab(state, action.payload.sessionId, action.payload.tabId);
    },
    activateArtifactFileListTab(state, action: PayloadAction<{ sessionId: string }>) {
      activatePreviewTab(state, action.payload.sessionId, null);
      state.panelView = 'files';
      setPanelOpen(state, action.payload.sessionId, true);
    },
    activateArtifactBrowserTab(state, action: PayloadAction<{ sessionId: string }>) {
      activatePreviewTab(state, action.payload.sessionId, null);
      state.panelView = 'preview';
      setPanelOpen(state, action.payload.sessionId, true);
    },
    closeArtifactPreviewTab(state, action: PayloadAction<{ sessionId: string; tabId: string }>) {
      const { sessionId, tabId } = action.payload;
      const tabs = state.previewTabsBySession[sessionId] ?? [];
      const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
      if (closingIndex < 0) return;

      state.previewTabsBySession[sessionId] = tabs.filter((tab) => tab.id !== tabId);
      if (state.activePreviewTabIdBySession[sessionId] !== tabId) return;

      const remainingTabs = state.previewTabsBySession[sessionId];
      const nextTab = remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)] ?? null;
      activatePreviewTab(state, sessionId, nextTab?.id ?? null);
    },
    setPreviewTabContentView(
      state,
      action: PayloadAction<{ sessionId: string; tabId: string; contentView: ArtifactContentView }>,
    ) {
      const tab = state.previewTabsBySession[action.payload.sessionId]?.find((item) => item.id === action.payload.tabId);
      if (tab) {
        tab.contentView = action.payload.contentView;
      }
      if (state.activePreviewTabIdBySession[action.payload.sessionId] === action.payload.tabId) {
        state.activeTab = action.payload.contentView;
      }
    },
    togglePanel(state, action: PayloadAction<{ sessionId?: string } | undefined>) {
      const sessionId = action.payload?.sessionId;
      const nextOpen = !(sessionId ? state.panelOpenBySession[sessionId] ?? state.isPanelOpen : state.isPanelOpen);
      setPanelOpen(state, sessionId, nextOpen);
    },
    closePanel(state, action: PayloadAction<{ sessionId?: string } | undefined>) {
      setPanelOpen(state, action.payload?.sessionId, false);
    },
    setActiveTab(state, action: PayloadAction<ArtifactActiveTab>) {
      state.activeTab = action.payload;
      const artifactId = state.selectedArtifactId;
      if (!artifactId) return;
      const sessionId = findArtifactSessionId(state, artifactId);
      if (!sessionId) return;
      const activeTabId = state.activePreviewTabIdBySession[sessionId];
      const tab = state.previewTabsBySession[sessionId]?.find((item) => item.id === activeTabId);
      if (tab) {
        tab.contentView = action.payload;
      }
    },
    setPanelView(state, action: PayloadAction<ArtifactPanelView>) {
      state.panelView = action.payload;
    },
    setPanelWidth(state, action: PayloadAction<number>) {
      state.panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, action.payload));
    },
    clearSessionArtifacts(state, action: PayloadAction<string>) {
      delete state.artifactsBySession[action.payload];
      delete state.previewTabsBySession[action.payload];
      delete state.activePreviewTabIdBySession[action.payload];
      delete state.panelOpenBySession[action.payload];
      state.selectedArtifactId = null;
      state.activeTab = ArtifactContentView.Preview;
    },
  },
});

export const {
  setSessionArtifacts,
  addArtifact,
  selectArtifact,
  openArtifactPreviewTab,
  activateArtifactPreviewTab,
  activateArtifactFileListTab,
  activateArtifactBrowserTab,
  closeArtifactPreviewTab,
  setPreviewTabContentView,
  togglePanel,
  closePanel,
  setActiveTab,
  setPanelView,
  setPanelWidth,
  clearSessionArtifacts,
} = artifactSlice.actions;

export const selectSessionArtifacts = (state: RootState, sessionId: string): Artifact[] =>
  state.artifact.artifactsBySession[sessionId] ?? [];

export const selectSelectedArtifact = (state: RootState): Artifact | null => {
  const id = state.artifact.selectedArtifactId;
  if (!id) return null;
  for (const artifacts of Object.values(state.artifact.artifactsBySession)) {
    const found = artifacts.find((artifact) => artifact.id === id);
    if (found) return found;
  }
  return null;
};

export const selectIsPanelOpen = (state: RootState, sessionId?: string): boolean => {
  if (!sessionId) return state.artifact.isPanelOpen;
  return state.artifact.panelOpenBySession[sessionId] ?? state.artifact.isPanelOpen;
};
export const selectPanelWidth = (state: RootState): number => state.artifact.panelWidth;
export const selectPanelView = (state: RootState): ArtifactPanelView => state.artifact.panelView;
export const selectActiveTab = (state: RootState): ArtifactActiveTab => state.artifact.activeTab;
export const selectPreviewTabs = (state: RootState, sessionId: string): ArtifactPreviewTab[] =>
  state.artifact.previewTabsBySession[sessionId] ?? [];

export const selectActivePreviewTab = (state: RootState, sessionId: string): ArtifactPreviewTab | null => {
  const activeTabId = state.artifact.activePreviewTabIdBySession[sessionId];
  if (!activeTabId) return null;
  return state.artifact.previewTabsBySession[sessionId]?.find((tab) => tab.id === activeTabId) ?? null;
};

export { DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH };

export default artifactSlice.reducer;
