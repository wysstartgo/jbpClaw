export const PetIpcChannel = {
  GetState: 'pet:getState',
  GetConfig: 'pet:getConfig',
  SetConfig: 'pet:setConfig',
  Refresh: 'pet:refresh',
  ListPets: 'pet:listPets',
  SelectPet: 'pet:selectPet',
  EnsurePet: 'pet:ensurePet',
  ImportPet: 'pet:importPet',
  DeletePet: 'pet:deletePet',
  SetStatus: 'pet:setStatus',
  SetRuntimeProjection: 'pet:setRuntimeProjection',
  AcknowledgeSession: 'pet:acknowledgeSession',
  SetFloatingVisible: 'pet:setFloatingVisible',
  ActivateMainWindow: 'pet:activateMainWindow',
  ActivateSession: 'pet:activateSession',
  MoveFloatingWindowBy: 'pet:moveFloatingWindowBy',
  ResizeFloatingWindowBy: 'pet:resizeFloatingWindowBy',
  PersistFloatingWindowPosition: 'pet:persistFloatingWindowPosition',
  SetFloatingActivityOpen: 'pet:setFloatingActivityOpen',
  SetFloatingWindowIgnoresMouseEvents: 'pet:setFloatingWindowIgnoresMouseEvents',
  OpenSettings: 'pet:openSettings',
  StateChanged: 'pet:stateChanged',
} as const;

export type PetIpcChannel = typeof PetIpcChannel[keyof typeof PetIpcChannel];

export const PetRendererRoute = {
  Floating: 'pet-floating',
} as const;

export type PetRendererRoute = typeof PetRendererRoute[keyof typeof PetRendererRoute];

export const PetMode = {
  Embedded: 'embedded',
  Floating: 'floating',
  Both: 'both',
} as const;

export type PetMode = typeof PetMode[keyof typeof PetMode];

export const PetAnchor = {
  Composer: 'composer',
  AppBottom: 'app-bottom',
  ScreenBottom: 'screen-bottom',
} as const;

export type PetAnchor = typeof PetAnchor[keyof typeof PetAnchor];

export const PetStatus = {
  Idle: 'idle',
  Running: 'running',
  Waiting: 'waiting',
  Review: 'review',
  Failed: 'failed',
} as const;

export type PetStatus = typeof PetStatus[keyof typeof PetStatus];

export const PET_NOTIFICATION_LIFETIME_MS: Record<PetStatus, number> = {
  [PetStatus.Idle]: 0,
  [PetStatus.Running]: 3 * 60 * 1000,
  [PetStatus.Waiting]: 24 * 60 * 60 * 1000,
  [PetStatus.Review]: 7 * 24 * 60 * 60 * 1000,
  [PetStatus.Failed]: 60 * 60 * 1000,
};

export const PetSource = {
  Bundled: 'bundled',
  Downloaded: 'downloaded',
  Custom: 'custom',
  LegacyAvatar: 'legacyAvatar',
  CodexCustom: 'codexCustom',
} as const;

export type PetSource = typeof PetSource[keyof typeof PetSource];

export const PetAssetPolicy = {
  BundledOnly: 'bundled-only',
  DownloadOnDemand: 'download-on-demand',
  Mixed: 'mixed',
} as const;

export type PetAssetPolicy = typeof PetAssetPolicy[keyof typeof PetAssetPolicy];

export const PetImportKind = {
  Directory: 'directory',
  Zip: 'zip',
} as const;

export type PetImportKind = typeof PetImportKind[keyof typeof PetImportKind];

export const DEFAULT_PET_ID = 'codex';
export const DISABLED_PET_ID = 'disabled';
export const PET_BUILTIN_CATALOG_ORDER = [
  'codex',
  'dewey',
  'fireball',
  'rocky',
  'seedy',
  'stacky',
  'bsod',
  'null-signal',
] as const;

export const PET_FRAME_DEFAULTS = {
  width: 192,
  height: 208,
  columns: 8,
  rows: 9,
} as const;

export const PET_SPRITESHEET_WIDTH = PET_FRAME_DEFAULTS.width * PET_FRAME_DEFAULTS.columns;
export const PET_SPRITESHEET_HEIGHT = PET_FRAME_DEFAULTS.height * PET_FRAME_DEFAULTS.rows;

export const PET_MAX_SPRITESHEET_BYTES = 4 * 1024 * 1024;
export const PET_DOWNLOAD_TIMEOUT_MS = 60_000;
