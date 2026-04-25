export type DetailTab = 'files' | 'conflicts'

export type TreeContextMenuState = {
  x: number
  y: number
  nodeId: string | null
}

export type TreeActionDialogState =
  | { mode: 'create-folder' | 'rename'; nodeId: string | null }
  | { mode: 'delete'; nodeId: string }

export interface FileTreeEntry {
  deployPath: string
  kind: 'file' | 'folder'
  sourcePath?: string
}

export interface FileTreeNode {
  id: string
  name: string
  path: string
  kind: 'folder' | 'file'
  sourcePath?: string
  fileCount: number
  children: FileTreeNode[]
}

export interface DetailViewport {
  width: number
  height: number
  screenWidth: number
  screenHeight: number
}
