import crypto from 'crypto';
import { app, BrowserWindow, session } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  type AppUpdateCheckResult,
  type AppUpdateInfo,
  AppUpdateIpc,
  type AppUpdateRuntimeState,
  AppUpdateSource,
  AppUpdateStatus,
} from '../../shared/appUpdate/constants';
import type { SqliteStore } from '../sqliteStore';
import { cancelActiveDownload, downloadUpdate, installUpdate } from './appUpdateInstaller';
import { getFallbackDownloadUrl, getManualUpdateCheckUrl, getUpdateCheckUrl } from './endpoints';
import { getKeyfromAttribution, initializeKeyfromAttribution } from './keyfromAttribution';

const APP_UPDATE_READY_FILE_KEY_PREFIX = 'app_update_ready_file';
const APP_UPDATE_TEST_CURRENT_VERSION_ENV = 'LOBSTERAI_UPDATE_CURRENT_VERSION';
const INSTALLATION_UUID_KEY = 'installation_uuid';

type ChangeLogLang = {
  title?: string;
  content?: string[];
};

type PlatformDownload = {
  url?: string;
};

type UpdateApiResponse = {
  code?: number;
  data?: {
    value?: {
      version?: string;
      date?: string;
      changeLog?: {
        ch?: ChangeLogLang;
        en?: ChangeLogLang;
      };
      macIntel?: PlatformDownload;
      macArm?: PlatformDownload;
      windowsX64?: PlatformDownload;
    };
  };
};

type StoredReadyFile = {
  version: string;
  filePath: string;
  fileHash: string;
  info?: AppUpdateInfo;
};

const initialState = (): AppUpdateRuntimeState => ({
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
});

function toVersionParts(version: string): number[] {
  return version
    .split('.')
    .map((part) => {
      const match = part.trim().match(/^\d+/);
      return match ? Number.parseInt(match[0], 10) : 0;
    });
}

export class AppUpdateCoordinator {
  private state: AppUpdateRuntimeState = initialState();
  private readonly store: Pick<SqliteStore, 'get' | 'set' | 'delete'>;
  private readonly getCurrentVersion: () => string;
  private autoOpenReadyModal = false;
  private flowSequence = 0;
  private activeFlowId = 0;
  private activeFlowSource: AppUpdateSource | null = null;

  constructor(
    store: Pick<SqliteStore, 'get' | 'set' | 'delete'>,
    options?: { currentVersion?: string },
  ) {
    this.store = store;
    this.getCurrentVersion = () => options?.currentVersion ?? this.resolveCurrentVersion();
    initializeKeyfromAttribution(store);
    this.restoreStoredReadyState();
  }

  getState(): AppUpdateRuntimeState {
    return { ...this.state };
  }

  shouldAutoOpenReadyModal(): boolean {
    return this.autoOpenReadyModal;
  }

  consumeAutoOpenReadyModal(): void {
    this.autoOpenReadyModal = false;
  }

  async checkNow(options?: { manual?: boolean; userId?: string | null }): Promise<AppUpdateCheckResult> {
    const source = options?.manual === true ? AppUpdateSource.Manual : AppUpdateSource.Auto;

    if (this.isUpdateDisabled()) {
      console.log('[AppUpdate] updates are disabled by enterprise config');
      return {
        success: true,
        state: this.resetToIdle(source),
        updateFound: false,
      };
    }

    if (options?.manual === true && this.state.source === AppUpdateSource.Auto) {
      if (this.state.status === AppUpdateStatus.Downloading) {
        const cancelled = cancelActiveDownload();
        console.log(`[AppUpdate] manual check cancelled active auto download, cancelled=${cancelled}`);
      } else if (this.state.status === AppUpdateStatus.Installing) {
        return { success: true, state: this.getState(), updateFound: this.state.info !== null };
      }
    }

    if (
      (this.state.status === AppUpdateStatus.Downloading || this.state.status === AppUpdateStatus.Installing) &&
      this.state.source === source
    ) {
      return { success: true, state: this.getState(), updateFound: this.state.info !== null };
    }

    const previousState = this.getState();
    const flowId = this.beginFlow(source);
    this.setState({
      ...this.state,
      status: AppUpdateStatus.Checking,
      source,
      errorMessage: null,
    });

    try {
      const currentVersion = this.getCurrentVersion();
      const info = await this.fetchUpdateInfo(currentVersion, source, options?.userId);
      if (!this.isFlowActive(flowId, source)) {
        return { success: true, state: this.getState(), updateFound: this.getState().info !== null };
      }
      if (!info) {
        if (
          previousState.source === source &&
          previousState.status === AppUpdateStatus.Ready &&
          previousState.readyFilePath != null &&
          previousState.readyFileHash != null &&
          previousState.info != null &&
          this.compareVersions(previousState.info.latestVersion, currentVersion) > 0
        ) {
          return {
            success: true,
            state: this.setState({ ...previousState, errorMessage: null }),
            updateFound: true,
          };
        }
        return {
          success: true,
          state: this.setState({ ...initialState(), source }),
          updateFound: false,
        };
      }

      const matchingReadyFile = await this.resolveMatchingReadyFile(previousState, source, info.latestVersion);
      if (!this.isFlowActive(flowId, source)) {
        return { success: true, state: this.getState(), updateFound: this.getState().info !== null };
      }

      if (matchingReadyFile) {
        return {
          success: true,
          state: this.setState({
            ...previousState,
            status: AppUpdateStatus.Ready,
            source,
            info: matchingReadyFile.info ?? info,
            progress: null,
            readyFilePath: matchingReadyFile.filePath,
            readyFileHash: matchingReadyFile.fileHash,
            errorMessage: null,
          }),
          updateFound: true,
        };
      }

      const storedReadyFile = this.getStoredReadyFile(source);
      if (storedReadyFile?.filePath) {
        void this.cleanupReadyFile(storedReadyFile.filePath);
      }
      this.clearStoredReadyFile(source);
      void this.pruneCachedInstallerFiles(source);

      if (options?.manual !== true && this.canPredownload(info.url)) {
        void this.startDownload(info, flowId, source);
        return {
          success: true,
          state: this.getState(),
          updateFound: true,
        };
      }

      return {
        success: true,
        state: this.setState({
          status: AppUpdateStatus.Available,
          source,
          info,
          progress: null,
          readyFilePath: null,
          readyFileHash: null,
          errorMessage: null,
        }),
        updateFound: true,
      };
    } catch (error) {
      if (!this.isFlowActive(flowId, source)) {
        return { success: true, state: this.getState(), updateFound: this.getState().info !== null };
      }
      console.error('[AppUpdate] check failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Check failed';
      return {
        success: false,
        state: this.setState({
          ...previousState,
          status: previousState.info ? AppUpdateStatus.Error : AppUpdateStatus.Idle,
          source,
          errorMessage,
        }),
        updateFound: previousState.info !== null,
        error: errorMessage,
      };
    }
  }

  async retryDownload(): Promise<AppUpdateRuntimeState> {
    const info = this.state.info;
    if (!info || !this.canPredownload(info.url)) {
      return this.getState();
    }
    if (this.state.status === AppUpdateStatus.Downloading || this.state.status === AppUpdateStatus.Installing) {
      return this.getState();
    }

    const source = this.state.source ?? AppUpdateSource.Manual;
    const flowId = this.beginFlow(source);
    return this.startDownload(info, flowId, source);
  }

  setAvailableUpdate(info: AppUpdateInfo, source: AppUpdateSource = AppUpdateSource.Manual): AppUpdateRuntimeState {
    if (this.state.status === AppUpdateStatus.Downloading || this.state.status === AppUpdateStatus.Installing) {
      return this.getState();
    }

    return this.setState({
      status: AppUpdateStatus.Available,
      source,
      info,
      progress: null,
      readyFilePath: null,
      readyFileHash: null,
      errorMessage: null,
    });
  }

  cancelDownload(): AppUpdateRuntimeState {
    const cancelled = cancelActiveDownload();
    if (!cancelled || this.state.status !== AppUpdateStatus.Downloading) {
      return this.getState();
    }
    this.clearStoredReadyFile(this.state.source);

    return this.setState({
      ...this.state,
      status: this.state.info ? AppUpdateStatus.Available : AppUpdateStatus.Idle,
      progress: null,
      readyFilePath: null,
      readyFileHash: null,
      errorMessage: null,
    });
  }

  async installReadyUpdate(): Promise<{ success: boolean; state: AppUpdateRuntimeState; error?: string }> {
    if (this.state.status !== AppUpdateStatus.Ready || !this.state.readyFilePath) {
      return {
        success: false,
        state: this.getState(),
        error: 'Update is not ready to install',
      };
    }

    const previousState = this.getState();
    this.setState({
      ...this.state,
      status: AppUpdateStatus.Installing,
      errorMessage: null,
    });

    try {
      await installUpdate(previousState.readyFilePath);
      return { success: true, state: this.getState() };
    } catch (error) {
      console.error('[AppUpdate] install failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Installation failed';
      return {
        success: false,
        state: this.setState({
          ...previousState,
          status: AppUpdateStatus.Error,
          errorMessage,
        }),
        error: errorMessage,
      };
    }
  }

  private resetToIdle(source: AppUpdateSource | null = this.state.source): AppUpdateRuntimeState {
    const previousReadyFilePath = this.state.readyFilePath;
    const previousSource = this.state.source;
    const state = this.setState({ ...initialState(), source });
    if (previousReadyFilePath) {
      void this.cleanupReadyFile(previousReadyFilePath);
    }
    this.clearStoredReadyFile(previousSource);
    return state;
  }

  private async startDownload(
    info: AppUpdateInfo,
    flowId: number,
    source: AppUpdateSource,
  ): Promise<AppUpdateRuntimeState> {
    this.setState({
      status: AppUpdateStatus.Downloading,
      source,
      info,
      progress: null,
      readyFilePath: null,
      readyFileHash: null,
      errorMessage: null,
    });

    try {
      const filePath = await downloadUpdate(info.url, source, (progress) => {
        if (!this.isFlowActive(flowId, source)) {
          return;
        }
        this.setState({
          ...this.state,
          status: AppUpdateStatus.Downloading,
          source,
          info,
          progress,
          errorMessage: null,
        });
      });
      if (!this.isFlowActive(flowId, source)) {
        return this.getState();
      }
      const fileHash = await this.computeFileHash(filePath);
      this.setStoredReadyFile({
        version: info.latestVersion,
        filePath,
        fileHash,
        info,
      });
      await this.pruneCachedInstallerFiles(source, [filePath]);
      this.autoOpenReadyModal = true;
      return this.setState({
        status: AppUpdateStatus.Ready,
        source,
        info,
        progress: null,
        readyFilePath: filePath,
        readyFileHash: fileHash,
        errorMessage: null,
      });
    } catch (error) {
      if (!this.isFlowActive(flowId, source)) {
        return this.getState();
      }
      const cancelled = error instanceof Error && error.message === 'Download cancelled';
      if (cancelled) {
        this.clearStoredReadyFile(source);
      }
      return this.setState({
        status: cancelled ? AppUpdateStatus.Available : AppUpdateStatus.Error,
        source,
        info,
        progress: null,
        readyFilePath: null,
        readyFileHash: null,
        errorMessage: cancelled ? null : error instanceof Error ? error.message : 'Download failed',
      });
    }
  }

  private canPredownload(url: string): boolean {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return false;
    }
    if (!url || url.includes('#') || url.endsWith('/download-list')) {
      return false;
    }
    let normalizedPath: string;
    try {
      normalizedPath = new URL(url).pathname.toLowerCase();
    } catch {
      return false;
    }
    if (process.platform === 'darwin') {
      return normalizedPath.endsWith('.dmg');
    }
    if (process.platform === 'win32') {
      return normalizedPath.endsWith('.exe');
    }
    return false;
  }

  private async computeFileHash(filePath: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', chunk => {
        hash.update(chunk);
      });
      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });
    });
  }

  private async fetchUpdateInfo(
    currentVersion: string,
    source: AppUpdateSource,
    userId?: string | null,
  ): Promise<AppUpdateInfo | null> {
    const baseUrl = source === AppUpdateSource.Manual ? getManualUpdateCheckUrl() : getUpdateCheckUrl();
    const queryString = this.getUpdateQueryString(userId, currentVersion);
    const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;
    console.log(`[AppUpdate] checking update, currentVersion=${currentVersion}, url=${url}`);

    const response = await session.defaultSession.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Update check failed (HTTP ${response.status})`);
    }

    const payload = (await response.json()) as UpdateApiResponse;
    if (payload.code !== 0) {
      throw new Error(`Update check failed with code ${payload.code ?? 'unknown'}`);
    }

    const value = payload.data?.value;
    const latestVersion = value?.version?.trim();
    if (!latestVersion || this.compareVersions(latestVersion, currentVersion) <= 0) {
      console.log(
        `[AppUpdate] no update available, latestVersion=${latestVersion || 'N/A'}, currentVersion=${currentVersion}`,
      );
      return null;
    }

    const toEntry = (log?: ChangeLogLang) => ({
      title: typeof log?.title === 'string' ? log.title : '',
      content: Array.isArray(log?.content) ? log.content : [],
    });

    return {
      latestVersion,
      date: value?.date?.trim() || '',
      changeLog: {
        zh: toEntry(value?.changeLog?.ch),
        en: toEntry(value?.changeLog?.en),
      },
      url: this.getPlatformDownloadUrl(value),
    };
  }

  private getUpdateQueryString(userId?: string | null, version?: string): string {
    const params = new URLSearchParams();
    const installationId = this.getOrCreateInstallationId();
    if (installationId) {
      params.append('uuid', installationId);
    }
    if (userId) {
      params.append('userId', userId);
    }
    if (version) {
      params.append('version', version);
    }
    const { firstKeyfrom, latestKeyfrom } = getKeyfromAttribution(this.store);
    params.append('firstKeyfrom', firstKeyfrom);
    params.append('latestKeyfrom', latestKeyfrom);
    return params.toString();
  }

  private getOrCreateInstallationId(): string | null {
    try {
      const existing = this.store.get<string>('installation_uuid');
      if (typeof existing === 'string' && existing.trim()) {
        return existing;
      }
      const nextId = crypto.randomUUID();
      this.store.set(INSTALLATION_UUID_KEY, nextId);
      return nextId;
    } catch (error) {
      console.warn('[AppUpdate] failed to get installation uuid:', error);
      return null;
    }
  }

  private getPlatformDownloadUrl(value: NonNullable<NonNullable<UpdateApiResponse['data']>['value']> | undefined): string {
    if (process.platform === 'darwin') {
      const download = process.arch === 'arm64' ? value?.macArm : value?.macIntel;
      return download?.url?.trim() || getFallbackDownloadUrl();
    }

    if (process.platform === 'win32') {
      return value?.windowsX64?.url?.trim() || getFallbackDownloadUrl();
    }

    return getFallbackDownloadUrl();
  }

  private isUpdateDisabled(): boolean {
    const enterprise = this.store.get<{ disableUpdate?: boolean }>('enterprise_config');
    return enterprise?.disableUpdate === true;
  }

  private resolveCurrentVersion(): string {
    const overriddenVersion = process.env[APP_UPDATE_TEST_CURRENT_VERSION_ENV]?.trim();
    return overriddenVersion || app.getVersion();
  }

  private setState(nextState: AppUpdateRuntimeState): AppUpdateRuntimeState {
    this.state = { ...nextState };
    const snapshot = this.getState();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(AppUpdateIpc.StateChanged, snapshot);
      }
    }
    return snapshot;
  }

  private compareVersions(a: string, b: string): number {
    const aParts = toVersionParts(a);
    const bParts = toVersionParts(b);
    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i += 1) {
      const left = aParts[i] ?? 0;
      const right = bParts[i] ?? 0;
      if (left > right) return 1;
      if (left < right) return -1;
    }

    return 0;
  }

  private beginFlow(source: AppUpdateSource): number {
    const flowId = ++this.flowSequence;
    this.activeFlowId = flowId;
    this.activeFlowSource = source;
    return flowId;
  }

  private isFlowActive(flowId: number, source: AppUpdateSource): boolean {
    return this.activeFlowId === flowId && this.activeFlowSource === source;
  }

  private async cleanupReadyFile(filePath: string): Promise<void> {
    if (!filePath) return;
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Best effort cleanup only.
    }
  }

  private isCachedInstallerForSource(filename: string, source: AppUpdateSource | null): boolean {
    if (!filename.startsWith('lobsterai-update-')) {
      return false;
    }
    if (source == null) {
      return true;
    }
    if (filename.startsWith(`lobsterai-update-${source}-`)) {
      return true;
    }
    return /^lobsterai-update-\d+/.test(filename);
  }

  private async pruneCachedInstallerFiles(
    source: AppUpdateSource | null,
    keepFilePaths: string[] = [],
  ): Promise<void> {
    const keepSet = new Set(keepFilePaths.filter(Boolean).map(filePath => path.resolve(filePath)));
    const cacheDir = this.getUpdateCacheDir();

    try {
      const entries = await fs.promises.readdir(cacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !this.isCachedInstallerForSource(entry.name, source)) {
          continue;
        }
        const entryPath = path.resolve(cacheDir, entry.name);
        if (keepSet.has(entryPath)) {
          continue;
        }
        await fs.promises.unlink(entryPath).catch(() => {});
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        console.warn('[AppUpdate] failed to prune cached installer files:', error);
      }
    }
  }

  private async resolveMatchingReadyFile(
    previousState: AppUpdateRuntimeState,
    source: AppUpdateSource,
    latestVersion: string,
  ): Promise<StoredReadyFile | null> {
    if (
      previousState.source === source &&
      previousState.status === AppUpdateStatus.Ready &&
      previousState.info?.latestVersion === latestVersion &&
      previousState.readyFilePath != null &&
      previousState.readyFileHash != null
    ) {
      const valid = await this.isReadyFileValid(previousState.readyFilePath, previousState.readyFileHash);
      if (valid) {
        return {
          version: latestVersion,
          filePath: previousState.readyFilePath,
          fileHash: previousState.readyFileHash,
          info: previousState.info,
        };
      }
    }

    const storedReadyFile = this.getStoredReadyFile(source);
    if (!storedReadyFile || storedReadyFile.version !== latestVersion) {
      return null;
    }
    const valid = await this.isReadyFileValid(storedReadyFile.filePath, storedReadyFile.fileHash);
    if (valid) {
      return storedReadyFile;
    }
    await this.cleanupReadyFile(storedReadyFile.filePath);
    this.clearStoredReadyFile(source);
    return null;
  }

  private async isReadyFileValid(filePath: string, expectedHash: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return false;
      }
      const actualHash = await this.computeFileHash(filePath);
      return actualHash === expectedHash;
    } catch {
      return false;
    }
  }

  private restoreStoredReadyState(): void {
    const sources: AppUpdateSource[] = [AppUpdateSource.Manual, AppUpdateSource.Auto];

    for (const source of sources) {
      const storedReadyFile = this.getStoredReadyFile(source);
      if (!storedReadyFile) {
        continue;
      }

      if (this.compareVersions(storedReadyFile.version, this.getCurrentVersion()) <= 0) {
        console.log(
          `[AppUpdate] persisted ready file is not newer than current version, clearing it: source=${source}, storedVersion=${storedReadyFile.version}, currentVersion=${this.getCurrentVersion()}`,
        );
        this.clearStoredReadyFile(source);
        void this.pruneCachedInstallerFiles(source);
        continue;
      }

      try {
        const stat = fs.statSync(storedReadyFile.filePath);
        if (!stat.isFile() || stat.size <= 0) {
          console.warn(
            `[AppUpdate] persisted ready file is missing or empty during startup restore: ${storedReadyFile.filePath}`,
          );
          this.clearStoredReadyFile(source);
          void this.pruneCachedInstallerFiles(source);
          continue;
        }
      } catch {
        console.warn(
          `[AppUpdate] persisted ready file stat failed during startup restore: ${storedReadyFile.filePath}`,
        );
        this.clearStoredReadyFile(source);
        void this.pruneCachedInstallerFiles(source);
        continue;
      }

      this.state = {
        status: AppUpdateStatus.Ready,
        source,
        info: storedReadyFile.info ?? this.createStoredReadyInfo(storedReadyFile.version),
        progress: null,
        readyFilePath: storedReadyFile.filePath,
        readyFileHash: storedReadyFile.fileHash,
        errorMessage: null,
      };
      console.log(
        `[AppUpdate] restored ready update into runtime state, source=${source}, version=${this.state.info?.latestVersion ?? 'none'}, filePath=${this.state.readyFilePath ?? 'none'}`,
      );
      void this.pruneCachedInstallerFiles(source, [storedReadyFile.filePath]);
      return;
    }

    void this.pruneCachedInstallerFiles(AppUpdateSource.Manual);
    void this.pruneCachedInstallerFiles(AppUpdateSource.Auto);
  }

  private createStoredReadyInfo(version: string): AppUpdateInfo {
    return {
      latestVersion: version,
      date: '',
      changeLog: {
        zh: { title: '', content: [] },
        en: { title: '', content: [] },
      },
      url: '',
    };
  }

  private getReadyFileStoreKey(source: AppUpdateSource | null): string {
    return `${APP_UPDATE_READY_FILE_KEY_PREFIX}:${source ?? 'unknown'}`;
  }

  private getStoredReadyFile(source: AppUpdateSource | null): StoredReadyFile | null {
    try {
      const value = this.store.get<StoredReadyFile>(this.getReadyFileStoreKey(source));
      if (!value?.version || !value.filePath || !value.fileHash) {
        return null;
      }
      return value;
    } catch (error) {
      console.warn('[AppUpdate] failed to read stored ready file:', error);
      return null;
    }
  }

  private clearStoredReadyFile(source: AppUpdateSource | null): void {
    if (source == null) {
      return;
    }
    try {
      this.store.delete(this.getReadyFileStoreKey(source));
    } catch (error) {
      console.warn('[AppUpdate] failed to clear stored ready file:', error);
    }
  }

  private setStoredReadyFile(value: StoredReadyFile): void {
    const source = this.state.source ?? AppUpdateSource.Manual;
    try {
      this.store.set(this.getReadyFileStoreKey(source), value);
    } catch (error) {
      console.warn('[AppUpdate] failed to persist ready file:', error);
    }
  }

  getUpdateCacheDir(): string {
    return path.join(app.getPath('userData'), 'updates');
  }
}
