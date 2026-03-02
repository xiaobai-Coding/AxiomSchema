<script setup lang="ts">
// @ts-nocheck
import { ref, watch, nextTick, computed, onMounted } from 'vue'
import { NConfigProvider, NInput, NAlert, NButton, NDrawer, NDrawerContent, NDropdown, NTag, createDiscreteApi, NDialog, NSpin, darkTheme } from 'naive-ui'
import { useDark, useToggle } from '@vueuse/core'
import { Codemirror } from 'vue-codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
// @ts-ignore vue shim
import PromptInput from './components/PromptInput.vue'
// @ts-ignore vue shim
import FormRenderer from './components/form-renderer/FormRenderer.vue'
// @ts-ignore vue shim
import FieldEditor from './components/form-renderer/FieldEditor.vue'
// @ts-ignore vue shim
import PatchPreviewModal from './components/PatchPreviewModal.vue'
// @ts-ignore vue shim
import VersionMismatchDialog from './components/VersionMismatchDialog.vue'
import { callDeepSeekAPI } from './services/aiService'
import { getClassifierPrompt, getSchemaPrompt } from './prompts/schemaPrompt';
import { useI18n } from 'vue-i18n'
import { useAuth, useSession, useUser } from '@clerk/vue'

const { t, locale } = useI18n()
const { session } = useSession()
const { isSignedIn } = useAuth()

// Check authentication
// onMounted(async () => {
//   const { data: { session } } = await supabase.auth.getSession()
//   if (!session) {
//     router.push('/login')
//   }
// })

function changeLocale(lang: 'zh' | 'en') {
  locale.value = lang
  localStorage.setItem('locale', lang)
}
import { applyPatchSafe } from './utils/applyPatch'
import { validatePatch } from './utils/validatePatch'
import { shouldClarify, isVagueOptimizeInput } from './utils/intentGuard'
import { buildImpactFromOps, buildStandardSummary } from './utils/patchSummary'
import type { ClarifyInfo } from './types/intent'
import { applyPatchPartial } from './utils/applyPatchPartial'
import type { PatchHistoryRecord } from './types/history'
import { fetchHistory, saveHistory, rollbackPatch } from './services/storageService'


const promptInputRef = ref<any>(null) // 用于获取 PromptInput 组件实例

// --- 深色模式支持 ---
const isDark = useDark()
const toggleDark = useToggle(isDark)

// CodeMirror 扩展配置
const editorExtensions = computed(() => {
  const exts = [json()]
  if (isDark.value) {
    exts.push(oneDark)
  }
  return exts
})

const themeOverrides = computed(() => ({
  common: {
    primaryColor: '#6366f1',
    primaryColorHover: '#818cf8',
    primaryColorPressed: '#4f46e5',
    primaryColorSuppl: '#818cf8',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    borderRadiusLarge: '12px',
    textColorBase: isDark.value ? '#f1f5f9' : '#0f172a'
  },
  Form: {
    labelFontSize: '14px',
    labelFontWeight: '600',
    labelTextColor: isDark.value ? '#f1f5f9' : '#0f172a',
    labelLineHeight: '1.6'
  },
  Input: {
    borderRadius: '10px',
    borderHover: '1px solid rgba(99, 102, 241, 0.3)',
    borderFocus: '1px solid #6366f1',
    boxShadowFocus: '0 0 0 3px rgba(99, 102, 241, 0.12)'
  },
  InputNumber: {
    borderRadius: '10px',
    borderHover: '1px solid rgba(99, 102, 241, 0.3)',
    borderFocus: '1px solid #6366f1',
    boxShadowFocus: '0 0 0 3px rgba(99, 102, 241, 0.12)'
  },
  Select: {
    borderRadius: '10px',
    borderHover: '1px solid rgba(99, 102, 241, 0.3)',
    borderFocus: '1px solid #6366f1',
    boxShadowFocus: '0 0 0 3px rgba(99, 102, 241, 0.12)'
  },
  Switch: {
    railColorActive: '#6366f1',
    buttonColor: '#ffffff'
  }
}))
function ensureSchemaVersion(s: any, forceInit = false) {
  if (!s) return null
  const next = JSON.parse(JSON.stringify(s))
  if (forceInit) {
    // 新生成或重置场景：强制从 1 开始
    next.meta = { ...(next.meta || {}), version: 1 }
  } else {
    if (!next.meta || typeof next.meta.version !== 'number') {
      next.meta = { version: 1 }
    }
  }
  return next
}

const schemaText = ref<string>('') // 用于编辑的 Schema 文本
const suppressSchemaTextWatch = ref(false) // 避免程序性写入触发回环
const schema = ref<any>(null) // 用于渲染的 Schema
const parseError = ref<string>('') // 解析错误
const selectedFieldKey = ref<string | null>(null) // 当前选中的字段
const showFieldEditor = ref(false) // 控制字段编辑器抽屉
const backupField = ref<any>(null) // 打开 Drawer 时备份字段
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingPatch = ref<any>(null) // 待确认的 patch
const patchDecisions = ref<any[]>([]) // patch 操作决策
const isPatchModalOpen = ref(false) // 控制 Patch Preview Modal 显示
const showHistoryDrawer = ref(false) // 控制 Patch History Drawer 显示

// GeneratePhase 状态
type GeneratePhase = 'idle' | 'classifying' | 'generating' | 'patching' | 'applying' | 'done' | 'error'
const generatePhase = ref<GeneratePhase>('idle')

// A: 字段高亮状态（UI 层副作用，不写入 schema）
const highlightMap = ref<{ added: string[]; updated: string[] }>({ added: [], updated: [] })

// B: 变更摘要提示（使用 createDiscreteApi 在根组件外创建）
const { message, dialog } = createDiscreteApi(['message', 'dialog'])

// 版本冲突对话控制（使用组件化的 NDialog）
const showVersionMismatchDialog = ref(false)
const versionMismatchInfo = ref<{ current: number; base: number }>({ current: 1, base: 1 })

// Intent 澄清模式状态
const clarifyVisible = ref(false)
const clarifyInfo = ref<ClarifyInfo | null>(null)

// Patch 历史记录
const patchHistory = ref<PatchHistoryRecord[]>([])
const isLoadingHistory = ref(false)
const expandedRecordIds = ref<Record<string, boolean>>({})

// 从后端恢复历史
async function loadPatchHistory() {
  isLoadingHistory.value = true
  try {
    const token = await session.value?.getToken()
    // console.log('loadPatchHistory Token:', token)
    
    if (!token) {
      // console.warn('loadPatchHistory: No token available yet')
      return
    }
    const records = await fetchHistory(undefined, token)
    patchHistory.value = records
    
    // 页面加载时，使用最新的 Patch 记录恢复 Schema 状态
    if (records.length > 0) {
       const latest = records[0]
       // 确保 afterSchema 存在
       if (latest.afterSchema) {
          const normalized = ensureSchemaVersion(latest.afterSchema)
          schema.value = normalized
          schemaText.value = JSON.stringify(normalized, null, 2)
       }
    }
  } catch (e) {
    console.error('加载 Patch 历史失败', e)
    // 如果是未登录导致失败，静默处理或显示“请登录”
    // message.error('加载历史记录失败')
  } finally {
    isLoadingHistory.value = false
  }
}

// 添加历史记录并保存到后端
async function addPatchHistory(record: PatchHistoryRecord) {
  // 乐观更新：先更新 UI
  patchHistory.value.unshift(record)
  
  try {
    const token = await session.value?.getToken()
    await saveHistory(record, undefined, token)
  } catch (e) {
    console.error('保存 Patch 历史失败', e)
    message.error('保存历史记录失败')
  }
}

// 回滚到指定记录
function rollbackTo(record: PatchHistoryRecord) {
  // 当存在待确认的 Patch 时，禁止回滚，避免状态冲突
  if (isPatchModalOpen.value || pendingPatch.value) {
    message.warning(t('message.pending_patch'))
    return
  }
  const added = record.counts?.added ?? record.impact?.added?.length ?? 0
  const updated = record.counts?.updated ?? record.impact?.updated?.length ?? 0
  const removed = record.counts?.removed ?? record.impact?.removed?.length ?? 0
  const content = t('history.rollback_msg', { to: record.toVersion ?? 0, base: record.baseVersion ?? 0, added, updated, removed })
  dialog.warning({
    title: t('history.confirm_rollback'),
    content,
    positiveText: t('history.confirm_rollback'),
    negativeText: t('common.cancel'),
    positiveButtonProps: {
      type: 'primary',
      size: 'small',
      class: 'rollback-btn'
    },
    negativeButtonProps: {
      quaternary: true,
      size: 'small'
    },
    onPositiveClick: () => {
      performRollback(record)
    }
  })
}

// 执行回滚操作
async function performRollback(record: PatchHistoryRecord) {
  isLoadingHistory.value = true
  try {
    const token = await session.value?.getToken()
    // 调用后端接口执行回滚
    await rollbackPatch(record.id, undefined, token)
    
    // 回滚成功后，更新本地状态
    schema.value = deepClone(record.beforeSchema)
    schemaText.value = JSON.stringify(record.beforeSchema, null, 2)
    
    // 刷新历史记录，以获取最新的回滚记录（后端通常会生成一条类型为 ROLLBACK 的新记录）
    await loadPatchHistory()
    
    // 清空当前状态
    pendingPatch.value = null
    isPatchModalOpen.value = false
    highlightMap.value = { added: [], updated: [] }
    selectedFieldKey.value = null
    showFieldEditor.value = false
    backupField.value = null
    showHistoryDrawer.value = false
    message.success(t('history.rollback_success', { summary: record.summary }))
  } catch (e: any) {
    console.error('回滚失败', e)
    message.error(e.message || '回滚失败，请稍后重试')
  } finally {
    isLoadingHistory.value = false
  }
}

// 格式化时间
function formatTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return locale.value === 'zh' ? '刚刚' : 'just now'
  if (minutes < 60) return locale.value === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  if (hours < 24) return locale.value === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  if (days < 7) return locale.value === 'zh' ? `${days} 天前` : `${days}d ago`
  return new Date(timestamp).toLocaleString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 从 patch 中提取 diff 信息
function getPatchDiff(patch: any): { added: string[]; updated: string[] } {
  const added: string[] = []
  const updated: string[] = []
  if (patch.operations) {
    patch.operations.forEach((op: any) => {
      if (op.op === 'add' && op.target === 'field' && op.value?.name) {
        added.push(op.value.name)
      } else if (op.op === 'update' && op.target === 'field' && op.name) {
        updated.push(op.name)
      }
    })
  }
  return { added, updated }
}

// 页面初始化时加载历史
  watch(isSignedIn, async (newVal) => {
    if (newVal) {
      // 等待 session 完全就绪
      await nextTick()
      // 用户登录后，重新加载历史记录
      loadPatchHistory()
    } else {
      // 用户登出后，可以选择清空历史或保留
      // patchHistory.value = []
    }
  })

onMounted(() => {
  // 初始加载（如果已经登录）
  if (isSignedIn.value) {
    loadPatchHistory()
  }
})

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function toggleRecord(id: string) {
  expandedRecordIds.value[id] = !expandedRecordIds.value[id]
}
function isExpanded(id: string) {
  return !!expandedRecordIds.value[id]
}


// 监听文本变化，尝试解析 JSON；失败时保留旧 Schema，并提示错误
watch(
  schemaText,
  (val) => {
    if (suppressSchemaTextWatch.value) return
    if (!val.trim()) return
    validateAndApplySchema(val)
  }
)
// 验证并应用 Schema（基于 fields 结构）
async function validateAndApplySchema(text: string) {
  try {
    const parsed = JSON.parse(text)

    // 基础结构校验
    if (!parsed.title || !Array.isArray(parsed.fields)) {
      throw new Error('Schema 必须包含 title 和 fields')
    }

    // 字段校验
    parsed.fields.forEach((field: any, index: number) => {
      if (!field.name) {
        throw new Error(`第 ${index + 1} 个字段缺少 name`)
      }
      if (!field.type) {
        throw new Error(`字段 ${field.name} 缺少 type`)
      }
    })

    // 如果当前已有 schema，并且内容确实发生了变化，则视为用户手动修改，版本 +1
    if (schema.value) {
      const oldStr = JSON.stringify(schema.value)
      const newStr = JSON.stringify(parsed)
      if (oldStr !== newStr) {
        parsed.meta = { ...(parsed.meta || {}), version: (schema.value?.meta?.version ?? 1) + 1 }
      } else {
        // 保持原有版本（或设置默认）
        parsed.meta = { ...(parsed.meta || {}), version: schema.value?.meta?.version ?? 1 }
      }
    } else {
      // 初始化新 schema 时，确保版本为 1（新初始化）
      parsed.meta = { ...(parsed.meta || {}), version: 1 }
    }
    schema.value = parsed
    // 同步版本信息回到 schemaText，使编辑器显示最新 version
    try {
      suppressSchemaTextWatch.value = true
      schemaText.value = JSON.stringify(parsed, null, 2)
      await nextTick()
    } finally {
      // 微任务后解除抑制，允许用户后续编辑触发解析
      suppressSchemaTextWatch.value = false
    }
    // 手动编辑 Schema 时，清理与字段选择/高亮相关的 UI 状态
    selectedFieldKey.value = null
    showFieldEditor.value = false
    backupField.value = null
    highlightMap.value = { added: [], updated: [] }
    parseError.value = ''
  } catch (err: any) {
    parseError.value = err.message
  }
}
// 基于当前schema进行修改
async function onClarifyChoosePatch() {
  const promptInput = promptInputRef.value
  if (!promptInput) return

  // PATCH 必须有 schema
  if (!schema.value) {
    message.warning(t('message.no_schema_patch'))
    clarifyVisible.value = false
    clarifyInfo.value = null
    return
  }

  const raw = promptInput.getUserPrompt().trim()
  if (!raw) return

  // 清理澄清状态
  clarifyVisible.value = false
  clarifyInfo.value = null

  // 关键：把“选择 PATCH”变成明确指令，避免模糊输入导致模型误走“全量重写”倾向
  const vague = isVagueOptimizeInput(raw)

// 关键：如果用户输入很泛化，不要把 raw 当成明确需求，而要改写成“保守优化”的指令
const patchInstruction = [
  '请基于当前表单 Schema 做增量修改（PATCH_UPDATE）。',
  '要求：只输出 patch operations；不要返回完整 schema；不要重新生成整份表单。',
  `当前表单用途（仅供你理解业务方向）：${schema.value?.title || ''} / ${schema.value?.description || ''}`,
  '输出格式要求：只能输出JSON格式，不要包含任何其他内容',
  '',
  vague
    ? [
        '用户输入较泛化（例如“优化一下”）。请只做“保守且可解释”的增量优化：',
        '1) 仅允许 update 操作（优先），除非当前 schema 明显缺少必要字段才允许 add',
        '2) 可以优化 title/description 的措辞，使其更清晰但不要改变业务方向',
        '3) 可以优化字段 label/required/default（如果明显不合理）',
        '4) 不要删除字段；不要重排 fields 顺序；不要新增与业务无关字段',
        `用户原话：${raw}`
      ].join('\n')
    : `用户修改需求：${raw}`
].join('\n')

  await generateSchema(patchInstruction, 'PATCH_UPDATE')
}
// 重新生成一份新的Schema
async function onClarifyChooseRegenerate() {
  const promptInput = promptInputRef.value
  if (!promptInput) return

  const raw = promptInput.getUserPrompt().trim()
  if (!raw) return

  clarifyVisible.value = false
  clarifyInfo.value = null

  // 基于当前 schema 重新生成一个更合理版本
  const regenerateInstruction = `
你是一个表单 Schema 生成器。
请基于【当前 Schema】重新生成一份“更合理、更清晰”的 Schema（相当于推倒重来但保留业务方向）。
要求：
1) 输出完整 Schema JSON
2) 不要把用户输入的短句当成标题（例如“优化一下”）
3) 生成的 title/description 要符合表单真实用途
4) 字段可以调整/补全/重命名，但保持与当前表单的业务方向一致

【当前 Schema】
${JSON.stringify(schema.value, null, 2)}

【用户补充说明（可能很模糊，仅供参考）】
${raw}
`.trim()

  await generateSchema(regenerateInstruction, 'REGENERATE')
}

// 澄清模式下，解释更多信息
function onClarifyExplainMore() {
  // 清理澄清状态
  clarifyVisible.value = false
  clarifyInfo.value = null

  // 聚焦输入框
  nextTick(() => {
    const inputElement = document.querySelector('.n-input__textarea-el') as HTMLTextAreaElement
    if (inputElement) {
      inputElement.focus()
      inputElement.select()
    }
  })
}

// 1.--------------------------------从 AI 生成用户意图，并根据意图生成 Schema--------------------------------
async function handleGenerate(userPrompt: string) {
  // 当存在未处理的 Patch 预览时，禁止再次触发 AI Patch
  if (isPatchModalOpen.value || pendingPatch.value) {
    message.warning(t('message.pending_patch'))
    return
  }
  // 重置状态为 idle（如果之前是 done 或 error）
  if (generatePhase.value === 'done' || generatePhase.value === 'error') {
    generatePhase.value = 'idle'
  }
  try {
    generatePhase.value = 'classifying'
    const token = await session.value?.getToken()
    const response = await fetch(`/api/v1/schema/classify-intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Locale': locale.value,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        user_input: userPrompt,
        has_schema: !!schema.value
      })
    })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}))
      throw new Error(errBody.error || response.statusText)
    }

    const resJson: any = await response.json()
    if (resJson.code !== 200 || !resJson.data) {
       const errMsg = resJson.message || 'Unknown error'
       console.error('分类失败', errMsg)
       parseError.value = errMsg
       generatePhase.value = 'error'
       message.error(errMsg)
       return
    }

    const classification = resJson.data

    // Intent Guard: 检查是否需要澄清意图
    const intentResult = { intent: classification.intent, confidence: classification.confidence || 0 }
    const guardResult = shouldClarify(intentResult)

    if (guardResult.needClarify) {
      // 进入澄清模式
      clarifyVisible.value = true
      clarifyInfo.value = {
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        reason: guardResult.reason
      }
      generatePhase.value = 'idle'
      return
    }

    await generateSchema(userPrompt, classification.intent)
    generatePhase.value = 'done'
  } catch (err: any) {
    console.error('API 请求失败', err)
    parseError.value = err.message
    message.error(`请求失败: ${err.message}`)
    generatePhase.value = 'error'
  }
}

// 2.--------------------------------根据用户意图生成 Schema（或对现有 Schema 做 PATCH）--------------------------------
const generateSchema = async (userPrompt: string, intent: string) => {
  try {
    let result: any
    let endpoint = ''
    let body: any = {}

    if (intent === 'PATCH_UPDATE') {
      if (!schema.value) {
        throw new Error(t('message.no_schema_patch'))
      }
      generatePhase.value = 'patching'
      endpoint = '/api/v1/schema/form/patch'
      body = {
        current_schema: schema.value,
        user_instruction: userPrompt
      }
    } else {
      generatePhase.value = 'generating'
      endpoint = '/api/v1/schema/form/generate'
      body = {
        user_requirement: userPrompt,
      }
    }
    
    const token = await session.value?.getToken()
    const response = await fetch(`${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Locale': locale.value,
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    })

    const resJson = await response.json().catch(() => ({}))

    if (!response.ok || resJson.code !== 200 || !resJson.data) {
      const errMsg = resJson.message || response.statusText || 'Unknown error'
      parseError.value = errMsg
      generatePhase.value = 'error'
      message.error(errMsg)
      return
    }

    result = resJson.data

    if (intent === 'PATCH_UPDATE') {
      // Validate patch using new validation layer
      const validation = validatePatch(schema.value, result)
      console.log('patch validation', validation)

      // Store validation result for modal consumption
      pendingPatch.value = {
        ...result,
        validation
      }

      isPatchModalOpen.value = true
      generatePhase.value = 'done'
    } else {
      // 新生成的 Schema （FULL_GENERATE / REGENERATE）视作全新初始化，version 从 1 开始
      const normalized = ensureSchemaVersion(result, true)
      schema.value = normalized
      schemaText.value = JSON.stringify(normalized, null, 2)
      // 重新生成 Schema 时，清理选中字段与高亮状态
      selectedFieldKey.value = null
      showFieldEditor.value = false
      backupField.value = null
      highlightMap.value = { added: [], updated: [] }
      message.success(t('message.apply_success', { summary: normalized.title }))
      generatePhase.value = 'done'
    }

    parseError.value = ''
  } catch (err: any) {
    console.error('生成 Schema 失败', err)
    parseError.value = err.message
    throw err
  }
}

function confirmPatch() {
  if (!pendingPatch.value || !schema.value) return

  const patch = pendingPatch.value
  const validation = patch.validation

  if (!validation) {
    message.error('验证信息缺失，无法应用')
    return
  }

  try {
    generatePhase.value = 'applying'
    const beforeSchema = deepClone(schema.value) // 保存应用前的快照

    // If no valid operations, show warning and don't apply
    if (!validation.ok) {
      message.warning('没有可应用的修改')
      pendingPatch.value = null
      isPatchModalOpen.value = false
      generatePhase.value = 'idle'
      return
    }

    // Apply valid operations using applyPatchSafe
    const patchForApply = {
      baseVersion: validation.baseVersion,
      operations: validation.validOps
    }

    const nextSchema = applyPatchSafe(schema.value, patchForApply)

    // Compute which fields were applied for highlight
    const appliedFieldNames: string[] = []
    for (const op of validation.validOps) {
      if (op.target === 'field') {
        if (op.op === 'add' && op.value?.name) appliedFieldNames.push(op.value.name)
        if (op.op === 'update' && op.name) appliedFieldNames.push(op.name)
        // remove operations don't get highlighted
      }
    }

    // Update schema state
    schema.value = nextSchema
    schemaText.value = JSON.stringify(nextSchema, null, 2)
    highlightMap.value = { added: appliedFieldNames, updated: appliedFieldNames }

    // Build impact & summary, then write history
    const impact = buildImpactFromOps(validation.validOps || patch.operations || [])
    const counts = {
      added: impact.added.length,
      updated: impact.updated.length,
      removed: impact.removed.length,
      validOps: validation.stats?.valid ?? (validation.validOps?.length ?? 0),
      skippedOps: validation.stats?.invalid ?? 0
    }
    const summary = buildStandardSummary(impact, beforeSchema, nextSchema)

    addPatchHistory({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      summary,
      patch: deepClone(patch),
      beforeSchema,
      afterSchema: deepClone(nextSchema),
      source: 'AI',
      baseVersion: validation.baseVersion ?? patch.baseVersion ?? beforeSchema?.meta?.version ?? 0,
      toVersion: nextSchema?.meta?.version ?? 0,
      impact,
      counts
    })

    // Toast / message
    const skippedNote = (validation.stats?.invalid ?? 0) > 0 ? t('message.skipped', { count: validation.stats.invalid }) : ''
    message.success(t('message.apply_success', { summary }) + skippedNote, { duration: 4000 })

    // cleanup
    setTimeout(() => {
      highlightMap.value = { added: [], updated: [] }
    }, 4000)

    pendingPatch.value = null
    isPatchModalOpen.value = false
    selectedFieldKey.value = null
    showFieldEditor.value = false
    backupField.value = null
    parseError.value = ''
    generatePhase.value = 'done'
  } catch (err: any) {
    console.error('应用 Patch 失败', err)
    if (err && (err.code === 'SCHEMA_VERSION_MISMATCH' || err.message === 'SCHEMA_VERSION_MISMATCH')) {
      const current = schema.value?.meta?.version ?? 1
      const base = pendingPatch.value?.baseVersion ?? err.baseVersion ?? 1
      versionMismatchInfo.value = { current, base }
      showVersionMismatchDialog.value = true
      pendingPatch.value = null
      isPatchModalOpen.value = false
      generatePhase.value = 'idle'
      return
    }
    parseError.value = err.message
    generatePhase.value = 'error'
  }
}

function cancelPatch() {
  // 取消预览时，只清理 Patch 预览相关状态，不影响 schema
  pendingPatch.value = null
  isPatchModalOpen.value = false
  generatePhase.value = 'idle'
}
// 复制当前 schema
async function copySchema() {
  if (!schema.value) {
    message.warning(t('common.warning'))
    return
  }
  const text = JSON.stringify(schema.value, null, 2)
  try {
    await navigator.clipboard.writeText(text)
    message.success(t('message.copy_success'))
  } catch (err) {
    console.error('复制失败', err)
    message.error(t('message.copy_fail'))
  }
}

// 导出当前 schema 为 json 文件
function exportSchema() {
  if (!schema.value) return
  const text = JSON.stringify(schema.value, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${schema.value?.title || 'schema'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 清空 Schema
function clearSchema() {
  if (!schema.value) {
    message.warning(t('common.warning'))
    return
  }
  dialog.warning({
    title: t('common.clear'),
    content: t('message.clear_confirm'),
    positiveText: t('common.clear'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      schema.value = null
      schemaText.value = ''
      parseError.value = ''
      selectedFieldKey.value = null
      showFieldEditor.value = false
      backupField.value = null
      highlightMap.value = { added: [], updated: [] }
      message.success(t('message.clear_success'))
    }
  })
}

function openFieldEditor(key: string) {
  selectedFieldKey.value = key
  const field = schema.value?.fields?.find((f: any) => f.name === key)
  backupField.value = field ? deepClone(field) : null
  showFieldEditor.value = true
}

// Schema 操作菜单选项
const schemaMenuOptions = computed(() => [
  { label: t('common.import'), key: 'import' },
  { label: t('common.copy'), key: 'copy' },
  { label: t('common.export'), key: 'export' },
  { label: t('common.clear'), key: 'clear' },
  { type: 'divider' },
  { label: t('common.history'), key: 'history' }
])

// 处理 Schema 菜单选择
function handleSchemaMenuSelect(key: string) {
  switch (key) {
    case 'import':
      triggerFileImport()
      break
    case 'copy':
      copySchema()
      break
    case 'export':
      exportSchema()
      break
    case 'clear':
      clearSchema()
      break
    case 'history':
      showHistoryDrawer.value = true
      break
  }
}

function handleUpdateSchema(next: any) {
  schema.value = next
  // 如果正在编辑字段，不更新 schemaText，避免触发 watch 导致 Drawer 关闭
  if (!showFieldEditor.value) {
    schemaText.value = JSON.stringify(next, null, 2)
  }
}

function onConfirm(changed?: boolean) {
  // 确认完成后，同步 schemaText
  if (schema.value) {
    let shouldIncrement = false
    let modifiedFieldName = ''

    if (typeof changed === 'boolean') {
      shouldIncrement = changed
      modifiedFieldName = selectedFieldKey.value || ''
    } else {
      // 兼容老的调用方式：通过比较 backupField 与当前字段判断
      if (selectedFieldKey.value && backupField.value) {
        const fieldIndex = schema.value.fields.findIndex((f: any) => f.name === selectedFieldKey.value)
        const currentField = fieldIndex !== -1 ? schema.value.fields[fieldIndex] : null
        const beforeStr = JSON.stringify(backupField.value)
        const afterStr = JSON.stringify(currentField)
        shouldIncrement = beforeStr !== afterStr
        modifiedFieldName = selectedFieldKey.value
      } else {
        shouldIncrement = false
      }
    }

    if (shouldIncrement) {
      const currentVer = schema.value?.meta?.version ?? 1
      const newVersion = currentVer + 1

      // 保存修改前的 schema（用于历史记录），确保是完整快照
      const beforeSchema = deepClone(schema.value)

      // 应用版本更新
      schema.value = { ...schema.value, meta: { ...(schema.value.meta || {}), version: newVersion } }

      // 构建修改后的 schema（用于历史记录），确保是完整快照
      const afterSchema = deepClone(schema.value)

      // 构建 impact 和统计信息
      const impact = { added: [], updated: [modifiedFieldName], removed: [] }
      const counts = {
        added: 0,
        updated: 1,
        removed: 0,
        validOps: 1,
        skippedOps: 0
      }

      // 生成摘要
      const summary = buildStandardSummary(impact, beforeSchema, afterSchema)

      // 添加到历史记录
      addPatchHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        summary,
        patch: {
          baseVersion: currentVer,
          operations: [
            {
              op: 'update',
              target: 'field',
              name: modifiedFieldName,
              value: afterSchema.fields.find((f: any) => f.name === modifiedFieldName)
            }
          ]
        },
        beforeSchema,
        afterSchema,
        source: 'MANUAL',
        baseVersion: currentVer,
        toVersion: newVersion,
        impact,
        counts
      })
    }
    // 同步编辑器内容（无论是否变更都保持最新 JSON）
    schemaText.value = JSON.stringify(schema.value, null, 2)
  }
  showFieldEditor.value = false
  backupField.value = null
}

function onCancel() {
  if (selectedFieldKey.value && backupField.value && schema.value?.fields) {
    const fieldIndex = schema.value.fields.findIndex((f: any) => f.name === selectedFieldKey.value)
    if (fieldIndex !== -1) {
      const nextFields = [...schema.value.fields]
      nextFields[fieldIndex] = deepClone(backupField.value)
      schema.value = { ...schema.value, fields: nextFields }
      schemaText.value = JSON.stringify(schema.value, null, 2)
    }
  }
  showFieldEditor.value = false
  backupField.value = null
}

function onReset() {
  if (selectedFieldKey.value && backupField.value && schema.value?.fields) {
    const fieldIndex = schema.value.fields.findIndex((f: any) => f.name === selectedFieldKey.value)
    if (fieldIndex !== -1) {
      const nextFields = [...schema.value.fields]
      nextFields[fieldIndex] = deepClone(backupField.value)
      schema.value = { ...schema.value, fields: nextFields }
      schemaText.value = JSON.stringify(schema.value, null, 2)
    }
  }
}

function triggerFileImport() {
  fileInputRef.value?.click()
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const text = e.target?.result as string
    if (text) {
      schemaText.value = text
    }
  }
  reader.onerror = () => {
    parseError.value = '文件读取失败'
  }
  reader.readAsText(file)

  // 重置 input，允许重复选择同一文件
  target.value = ''
}
</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides" :theme="isDark ? darkTheme : null">
    <!-- <router-view v-slot="{ Component }">
      <component :is="Component" v-if="router.currentRoute.value.path === '/login'" />
      <main v-else class="layout" :class="{ 'is-dark': isDark }"> -->
      <main class="layout" :class="{ 'is-dark': isDark }">
        <PromptInput ref="promptInputRef" :on-generate="handleGenerate" :has-schema="!!schema" :phase="generatePhase"
          @generate="handleGenerate" />

        <!-- Intent 澄清模式 UI -->
        <div v-if="clarifyVisible && clarifyInfo" class="clarify-section">
          <!-- ... clarifying content ... -->
          <div class="clarify-card">
            <div class="clarify-header">
              <div class="clarify-icon">
                <span class="clarify-sparkle">💭</span>
              </div>
              <div class="clarify-title">
                <h4>{{ t('clarify.title') }}</h4>
                <p class="clarify-subtitle">{{ t('clarify.subtitle') }}</p>
              </div>
            </div>

            <div class="clarify-content">
              <div class="clarify-info">
                <div class="info-item">
                  <span class="info-label">{{ t('clarify.current_intent') }}</span>
                  <span class="info-value intent">{{ clarifyInfo.intent }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">{{ t('clarify.confidence') }}</span>
                  <span class="info-value confidence">{{ (clarifyInfo.confidence * 100).toFixed(1) }}%</span>
                </div>
                <div class="info-reason">
                  {{ clarifyInfo.reason === 'intent_unknown' ? t('patch.reason.invalid_op_shape') : 
                     clarifyInfo.reason.startsWith('low_confidence') ? 
                     t('clarify.subtitle') + ' (' + clarifyInfo.reason.split(':')[2] + ')' : 
                     clarifyInfo.reason }}
                </div>
              </div>

              <div class="clarify-options">
                <p class="options-title">{{ t('clarify.options_title') }}</p>
                <div class="clarify-buttons">
                  <NButton type="primary" @click="onClarifyChoosePatch" class="option-btn">
                    <template #icon>
                      <span class="btn-icon">✏️</span>
                    </template>
                    {{ t('clarify.patch') }}
                  </NButton>
                  <NButton type="info" @click="onClarifyChooseRegenerate" class="option-btn">
                    <template #icon>
                      <span class="btn-icon">🔄</span>
                    </template>
                    {{ t('clarify.regenerate') }}
                  </NButton>
                  <NButton ghost @click="onClarifyExplainMore" class="option-btn">
                    <template #icon>
                      <span class="btn-icon">💬</span>
                    </template>
                    {{ t('clarify.explain') }}
                  </NButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Patch 历史记录（仅显示最近一条） -->
        <div v-if="patchHistory.length > 0" class="history-hint" @click="showHistoryDrawer = true">
          <span class="history-text">{{ t('history.latest') }}{{ patchHistory[0].summary }}</span>
        </div>

        <section class="grid">
          <div class="panel editor-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">{{ t('editor.json_title') }}</p>
                <h2>{{ t('editor.json_subtitle') }}</h2>
              </div>
              <div class="actions">
                <NDropdown :options="schemaMenuOptions" trigger="click" @select="handleSchemaMenuSelect">
                  <NButton size="tiny" quaternary type="primary" class="schema-action-btn">
                    {{ t('common.history') }}
                    <span style="margin-left: 4px; font-size: 10px;">▼</span>
                  </NButton>
                </NDropdown>
                <input ref="fileInputRef" type="file" accept=".json" style="display: none" @change="handleFileSelect" />
              </div>
            </div>
            <div class="editor-container">
              <Codemirror
                v-model="schemaText"
                :placeholder="t('editor.placeholder')"
                :style="{ height: '100%' }"
                :autofocus="true"
                :indent-with-tab="true"
                :tab-size="2"
                :extensions="editorExtensions"
              />
            </div>
            <NAlert v-if="parseError" type="error" class="alert">
              {{ t('editor.parse_error') }}{{ parseError }}
            </NAlert>
          </div>

          <div class="panel form-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">{{ t('editor.preview_title') }}</p>
                <h2 class="text-overflow-ellipsis">{{ schema?.title || t('common.title') }}</h2>
              </div>
              <span class="hint">{{ t('editor.preview_subtitle') }}</span>
            </div>
            <div class="form-body">
              <FormRenderer v-if="schema" :schema="schema" :selected-field-key="selectedFieldKey"
                :highlight-map="highlightMap" @select-field="openFieldEditor" />
              <p v-else class="placeholder">{{ t('editor.placeholder') }}</p>
            </div>
          </div>
        </section>

        <FieldEditor v-if="schema && selectedFieldKey" :show="showFieldEditor" :schema="schema"
          :field-key="selectedFieldKey" :backup-field="backupField" @update:show="(val) => (showFieldEditor = val)"
          @update-schema="handleUpdateSchema" @confirm="onConfirm" @cancel="onCancel" @reset="onReset" />
        <!-- Patch 操作决策预览 Modal -->
        <PatchPreviewModal :show="isPatchModalOpen" :patch="pendingPatch" :schema="schema" :validation="pendingPatch?.validation"
          @update:show="(val) => (isPatchModalOpen = val)" @confirm="confirmPatch" @cancel="cancelPatch" />

        <!-- 版本冲突对话框（组件化，便于样式定制，与 PatchPreviewModal 保持一致的组件模式） -->
        <VersionMismatchDialog :show="showVersionMismatchDialog" :info="versionMismatchInfo"
          @update:show="(val) => (showVersionMismatchDialog = val)" />

        <!-- Patch History Drawer -->
        <NDrawer :show="showHistoryDrawer" :width="400" placement="right"
          @update:show="(val) => (showHistoryDrawer = val)">
          <NDrawerContent :title="t('history.title')">
            <NSpin :show="isLoadingHistory">
              <div class="history-drawer-content">
                <div v-for="(record, index) in patchHistory" :key="record.id" class="history-item"
                  :class="{ 'history-item--latest': index === 0 }">
                  <div class="history-item-header">
                    <span class="history-item-summary">{{ record.summary }}</span>
                    <span class="history-item-time">{{ formatTime(record.timestamp) }}</span>
                  </div>
                  <div class="history-item-meta">
                    <div class="meta-tags">
                      <NTag size="small" type="info" style="margin-right:6px">{{ record.source || 'AI' }}</NTag>
                      <NTag size="small" type="default" style="margin-right:6px">v{{ record.baseVersion ?? 0 }} → v{{ record.toVersion ?? 0 }}</NTag>
                      <NTag size="small" type="success" style="margin-right:6px">{{ t('patch.status.add', { name: record.counts?.added ?? record.impact?.added?.length ?? 0 }) }}</NTag>
                      <NTag size="small" type="warning" style="margin-right:6px">{{ t('patch.status.update', { name: record.counts?.updated ?? record.impact?.updated?.length ?? 0, props: '' }) }}</NTag>
                      <NTag size="small" type="error">{{ t('patch.status.remove', { name: record.counts?.removed ?? record.impact?.removed?.length ?? 0 }) }}</NTag>
                    </div>
                    <div class="meta-actions" style="margin-top:8px; display:flex; gap:8px; align-items:center;">
                      <NButton size="tiny" tertiary @click="toggleRecord(record.id)">{{ isExpanded(record.id) ? t('common.cancel') : t('common.example') }}</NButton>
                      <NButton size="tiny" quaternary :type="showDiffId === record.id ? 'primary' : 'default'" @click="showDiffId = showDiffId === record.id ? null : record.id">
                        {{ showDiffId === record.id ? t('common.cancel') : 'Diff' }}
                      </NButton>
                      <NButton size="small" quaternary type="primary" class="history-item-rollback" @click="rollbackTo(record)">
                        <div style="color: #fff;">{{ t('history.rollback') }}</div>
                      </NButton>
                    </div>
                  </div>

                  <!-- Visual Diff 视图 -->
                  <div v-if="showDiffId === record.id" class="history-diff-viewer">
                    <Diff 
                      mode="unified" 
                      :old-content="JSON.stringify(record.beforeSchema || {}, null, 2)" 
                      :new-content="JSON.stringify(record.afterSchema || {}, null, 2)" 
                      language="json"
                      :theme="isDark ? 'dark' : 'light'"
                    />
                  </div>

                  <div v-show="isExpanded(record.id)" class="history-item-details" style="margin-top:8px; font-size:13px; color:#475569;">
                    <div v-if="record.impact?.added && record.impact.added.length > 0" class="diff-line">
                      <strong>{{ t('common.success') }}：</strong> {{ record.impact.added.join('、') }}
                    </div>
                    <div v-if="record.impact?.updated && record.impact.updated.length > 0" class="diff-line">
                      <strong>{{ t('common.warning') }}：</strong> {{ record.impact.updated.join('、') }}
                    </div>
                    <div v-if="record.impact?.removed && record.impact.removed.length > 0" class="diff-line">
                      <strong>{{ t('common.error') }}：</strong> {{ record.impact.removed.join('、') }}
                    </div>
                    <div class="diff-line" v-if="record.counts?.skippedOps">
                      <strong>{{ t('message.skipped', { count: '' }) }}：</strong> {{ record.counts.skippedOps }}
                    </div>
                  </div>
                </div>
                <div v-if="patchHistory.length === 0" class="history-empty">
                  {{ t('history.empty') }}
                </div>
              </div>
            </NSpin>
          </NDrawerContent>
        </NDrawer>
      <!-- </main>
    </router-view> -->
      </main>
  </NConfigProvider>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  position: relative;
}

/* App Header Styles Removed - Merged into PromptInput */

.panel {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, rgba(99, 102, 241, 0.08));
  border-radius: 16px;
  padding: 20px 20px 18px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
  transition: background-color 0.3s, border-color 0.3s;
}


.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
  min-width: 0;
  overflow: hidden;
}

.panel-header>div:first-child {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  max-width: 100%;
}

.panel-header>div:first-child h2 {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.schema-action-btn {
  border-radius: 8px;
  padding: 0 12px;
  border: 1px solid rgba(99, 102, 241, 0.12);
  background: rgba(99, 102, 241, 0.04);
  color: #6366f1;
  transition: all 0.15s;
}

.schema-action-btn:hover {
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.18);
}

.schema-action-btn:deep(.n-button__content) {
  font-size: 12px;
}

.eyebrow {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.4px;
  color: #6366f1;
  font-weight: 700;
}

h2 {
  margin: 4px 0 0;
  font-size: 18px;
  color: var(--text-color, #0f172a);
}

.is-dark h2 {
  color: #f1f5f9;
}

.hint {
  font-size: 13px;
  color: #64748b;
}

.editor-panel {
  height: 70vh;
  background: var(--card-bg, #fafbfc);
}

.is-dark .editor-panel {
  background: #1e293b;
}

.form-panel {
  height: 70vh;
  background: var(--card-bg, #ffffff);
}

.grid {
  display: grid;
  grid-template-columns: 11fr 9fr;
  gap: 20px;
  height: 100%;
  position: relative;
}

.form-body {
  flex: 1;
  min-height: 300px;
  padding: 16px;
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.5);
  border: 1px solid var(--border-color, rgba(99, 102, 241, 0.05));
  overflow: auto;
}

.is-dark .form-body {
  background: rgba(15, 23, 42, 0.5);
}

.editor-container {
  flex: 1;
  min-height: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

/* CodeMirror 深度样式覆盖 */
:deep(.vue-codemirror) {
  height: 100%;
}

:deep(.cm-editor) {
  height: 100% !important;
  font-family: 'SF Mono', ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 13px;
}

:deep(.cm-scroller) {
  overflow: auto;
}

.alert {
  margin-top: 4px;
}

.placeholder {
  margin: 0;
  color: #94a3b8;
}

.empty-state-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background: rgba(238, 242, 255, 0.6);
  backdrop-filter: blur(4px);
  border-radius: 16px;
}

.is-dark .empty-state-container {
  background: rgba(15, 23, 42, 0.7);
}

.quick-start-card {
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, rgba(99, 102, 241, 0.15));
  border-radius: 24px;
  padding: 32px;
  width: 100%;
  max-width: 640px;
  box-shadow: 0 20px 50px rgba(99, 102, 241, 0.1);
  animation: slideUp 0.4s ease-out;
}

.qs-header h3 {
  font-size: 20px;
  margin: 0 0 8px;
  color: var(--text-color, #1e293b);
}

.qs-item {
  padding: 20px;
  border: 1px solid var(--border-color, rgba(99, 102, 241, 0.1));
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  background: var(--bg-color, #f8fafc);
}

.is-dark .qs-item {
  background: #1e293b;
}

.qs-item:hover {
  background: var(--card-bg, #ffffff);
  border-color: #6366f1;
  transform: translateY(-4px);
  box-shadow: 0 10px 20px rgba(99, 102, 241, 0.08);
}

.qs-text h4 {
  margin: 0 0 4px;
  font-size: 15px;
  color: var(--text-color, #0f172a);
}

/* Patch 历史记录样式（弱化显示） */
.history-hint {
  font-size: 11px;
  color: #cbd5e1;
  line-height: 1.4;
  cursor: pointer;
  transition: color 0.15s;
  user-select: none;
  padding: 4px 0;
}

.history-hint:hover {
  color: #94a3b8;
}

.history-text {
  display: inline-block;
}

/* Patch History Drawer 样式 */
.history-drawer-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.history-item {
  padding: 12px;
  border: 1px solid var(--border-color, rgba(99, 102, 241, 0.1));
  border-radius: 8px;
  background: var(--bg-color, #fafbff);
  transition: all 0.15s;
}

.is-dark .history-item {
  background: #1e293b;
}

.history-item--latest {
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.2);
}

.is-dark .history-item--latest {
  background: rgba(99, 102, 241, 0.1);
}

.history-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.history-item-summary {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color, #0f172a);
}

.history-item-time {
  font-size: 12px;
  color: #94a3b8;
}

.history-item-diff {
  margin-bottom: 8px;
  font-size: 12px;
  color: #64748b;
}

.diff-line {
  margin-bottom: 4px;
}

.diff-label {
  color: #94a3b8;
}

.diff-value {
  color: #64748b;
}

.history-item-rollback {
  flex: 1;
  color: #fff;

}

.history-empty {
  text-align: center;
  padding: 40px 0;
  color: #94a3b8;
  font-size: 14px;
}

/* Clarify Mode Styles */
.clarify-section {
  margin: 16px 0;
  padding: 0 20px;
}

.clarify-card {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(139, 92, 246, 0.01) 100%);
  border: 1px solid rgba(99, 102, 241, 0.12);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.06);
  overflow: hidden;
  backdrop-filter: blur(12px);
}

.clarify-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.06) 0%, rgba(139, 92, 246, 0.03) 100%);
  border-bottom: 1px solid rgba(99, 102, 241, 0.08);
}

.clarify-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.clarify-sparkle {
  font-size: 16px;
  color: #fff;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.clarify-title h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color, #0f172a);
}

.clarify-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #64748b;
}

.clarify-content {
  padding: 16px 20px;
}

.clarify-info {
  margin-bottom: 20px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.info-label {
  font-size: 14px;
  color: #64748b;
  font-weight: 500;
  min-width: 70px;
}

.info-value {
  font-size: 14px;
  font-weight: 600;
}

.info-value.intent {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  padding: 2px 8px;
  border-radius: 6px;
}

.info-value.confidence {
  color: #059669;
  background: rgba(16, 185, 129, 0.1);
  padding: 2px 8px;
  border-radius: 6px;
}

.info-reason {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.4;
  padding: 8px 12px;
  background: rgba(107, 114, 128, 0.05);
  border-radius: 8px;
  border-left: 3px solid #6b7280;
}

.options-title {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 12px;
}

.clarify-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.option-btn {
  flex: 1;
  min-width: 140px;
  justify-content: flex-start;
  font-weight: 500;
  transition: all 0.2s ease;
  border-radius: 8px;
}

.option-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .clarify-section {
    padding: 0 16px;
  }

  .clarify-header {
    padding: 12px 16px;
    gap: 10px;
  }

  .clarify-icon {
    width: 32px;
    height: 32px;
  }

  .clarify-title h4 {
    font-size: 15px;
  }

  .clarify-subtitle {
    font-size: 12px;
  }

  .clarify-content {
    padding: 12px 16px;
  }

  .clarify-buttons {
    flex-direction: column;
    gap: 8px;
  }

  .option-btn {
    width: 100%;
    min-width: unset;
  }
}

.btn-icon {
  font-size: 14px;
  margin-right: 4px;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

/* 文本溢出省略 */
.text-overflow-ellipsis {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.rollback-btn {
  border-radius: 999px;
  padding: 0 10px;
  border: 1px solid rgba(99, 102, 241, 0.35);
  background: radial-gradient(circle at 0 0, rgba(129, 140, 248, 0.18), transparent 55%);
  color: #4f46e5;
}
</style>
