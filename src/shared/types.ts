// ─── Mod Types ───────────────────────────────────────────────────────────────

export type ModType =
  | 'archive'
  | 'redmod'
  | 'cet'
  | 'redscript'
  | 'tweakxl'
  | 'red4ext'
  | 'bin'
  | 'engine'
  | 'r6'
  | 'unknown'

export type ModKind = 'mod' | 'separator' | 'empty'

export interface ModMetadata {
  uuid: string
  name: string
  type: ModType
  kind: ModKind
  order: number
  enabled: boolean
  author?: string
  version?: string
  description?: string
  installedAt: string
  enabledAt?: string
  sourceModifiedAt?: string
  fileSize?: number
  files: string[]
  emptyDirs?: string[]
  hashes?: string[]
  archiveResources?: ArchiveResourceEntry[]
  archiveResourceIndexVersion?: number
  notes?: string
  folderName?: string
  sourcePath?: string
  sourceType?: 'archive' | 'directory'
  nexusModId?: number
  nexusFileId?: number
  previewImagePath?: string
  galleryImagePaths?: string[]
  deployedPaths?: string[]
  conflictSummary?: {
    overwrites: number
    overwrittenBy: number
  }
}

export interface ArchiveResourceEntry {
  hash?: string
  resourcePath?: string
  archivePath?: string
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  gamePath: string
  libraryPath: string
  downloadPath: string
  theme: 'dark'
  autoUpdate: boolean
  nexusApiKey: string
  autoInstallPerMod?: Record<string, 'replace' | 'copy' | 'none'>
}

// ─── Nexus / NXM ─────────────────────────────────────────────────────────────

export interface ActiveDownload {
  id: string
  nxmModId: number
  nxmFileId: number
  fileName: string
  startedAt: string
  totalBytes: number
  downloadedBytes: number
  speedBps: number
  status: 'queued' | 'downloading' | 'paused' | 'done' | 'error'
  error?: string
  savedPath?: string
  version?: string
}

export interface NxmLinkPayload {
  modId: number
  fileId: number
  key: string
  expires: number
  userId: number
  raw: string
}

export interface DuplicateNxmDownloadInfo {
  modId: number
  fileId: number
  existingFileName: string
  existingFilePath: string
  incomingFileName: string
  existingIsDownloading?: boolean
}

export interface NxmDownloadStartRequest {
  payload: NxmLinkPayload
  allowDuplicate?: boolean
  requestedAt?: string
}

export interface NxmDownloadStartResponse {
  status: 'started' | 'duplicate'
  id?: string
  fileName?: string
  startedAt?: string
  savedPath?: string
  version?: string
  duplicate?: DuplicateNxmDownloadInfo
}

export interface NexusValidateResult {
  userId: number
  key: string
  name: string
  isPremium: boolean
  email: string
}

export interface NexusApiLogEntry {
  id: string
  timestamp: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  url: string
  requestContext?: unknown
  requestBody?: unknown
  responseBody?: unknown
  payload?: unknown
  status: 'success' | 'error'
  statusCode?: number
  durationMs: number
  error?: string
}

export interface AppGeneralLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
  details?: unknown
}

export interface AppLogsSnapshot {
  general: AppGeneralLogEntry[]
  requests: NexusApiLogEntry[]
}

export type AppLogsUpdate =
  | { kind: 'general'; entry: AppGeneralLogEntry }
  | { kind: 'requests'; entry: NexusApiLogEntry }

export interface PathDefaults {
  libraryPath: string
  downloadPath: string
}

export interface DownloadEntry {
  path: string
  name: string
  size: number
  modifiedAt: string
  downloadedAt?: string
  extension: string
  nxmModId?: number
  nxmFileId?: number
  version?: string
}

// ─── FOMOD ────────────────────────────────────────────────────────────────────

export interface FomodFileEntry {
  source: string
  destination: string
  type: 'file' | 'folder'
}

export type FomodGroupType =
  | 'SelectExactlyOne'
  | 'SelectAtMostOne'
  | 'SelectAll'
  | 'SelectAny'
  | 'SelectAllAndMore'

export type FomodPluginType =
  | 'Optional'
  | 'Required'
  | 'Recommended'
  | 'NotUsable'
  | 'CouldBeUsable'

export interface FomodPlugin {
  name: string
  description: string
  image?: string
  files: FomodFileEntry[]
  conditionFlags?: Array<{ name: string; value: string }>
  typeDescriptor?: FomodPluginType
}

export interface FomodGroup {
  name: string
  type: FomodGroupType
  plugins: FomodPlugin[]
}

export interface FomodStep {
  name: string
  groups: FomodGroup[]
  visibleConditions?: Array<{ flag: string; value: string }>
}

export interface FomodConditionalInstall {
  dependencies: Array<{ flag: string; value: string }>
  files: FomodFileEntry[]
}

export interface FomodModuleConfig {
  moduleName: string
  moduleImage?: string
  steps: FomodStep[]
  requiredFiles: FomodFileEntry[]
  conditionalInstalls: FomodConditionalInstall[]
}

export interface FomodInstallRequest {
  tempDir: string
  extractRoot: string
  originalFilePath: string
  installEntries: FomodFileEntry[]
  needsExtraction?: boolean
  duplicateAction?: InstallDuplicateAction
  targetModId?: string
  nexusModId?: number
  nexusFileId?: number
  sourceFileName?: string
  sourceVersion?: string
  skipVersionMismatchPrompt?: boolean
  allowOverwriteConflicts?: boolean
}

// ─── Install ──────────────────────────────────────────────────────────────────

export interface InstallProgress {
  step: string
  percent: number
  currentFile?: string
}

export interface ConflictInfo {
  kind: 'overwrite' | 'archive-resource'
  resourcePath: string
  existingModId: string
  existingModName: string
  incomingModName: string
  incomingModId?: string
  existingOrder?: number
  incomingOrder?: number
  incomingWins?: boolean
  hash?: string
}

export interface ModConflictSummary {
  modId: string
  overwrites: number
  overwrittenBy: number
}

export interface DuplicateModInfo {
  existingModId: string
  existingModName: string
  incomingModName: string
  sourcePath: string
}

export interface ModTreeCreateEntryRequest {
  modId: string
  parentRelativePath?: string
  name: string
  kind: 'file' | 'folder'
}

export interface ModTreeRenameEntryRequest {
  modId: string
  relativePath: string
  nextName: string
}

export interface ModTreeDeleteEntryRequest {
  modId: string
  relativePath: string
}

export type InstallDuplicateAction = 'prompt' | 'replace' | 'copy'

export interface InstallModRequest {
  filePath: string
  duplicateAction?: InstallDuplicateAction
  targetModId?: string
  nexusModId?: number
  nexusFileId?: number
  sourceFileName?: string
  sourceVersion?: string
  skipVersionMismatchPrompt?: boolean
  allowOverwriteConflicts?: boolean
}

export interface InstallModResponse {
  status: 'installed' | 'duplicate' | 'conflict' | 'version-mismatch' | 'fomod'
  mod?: ModMetadata
  conflicts?: ConflictInfo[]
  duplicate?: DuplicateModInfo
  fomod?: { xml: string; tempDir: string; extractRoot: string; needsExtraction?: boolean }
}

export interface InstallResult {
  ok: boolean
  mod?: ModMetadata
  error?: string
}

export interface PurgeModsResult {
  purged: number
  failed: number
}

// ─── IPC Result wrapper ───────────────────────────────────────────────────────

export interface IpcResult<T = undefined> {
  ok: boolean
  data?: T
  error?: string
}

// ─── Update ──────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  version: string
  releaseNotes?: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

// ─── Toast ────────────────────────────────────────────────────────────────────

export type ToastSeverity = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  message: string
  severity: ToastSeverity
  duration?: number
}

// ─── IPC Channels ────────────────────────────────────────────────────────────

export const IPC = {
  // Settings
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  GET_PATH_DEFAULTS: 'settings:getPathDefaults',

  // Mods
  SCAN_MODS: 'mods:scan',
  CALCULATE_MOD_CONFLICTS: 'mods:calculateConflicts',
  ENABLE_MOD: 'mods:enable',
  ENABLE_MODS: 'mods:enableMany',
  DISABLE_MOD: 'mods:disable',
  DISABLE_MODS: 'mods:disableMany',
  RESTORE_ENABLED_MODS: 'mods:restoreEnabled',
  PURGE_MODS: 'mods:purge',
  DELETE_MOD: 'mods:delete',
  CREATE_SEPARATOR: 'mods:createSeparator',
  REORDER_MODS: 'mods:reorder',
  UPDATE_MOD_METADATA: 'mods:updateMetadata',
  MOD_TREE_CREATE_ENTRY: 'mods:treeCreateEntry',
  MOD_TREE_RENAME_ENTRY: 'mods:treeRenameEntry',
  MOD_TREE_DELETE_ENTRY: 'mods:treeDeleteEntry',

  // Install
  INSTALL_MOD: 'install:mod',
  REINSTALL_MOD: 'install:reinstall',
  INSTALL_PROGRESS: 'install:progress',
  FOMOD_INSTALL: 'install:fomod',
  FOMOD_CANCEL: 'install:fomodCancel',
  FOMOD_READ_IMAGE: 'fomod:readImage',
  LIST_DOWNLOADS: 'downloads:list',
  DELETE_DOWNLOAD: 'downloads:delete',
  DELETE_ALL_DOWNLOADS: 'downloads:deleteAll',

  // Game
  DETECT_GAME: 'game:detect',
  VALIDATE_GAME_PATH: 'game:validatePath',
  VALIDATE_LIBRARY_PATH: 'library:validatePath',
  LAUNCH_GAME: 'game:launch',

  // Updates
  CHECK_UPDATE: 'update:check',
  DOWNLOAD_UPDATE: 'update:download',
  INSTALL_UPDATE: 'update:install',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',

  // Nexus / NXM
  NXM_LINK_RECEIVED:     'nxm:linkReceived',
  NXM_DOWNLOAD_START:    'nxm:downloadStart',
  NXM_DOWNLOAD_PROGRESS: 'nxm:downloadProgress',
  NXM_DOWNLOAD_COMPLETE: 'nxm:downloadComplete',
  NXM_DOWNLOAD_ERROR:    'nxm:downloadError',
  NXM_DOWNLOAD_CANCEL:   'nxm:downloadCancel',
  NXM_DOWNLOAD_PAUSE:    'nxm:downloadPause',
  NXM_DOWNLOAD_RESUME:   'nxm:downloadResume',
  NEXUS_VALIDATE_KEY:    'nexus:validateKey',
  NEXUS_API_LOG_LIST:    'nexus:apiLogList',
  NEXUS_API_LOG_CLEAR:   'nexus:apiLogClear',
  NEXUS_API_LOG_UPDATED: 'nexus:apiLogUpdated',
  APP_LOGS_GET:          'app:logsGet',
  APP_LOGS_CLEAR:        'app:logsClear',
  APP_LOGS_UPDATED:      'app:logsUpdated',

  // App / Dialogs
  APP_READY: 'app:ready',
  APP_BOOT_STATUS: 'app:bootStatus',
  OPEN_FILE_DIALOG: 'dialog:openFile',
  OPEN_FOLDER_DIALOG: 'dialog:openFolder',
  OPEN_PATH: 'shell:openPath',
  SHOW_ITEM_IN_FOLDER: 'shell:showItemInFolder',
  OPEN_EXTERNAL: 'shell:openExternal',
  GET_APP_VERSION: 'app:getVersion',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
