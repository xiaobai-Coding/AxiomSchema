export interface PatchHistoryRecord {
  id: string
  timestamp: number
  summary: string
  patch: any
  beforeSchema: any
  afterSchema: any
  // extended metadata
  source?: 'AI' | 'MANUAL' | 'IMPORT' | 'ROLLBACK'
  baseVersion?: number
  toVersion?: number
  impact?: { added: string[]; updated: string[]; removed: string[] }
  counts?: { added: number; updated: number; removed: number; validOps: number; skippedOps: number }
}
