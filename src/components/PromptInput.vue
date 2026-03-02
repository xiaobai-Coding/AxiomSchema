<script setup lang="ts">
// @ts-nocheck
import { ref, computed } from 'vue'
import { NCard, NInput, NButton, NSpace, NTag, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useDark, useToggle } from '@vueuse/core'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/vue'

const { t, locale } = useI18n()

const isDark = useDark()
const toggleDark = useToggle(isDark)

function changeLocale(lang: 'zh' | 'en') {
  locale.value = lang
  localStorage.setItem('locale', lang)
}

type GeneratePhase = 'idle' | 'classifying' | 'generating' | 'patching' | 'applying' | 'done' | 'error'

const props = defineProps<{
  onGenerate?: (prompt: string) => Promise<any> | void
  hasSchema?: boolean // 是否有已存在的 schema
  phase?: GeneratePhase // 当前生成阶段
}>()
const emit = defineEmits(['generate'])

const userPrompt = ref<string>('')

// 示例 prompt
const examplePrompts = computed(() => [
  t('prompt.placeholder').split('\n\n')[1]?.split('\n')[1]?.replace('• ', '') || '',
  t('prompt.placeholder').split('\n\n')[1]?.split('\n')[2]?.replace('• ', '') || ''
])

// 状态提示文案
const statusText = computed(() => {
  const phase = props.phase || 'idle'
  const statusMap: Record<GeneratePhase, string> = {
    idle: t('prompt.status.idle'),
    classifying: t('prompt.status.classifying'),
    generating: t('prompt.status.generating'),
    patching: t('prompt.status.patching'),
    applying: t('prompt.status.applying'),
    done: t('prompt.status.done'),
    error: t('prompt.status.error')
  }
  return statusMap[phase]
})

// 按钮文案根据 phase 动态变化
const buttonText = computed(() => {
  const phase = props.phase || 'idle'
  const textMap: Record<GeneratePhase, string> = {
    idle: t('prompt.generate'),
    classifying: t('common.loading'),
    generating: t('common.loading'),
    patching: t('common.loading'),
    applying: t('common.loading'),
    done: t('prompt.continue'),
    error: t('prompt.retry')
  }
  return textMap[phase]
})

// 按钮是否禁用
const isButtonDisabled = computed(() => {
  const phase = props.phase || 'idle'
  if (phase === 'idle' || phase === 'done' || phase === 'error') {
    return !userPrompt.value.trim()
  }
  return true
})

const handleGenerate = async () => {
  if (!userPrompt.value.trim() || isButtonDisabled.value) return
  try {
    if (props.onGenerate) {
      await props.onGenerate(userPrompt.value.trim())
    } else {
      emit('generate', userPrompt.value.trim())
    }
  } catch (e) {
    // swallow to allow UI reset
  }
}

// 处理键盘事件：Enter 提交，Shift+Enter 换行
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    if (userPrompt.value.trim() && !isButtonDisabled.value) {
      handleGenerate()
    }
  }
}

// 清空输入框
const handleClear = () => {
  userPrompt.value = ''
}

// 填充示例（不触发生成）
const handleFillExample = () => {
  const randomIndex = Math.floor(Math.random() * examplePrompts.value.length)
  userPrompt.value = examplePrompts.value[randomIndex]
}

// 智能建议指令
const magicCommands = computed(() => [
  { icon: '✨', label: locale.value === 'zh' ? '优化文案' : 'Optimize labels', cmd: locale.value === 'zh' ? '优化表单的标题和字段文案，使其更专业' : 'Optimize all labels and titles to be more professional' },
  { icon: '🛡️', label: locale.value === 'zh' ? '设为必填' : 'Make Required', cmd: locale.value === 'zh' ? '将所有关键字段设为必填' : 'Make all critical fields required' },
  { icon: '📱', label: locale.value === 'zh' ? '增加手机号' : 'Add Phone', cmd: locale.value === 'zh' ? '增加一个手机号字段，带格式校验' : 'Add a phone field with validation' },
  { icon: '🎨', label: locale.value === 'zh' ? '美化标题' : 'Prettify Title', cmd: locale.value === 'zh' ? '给表单起一个更有吸引力的标题和描述' : 'Give this form a more attractive title and description' }
])

const applyMagicCommand = (cmd: string) => {
  if (userPrompt.value.trim()) {
    userPrompt.value += ` (${cmd})`
  } else {
    userPrompt.value = cmd
  }
}

// 计算 placeholder 文本
const inputPlaceholder = computed(() => {
  return t('prompt.placeholder')
})

defineExpose({
  getUserPrompt: () => userPrompt.value
})
</script>

<template>
  <NCard class="prompt-card" :bordered="true">
    <div class="prompt-header">
      <div class="header-left">
        <img src="/axiomschema.svg" class="logo" alt="Logo" />
        <div class="brand">
          <div class="brand-top">
            <h1 class="prompt-title">AxiomSchema</h1>
            <span class="version-tag">v2.0</span>
          </div>
          <p class="prompt-subtitle">{{ t('common.subtitle') }}</p>
        </div>
      </div>
      
      <div class="header-right">
        <!-- Auth Buttons -->
        <SignedOut>
          <SignInButton mode="modal" v-slot="{ handler }">
             <NButton 
               quaternary 
               size="small" 
               type="primary" 
               class="sign-in-btn cl-signInButton" 
               @click="handler"
             >
              <template #icon>
                <span class="icon">🔑</span>
              </template>
              <span class="sign-in-text">{{ locale === 'zh' ? '登录' : 'Sign In' }}</span>
            </NButton>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton afterSignOutUrl="/"/>
        </SignedIn>

        <!-- 主题切换 -->
        <NTooltip trigger="hover">
          <template #trigger>
            <NButton 
              quaternary 
              circle 
              size="small" 
              @click="toggleDark()"
              class="theme-toggle"
            >
              <template #icon>
                <span v-if="isDark">🌙</span>
                <span v-else>☀️</span>
              </template>
            </NButton>
          </template>
          {{ isDark ? t('common.dark') || 'Dark' : t('common.light') || 'Light' }}
        </NTooltip>

        <!-- 语言切换 -->
        <div class="segmented-control">
          <button :class="{ active: locale === 'zh' }" @click="changeLocale('zh')">中</button>
          <button :class="{ active: locale === 'en' }" @click="changeLocale('en')">EN</button>
        </div>
      </div>
    </div>
    
    <div class="prompt-input-section">
      <NInput
        :value="userPrompt"
        type="textarea"
        :placeholder="inputPlaceholder"
        :rows="3"
        class="prompt-textarea"
        @update:value="(val) => userPrompt = val"
        @keydown="handleKeydown"
      />
      <!-- 智能建议标签 -->
      <div class="magic-commands" v-if="props.hasSchema">
        <span class="magic-label">🪄 {{ locale === 'zh' ? '魔法指令：' : 'Magic:' }}</span>
        <div class="magic-tags">
          <NTag 
            v-for="m in magicCommands" 
            :key="m.label" 
            size="small" 
            round 
            checkable 
            @click="applyMagicCommand(m.cmd)"
            class="magic-tag"
          >
            <template #icon>{{ m.icon }}</template>
            {{ m.label }}
          </NTag>
        </div>
      </div>
    </div>

    <div class="prompt-status">
      <span class="status-text">{{ statusText }}</span>
    </div>

    <div class="prompt-actions">
      <NSpace :wrap="true" :size="[12, 12]">
        <NButton
          type="primary"
          :disabled="isButtonDisabled"
          @click="handleGenerate"
        >
          {{ buttonText }}
        </NButton>
        <NButton
          quaternary
          :disabled="props.phase === 'classifying' || props.phase === 'generating' || props.phase === 'patching' || props.phase === 'applying'"
          @click="handleClear"
        >
          {{ t('common.clear') }}
        </NButton>
        <NButton
          quaternary
          :disabled="props.phase === 'classifying' || props.phase === 'generating' || props.phase === 'patching' || props.phase === 'applying'"
          @click="handleFillExample"
        >
          {{ t('common.example') }}
        </NButton>
      </NSpace>
    </div>
  </NCard>
</template>

<style scoped>
.prompt-card {
  padding: 24px;
  background: var(--card-bg, #ffffff);
  border: 1px solid var(--border-color, rgba(99, 102, 241, 0.06));
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
  transition: background-color 0.3s, border-color 0.3s;
}

html:not(.dark) .prompt-card {
  background: linear-gradient(135deg, #fafbfc 0%, #ffffff 50%, #fafbfc 100%);
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 28px;
  height: 28px;
  transition: transform 0.3s ease;
}

.header-left:hover .logo {
  transform: rotate(15deg) scale(1.1);
}

.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.prompt-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.version-tag {
  font-size: 9px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 700;
}

.prompt-subtitle {
  margin: 0;
  font-size: 11px;
  color: #64748b;
  line-height: 1.2;
}

html.dark .prompt-subtitle {
  color: #94a3b8;
}

.segmented-control {
  display: flex;
  background: #f1f5f9;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

html.dark .segmented-control {
  background: #334155;
  border-color: rgba(255, 255, 255, 0.1);
}

.segmented-control button {
  border: none;
  background: transparent;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  white-space: nowrap;
  min-width: 32px;
}

html.dark .segmented-control button {
  color: #94a3b8;
}

.segmented-control button.active {
  background: #ffffff;
  color: #6366f1;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

html.dark .segmented-control button.active {
  background: #1e293b;
  color: #818cf8;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.theme-toggle {
  flex-shrink: 0;
  transition: transform 0.2s;
}

.theme-toggle:hover {
  transform: rotate(15deg);
}

.sign-in-btn {
  font-weight: 600;
  border-radius: 8px;
  transition: all 0.2s;
  color: #4f46e5; /* 默认使用品牌色，确保清晰可见 */
}

.sign-in-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  color: #4f46e5; /* hover 时加深颜色 */
}

.icon {
  font-size: 14px;
}

.sign-in-text {
  font-weight: 600;
  color: #fff;
}
.sign-in-text:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 36px rgba(99, 102, 241, 0.25);
}
/* 移动端适配 */
@media (max-width: 600px) {
  .prompt-header {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .header-right {
    gap: 8px;
  }

  .segmented-control {
    padding: 2px;
  }

  .segmented-control button {
    padding: 4px 8px;
    font-size: 11px;
    height: 28px;
  }

  .brand-top .prompt-title {
    font-size: 15px;
  }
}

.prompt-input-section {
  margin-bottom: 12px;
}

.magic-commands {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.magic-label {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

.magic-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.magic-tag {
  cursor: pointer;
  font-size: 11px;
}

.prompt-status {
  margin-bottom: 12px;
}

.status-text {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
}

.prompt-textarea :deep(.n-input__textarea-el) {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-color, #0f172a);
  min-height: 120px;
  background: var(--card-bg, #ffffff);
  transition: border-color 0.15s, background-color 0.3s, color 0.3s;
}

html.dark .prompt-textarea :deep(.n-input__textarea-el) {
  background: #0f172a;
  color: #f1f5f9;
}

.prompt-textarea :deep(.n-input__textarea-el):focus {
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.06);
}

.prompt-textarea :deep(.n-input__textarea-el::placeholder) {
  color: #94a3b8;
  white-space: pre-line;
}

.prompt-actions {
  display: flex;
  align-items: center;
}

.prompt-actions :deep(.n-space) {
  width: 100%;
}

.prompt-actions :deep(.n-button) {
  font-weight: 500;
}

.prompt-actions :deep(.n-button--primary-type) {
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.2);
}

.prompt-actions :deep(.n-button--quaternary-type) {
  opacity: 0.7;
  font-weight: 400;
}

.prompt-actions :deep(.n-button--quaternary-type):hover {
  opacity: 1;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .prompt-card {
    padding: 18px;
  }

  .prompt-title {
    font-size: 20px;
  }

  .prompt-subtitle {
    font-size: 13px;
  }

  .prompt-actions :deep(.n-space) {
    flex-wrap: wrap;
  }

  .prompt-actions :deep(.n-button) {
    flex: 1;
    min-width: 100px;
  }
}
.prompt-card :deep(.n-card__content) {
  padding: 0;
}
</style>
