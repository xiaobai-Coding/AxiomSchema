import type { PatchHistoryRecord } from '../types/history'
import { useSession } from '@clerk/vue'

// 项目 ID
export const DEFAULT_PROJECT_ID = 'proj_demo'

// 获取 API Base URL
const getApiBaseUrl = () => import.meta.env.VITE_AI_API_BASE_URL || ''

// 辅助函数：获取 Clerk Token
// 注意：由于 useSession 只能在 Vue 组件的 setup 中使用，
// 这里我们需要在调用时传入 token，或者利用 window 全局对象（不推荐），
// 或者将 token 获取逻辑提升到组件层。
// 鉴于这是一个纯 TS 服务文件，我们建议将 token 作为参数传入，或者从外部注入。
// 但为了保持 API 签名简洁，我们可以尝试动态获取 session（但这在非组件上下文可能不可行）。
// 最好的方式是修改函数签名，接受 token 参数。

// 为了最小化修改，我们让这些函数接受可选的 token 参数。
// 在组件调用时，使用 await session.value?.getToken() 获取并传入。

/**
 * 从后端获取 Patch 历史
 */
export async function fetchHistory(projectId: string = DEFAULT_PROJECT_ID, token?: string | null): Promise<PatchHistoryRecord[]> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`/api/projects/${projectId}/patches`, {
    headers
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
export async function saveHistory(record: PatchHistoryRecord, projectId: string = DEFAULT_PROJECT_ID, token?: string | null): Promise<{ version: number }> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/patches`, {
    method: 'POST',
    headers,
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
export async function rollbackPatch(targetPatchId: string, projectId: string = DEFAULT_PROJECT_ID, token?: string | null): Promise<void> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`/api/projects/${projectId}/rollback`, {
    method: 'POST',
    headers,
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
