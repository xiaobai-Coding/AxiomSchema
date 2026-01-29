<template>
  <NDrawer :show="show" :width="380" placement="right" :mask-closable="false" :close-on-esc="false"
    @update:show="(val) => emit('update:show', val)">
    <NDrawerContent :title="`${t('editor.field_editor')} ${fieldKey}`">
      <NForm label-placement="top" :show-require-mark="false" :model="formState">
        <NFormItem :label="t('editor.label')">
          <NInput :value="formState.label" :placeholder="t('editor.label')" @update:value="(v) => (formState.label = v)" />
        </NFormItem>
        <NFormItem :label="t('editor.placeholder_label')">
          <NInput :value="formState.placeholder" :placeholder="t('editor.placeholder_label')"
            @update:value="(v) => (formState.placeholder = v)" />
        </NFormItem>
        <NFormItem :label="t('editor.default')">
          <NInput :value="formState.default" :placeholder="t('editor.default')" @update:value="(v) => (formState.default = v)" />
        </NFormItem>
        <NFormItem :label="t('editor.required')">
          <NSwitch :value="formState.required" @update:value="(v) => (formState.required = v)" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="space-between" style="width: 100%">
          <NButton :disabled="!canReset" @click="handleReset">{{ t('common.reset') }}</NButton>
          <NSpace>
            <NButton @click="handleCancel">{{ t('common.cancel') }}</NButton>
            <NButton type="primary" @click="handleConfirm">{{ t('common.confirm') }}</NButton>
          </NSpace>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import { NDrawer, NDrawerContent, NForm, NFormItem, NInput, NSwitch, NButton, NSpace } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  show: boolean
  fieldKey: string | null
  schema: any
  backupField: any
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'confirm', changed?: boolean): void
  (e: 'cancel'): void
  (e: 'reset'): void
  (e: 'update-schema', value: any): void
}>()

const formState = reactive({
  label: '',
  placeholder: '',
  default: '',
  required: false
})

const findField = () => {
  return props.schema?.fields?.find((f: any) => f.name === props.fieldKey)
}

watch(
  () => [props.fieldKey, props.show],
  () => {
    if (!props.show || !props.fieldKey) return
    const field = findField()
    if (!field) return
    formState.label = field.label ?? ''
    formState.placeholder = field.placeholder ?? ''
    formState.default = field.default ?? ''
    formState.required = field.required === true
  },
  { immediate: true }
)

// 当表单状态变化时，将变更应用到 schema（实时同步）
watch(
  formState,
  () => {
    applyChanges()
  },
  { deep: true }
)

const applyChanges = () => {
  const fieldIndex = props.schema?.fields?.findIndex((f: any) => f.name === props.fieldKey)
  if (fieldIndex === -1 || fieldIndex === undefined) return

  const nextFields = [...props.schema.fields]
  nextFields[fieldIndex] = {
    ...nextFields[fieldIndex],
    label: formState.label,
    placeholder: formState.placeholder,
    default: formState.default,
    required: formState.required
  }

  const nextSchema = {
    ...props.schema,
    fields: nextFields
  }

  emit('update-schema', nextSchema)
}

const handleConfirm = () => {
  // 通过比较当前表单状态和备份字段，判断用户是否真的修改过内容
  const before = props.backupField ? JSON.stringify({
    label: props.backupField.label ?? '',
    placeholder: props.backupField.placeholder ?? '',
    default: props.backupField.default ?? '',
    required: !!props.backupField.required
  }) : null
  const after = JSON.stringify({
    label: formState.label ?? '',
    placeholder: formState.placeholder ?? '',
    default: formState.default ?? '',
    required: !!formState.required
  })
  const changed = before === null ? true : before !== after
  emit('confirm', changed)
}

const handleCancel = () => {
  emit('cancel')
}

const canReset = computed(() => !!props.fieldKey && !!props.backupField)

const handleReset = () => {
  emit('reset')
}
</script>
