import type { PatchHistoryRecord } from '../types/history'

// 项目 ID
export const DEFAULT_PROJECT_ID = 'proj_demo'

// 获取 API Base URL
const getApiBaseUrl = () => import.meta.env.VITE_AI_API_BASE_URL || ''

// 获取 API Key
const getApiKey = () => import.meta.env.VITE_AI_API_KEY || ''

/**
 * 从后端获取 Patch 历史
 */
export async function fetchHistory(projectId: string = DEFAULT_PROJECT_ID): Promise<PatchHistoryRecord[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/patches`, {
    headers: {
      'Authorization': `Bearer ${getApiKey()}`
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch history: ${response.statusText}`)
  }
  const data = await response.json()
  // 假设后端返回的数据结构中 data 字段包含记录列表，或者直接返回数组
  // 根据之前的 API 风格，通常是 { code: 200, data: [...] }
  if (data.code === 200 && Array.isArray(data.data)) {
      return data.data
  }
  // 如果直接返回数组
  if (Array.isArray(data)) {
      return data
  }
  return []
}

/**
 * 保存 Patch 到后端
 */
export async function saveHistory(record: PatchHistoryRecord, projectId: string = DEFAULT_PROJECT_ID): Promise<{ version: number }> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/patches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`
    },
    body: JSON.stringify(record)
  })
  
  if (!response.ok) {
    throw new Error(`Failed to save patch: ${response.statusText}`)
  }
  
  const data = await response.json()
  // 假设后端返回结构 { code: 200, data: { version: 10 } }
  if (data.code === 200 && data.data) {
      return data.data
  }
  return data
}

/**
 * 回滚到指定 Patch
 */
export async function rollbackPatch(targetPatchId: string, projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/rollback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({ target_patch_id: targetPatchId })
  })

  if (!response.ok) {
    throw new Error(`Failed to rollback: ${response.statusText}`)
  }

  const data = await response.json()
  if (data.code !== 200) {
    throw new Error(data.message || 'Rollback failed')
  }
}
