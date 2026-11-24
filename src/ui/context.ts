import { createContext, useContext } from 'react'
import type { PayrollState, Version } from '../api/contract'
import type { Page } from './model'
export type DialogView =
  | { kind: 'import' | 'addEmployee' | 'versions' }
  | { kind: 'history' | 'range' | 'addHistory'; id: string }
  | { kind: 'version'; version: Version }
  | { kind: 'slip'; version: Version; index: number }
export interface Workspace {
  state: PayrollState
  month: string
  setMonth: (s: string) => void
  page: Page
  go: (p: Page) => void
  show: (v: DialogView | null) => void
  notify: (s: string) => void
  save: (s: PayrollState) => Promise<boolean>
}
export const WorkspaceContext = createContext<Workspace | null>(null)
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw Error('Workspace unavailable')
  return value
}
