<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { IconArrowRight, IconFolderOpen, IconFolderSearch, IconListDetails, IconLoader2, IconMicrophone, IconPaperclip, IconPlayerPause, IconPlayerStop, IconPlus, IconSend2, IconX } from '@tabler/icons-vue'
import AttachmentCard from './AttachmentCard.vue'
import { Button, Drawer, Message, Modal, Tooltip } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { AgentReply } from '@maestro-shared/coach.api'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import IconBtn from '../../../common/components/IconBtn/IconBtn.vue'
import MessageList from './MessageList.vue'
import SlashMenu from './SlashMenu.vue'
import { ShortcutStore, slashTokenAt } from './store/shortcut.store'
import { channelStore } from './store/channel.store'
import { messageStore } from './store/message.store'
import type { ChatAttachment, MessageSession } from './store/message.type'
import { isRejection } from './store/turn.service'
import './ChatPanel.less'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const props = defineProps<{ session: MessageSession; sendDisabled?: boolean }>()
const emit = defineEmits<{ sent: [reply: AgentReply] }>()
const VOICE_SCRIBE_SAMPLE_RATE = 16_000
const VOICE_SCRIBE_MAX_MS = 5 * 60 * 1000

const input = ref('')
// Composer attachments: picked/dropped files, kept as {name, absolute path}. On send the
// paths (never bytes) are registered with main; the agent reads them via read_file.
const selectedFiles = ref<ChatAttachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const composerCaret = ref(0)
const shortcutStore = reactive(new ShortcutStore([
  { name: '/clear', get hint() { return i18nHelper.maestroControl.chat.slashClear } },
  { name: '/view_context', get hint() { return i18nHelper.maestroControl.chat.slashViewContext } }
]))
const slashToken = computed(() => slashTokenAt(input.value, composerCaret.value))
const slashVisible = computed(() => shortcutStore.open && shortcutStore.matches.length > 0)
let draftRevision = 0
let composerDisposed = false
let newChatPending = false
watch(input, () => { draftRevision += 1 }, { flush: 'sync' })
watch([input, composerCaret], () => shortcutStore.update(slashToken.value), { flush: 'post' })
watch(() => props.session.id, () => { draftRevision += 1; shortcutStore.close() }, { flush: 'sync' })
onBeforeUnmount(() => { composerDisposed = true; shortcutStore.close() })
const historyVisible = ref(false)
const historyContainer = ref<HTMLElement | null>(null)
const historyList = ref<HTMLElement | null>(null)
const historyCursor = ref(0)
const shortcut = (key: string): string => `${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'}${key}`
const voiceRecording = ref(false)
const voiceBusy = ref(false)

interface VoiceRecorder {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  stream: MediaStream
  chunks: Float32Array[]
  sampleRate: number
}

const voiceRecorder = ref<VoiceRecorder | null>(null)
const voiceRecordingStartedAt = ref(0)
const voiceRecordingElapsedMs = ref(0)
let voiceRecordingTimer: ReturnType<typeof setInterval> | undefined
const turnLocked = computed(() => Boolean(messageStore.turnService.activeTurn()))

const workspace = computed(() => props.session.detail.workspace)
const workspaceLabel = computed(() => workspace.value?.name || 'Workspace')
const workspaceTitle = computed(() => workspace.value?.path || 'Set workspace')
const voiceRecordingLabel = computed(() => {
  const totalSeconds = Math.floor(voiceRecordingElapsedMs.value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const formatSessionTime = (ts: number): string => {
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function resizeComposer(): void {
  const el = composerRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 120)}px`
}

function resetComposerHeight(): void {
  const el = composerRef.value
  if (!el) return
  el.style.height = '44px'
}

function startVoiceTimer(): void {
  if (voiceRecordingTimer) clearInterval(voiceRecordingTimer)
  voiceRecordingStartedAt.value = Date.now()
  voiceRecordingElapsedMs.value = 0
  voiceRecordingTimer = setInterval(() => {
    const elapsedMs = Date.now() - voiceRecordingStartedAt.value
    voiceRecordingElapsedMs.value = Math.min(elapsedMs, VOICE_SCRIBE_MAX_MS)
    if (elapsedMs >= VOICE_SCRIBE_MAX_MS) void stopVoiceScribe(true)
  }, 250)
}

function stopVoiceTimer(): void {
  if (!voiceRecordingTimer) return
  clearInterval(voiceRecordingTimer)
  voiceRecordingTimer = undefined
}

function cleanupVoiceRecorder(): void {
  const recorder = voiceRecorder.value
  voiceRecording.value = false
  voiceRecorder.value = null
  stopVoiceTimer()
  if (!recorder) return
  recorder.processor.disconnect()
  recorder.source.disconnect()
  recorder.stream.getTracks().forEach((track) => track.stop())
  void recorder.context.close().catch(() => undefined)
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
}

function concatPcmChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const samples = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  return samples
}

function resamplePcm(samples: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array {
  if (!samples.length || sourceSampleRate === targetSampleRate) return samples
  const ratio = sourceSampleRate / targetSampleRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(samples.length - 1, left + 1)
    const mix = sourceIndex - left
    out[i] = samples[left] * (1 - mix) + samples[right] * mix
  }
  return out
}

function encodeWav(chunks: Float32Array[], sourceSampleRate: number): { buffer: ArrayBuffer; sampleRate: number } {
  const roundedSourceSampleRate = Math.max(1, Math.round(sourceSampleRate))
  const outputSampleRate = roundedSourceSampleRate > VOICE_SCRIBE_SAMPLE_RATE ? VOICE_SCRIBE_SAMPLE_RATE : roundedSourceSampleRate
  const samples = resamplePcm(concatPcmChunks(chunks), roundedSourceSampleRate, outputSampleRate)
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, outputSampleRate, true)
  view.setUint32(28, outputSampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (const sample of samples) {
    const clipped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true)
    offset += 2
  }
  return { buffer, sampleRate: outputSampleRate }
}

async function appendTranscript(text: string): Promise<void> {
  const transcript = text.trim()
  if (!transcript) return
  input.value = input.value.trim() ? `${input.value.trimEnd()}\n${transcript}` : transcript
  await nextTick()
  resizeComposer()
  composerRef.value?.focus()
}

function promptAiCrmsLogin(): void {
  Modal.confirm({
    title: 'AI-CRMS login required',
    content: 'Voice scribe uses Bailian ASR through AI-CRMS. Log in first, then record again.',
    okText: 'Login',
    cancelText: 'Cancel',
    onOk: () => coach.loginLlm({ provider: 'ai-crms', method: 'browser' }).then(() => undefined)
  })
}

async function ensureAiCrmsScribeReady(): Promise<boolean> {
  const cfg = await coach.getLlmConfig().catch(() => null)
  if (!cfg) {
    Message.error('Could not check AI-CRMS login state.')
    return false
  }
  if (cfg.providers.some((provider) => provider.provider === 'ai-crms' && provider.ready)) return true
  promptAiCrmsLogin()
  return false
}

async function startVoiceScribe(): Promise<void> {
  if (voiceRecording.value || voiceBusy.value || props.session.archivedAt) return
  if (!(await ensureAiCrmsScribeReady())) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(context.destination)
    voiceRecorder.value = { context, source, processor, stream, chunks, sampleRate: context.sampleRate }
    startVoiceTimer()
    voiceRecording.value = true
  } catch (err) {
    Message.error('Microphone unavailable: ' + (err as Error).message)
  }
}

async function stopVoiceScribe(autoStopped = false): Promise<void> {
  const recorder = voiceRecorder.value
  if (!recorder) return
  voiceRecording.value = false
  voiceRecorder.value = null
  stopVoiceTimer()
  recorder.processor.disconnect()
  recorder.source.disconnect()
  recorder.stream.getTracks().forEach((track) => track.stop())
  await recorder.context.close().catch(() => undefined)
  if (!recorder.chunks.length) {
    Message.warning('No audio recorded.')
    return
  }
  voiceBusy.value = true
  try {
    if (autoStopped) Message.info('Voice recording reached 5 minutes; processing now.')
    const wav = encodeWav(recorder.chunks, recorder.sampleRate)
    const path = window.audioBridge.writeTempAudio({ bytes: wav.buffer, extension: 'wav' })
    const result = await coach.scribeAudio({ path, mime: 'audio/wav', format: 'wav', sampleRate: wav.sampleRate })
    if (result.ok) {
      await appendTranscript(result.text)
      Message.success('Voice scribe inserted')
      return
    }
    if (result.code === 'ai-crms-login-required') promptAiCrmsLogin()
    else Message.error(result.error || 'Voice scribe failed')
  } catch (err) {
    Message.error('Voice scribe failed: ' + (err as Error).message)
  } finally {
    voiceBusy.value = false
  }
}

async function toggleVoiceScribe(): Promise<void> {
  if (voiceRecording.value) await stopVoiceScribe()
  else await startVoiceScribe()
}

onBeforeUnmount(() => cleanupVoiceRecorder())

async function send(): Promise<void> {
  if (shortcutStore.pending) return
  if (slashVisible.value) { await commitShortcut(); return }
  const message = input.value.trim()
  // Text is REQUIRED to send, even when files are attached.
  if (!message || props.sendDisabled || props.session.turn?.aborting) return
  if (messageStore.turnService.busyElsewhere(props.session.id)) {
    Modal.warning({
      title: i18nHelper.maestroControl.chat.busyTitle,
      content: i18nHelper.maestroControl.chat.busyContent,
      okText: i18nHelper.maestroControl.chat.gotIt
    })
    return
  }
  const steering = Boolean(props.session.turn)
  const files = !steering && selectedFiles.value.length ? selectedFiles.value.slice() : undefined
  input.value = ''
  if (!steering) selectedFiles.value = []
  await nextTick()
  resetComposerHeight()
  const reply = await messageStore.turnService.send(props.session.id, message, files)
  if (reply && !isRejection(reply)) {
    if (!reply.mergedIntoTurn) emit('sent', reply)
    return
  }
  if (!input.value.trim()) {
    input.value = message
    if (files?.length) selectedFiles.value = files.slice()
    await nextTick()
    resizeComposer()
  }
  Modal.warning({
    title: i18nHelper.maestroControl.chat.messageNotSentTitle,
    content: i18nHelper.maestroControl.chat.messageNotSentContent,
    okText: i18nHelper.maestroControl.chat.gotIt
  })
}

function pickFiles(): void {
  if (turnLocked.value || props.session.archivedAt) return
  fileInput.value?.click()
}

// Add files by ABSOLUTE PATH only (resolved via the preload bridge — webUtils, no bytes
// read). On send the paths are registered with main and the agent reads them via read_file.
function addFiles(files: File[]): void {
  const added: string[] = []
  for (const file of files) {
    const path = window.fileBridge?.getPathForFile(file) || ''
    if (!path || selectedFiles.value.some((f) => f.path === path)) continue
    selectedFiles.value.push({ name: file.name, path })
    added.push(path)
  }
  if (added.length) void markDirectories(added)
}

// Renderer names cannot reliably distinguish a directory from a file. Main stats each new path and
// the array entry is replaced through Vue's proxy so the pending card updates immediately.
async function markDirectories(paths: string[]): Promise<void> {
  const statuses = await coach.getFileStatuses({ paths }).catch(() => null)
  if (!statuses) return
  for (let statusIndex = 0; statusIndex < paths.length; statusIndex += 1) {
    const status = statuses[statusIndex]
    if (!status) continue
    if (!status.isDirectory) continue
    const index = selectedFiles.value.findIndex((file) => file.path === paths[statusIndex])
    if (index >= 0) {
      selectedFiles.value[index] = { ...selectedFiles.value[index], isDirectory: true }
    }
  }
}

function onFilesPicked(event: Event): void {
  const el = event.target as HTMLInputElement
  if (turnLocked.value || props.session.archivedAt) {
    el.value = ''
    return
  }
  addFiles(Array.from(el.files || []))
  el.value = '' // reset so picking the same file again still fires change
}

async function onComposerPaste(event: ClipboardEvent): Promise<void> {
  if (!props.session.allowFiles || turnLocked.value || props.session.archivedAt) return
  const files = Array.from(event.clipboardData?.files || [])
  if (!files.length) return
  const onDisk = files.filter((file) => Boolean(window.fileBridge?.getPathForFile(file)))
  const pathlessImages = files.filter(
    (file) =>
      file.type.startsWith('image/') && !window.fileBridge?.getPathForFile(file)
  )
  if (!onDisk.length && !pathlessImages.length) return
  event.preventDefault()
  if (onDisk.length) addFiles(onDisk)
  if (!pathlessImages.length) return
  const attached = await coach.attachClipboardImage({ sessionId: props.session.id }).catch(() => null)
  if (!attached?.ok || !attached.path) return
  if (selectedFiles.value.some((file) => file.path === attached.path)) return
  selectedFiles.value.push({ name: attached.name || 'clipboard.png', path: attached.path })
}

// Drag & drop onto the composer. A depth counter avoids flicker as the cursor crosses
// child elements (each enter/leave pair nets out).
let dragDepth = 0
const dragging = ref(false)
function onDragEnter(): void {
  if (!props.session.allowFiles || turnLocked.value || props.session.archivedAt) return
  dragDepth += 1
  dragging.value = true
}
function onDragLeave(): void {
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dragging.value = false
  }
}
function onDrop(event: DragEvent): void {
  dragDepth = 0
  dragging.value = false
  if (!props.session.allowFiles || turnLocked.value || props.session.archivedAt) return
  addFiles(Array.from(event.dataTransfer?.files || []))
}

function removeFile(i: number): void {
  if (turnLocked.value) return
  selectedFiles.value.splice(i, 1)
}

async function startNewChat(): Promise<boolean> {
  if (newChatPending) return false
  if (turnLocked.value || props.session.archivedAt) {
    Message.warning(i18nHelper.maestroControl.chat.newChatUnavailable)
    return false
  }
  const sessionId = props.session.id
  const revision = draftRevision
  newChatPending = true
  try {
    const opened = await channelStore.startNewMaestroSession(sessionId)
    if (!opened) { Message.warning(i18nHelper.maestroControl.chat.newChatUnavailable); return false }
    if (!composerDisposed && props.session.id === sessionId && draftRevision === revision) {
      input.value = ''
      selectedFiles.value = []
      await nextTick()
      resetComposerHeight()
    }
    return true
  } catch (error) {
    Message.error(error instanceof Error ? error.message : String(error))
    return false
  } finally {
    newChatPending = false
  }
}

async function selectHistory(sessionId: string): Promise<void> {
  if (sessionId === props.session.id) return
  await channelStore.selectMaestroHistorySession(sessionId)
  historyVisible.value = false
}

function focusComposer(): void {
  if (!props.session.archivedAt) composerRef.value?.focus()
}

function closeHistory(): void {
  historyVisible.value = false
  void nextTick(focusComposer)
}

function scrollHistoryCursor(): void {
  void nextTick(() => historyList.value?.querySelector<HTMLElement>('[data-history-cursor="true"]')?.scrollIntoView({ block: 'nearest' }))
}

function toggleHistory(): void {
  if (historyVisible.value) {
    closeHistory()
    return
  }
  const index = messageStore.historySessions.findIndex((item) => item.id === props.session.id)
  historyCursor.value = Math.max(index, 0)
  historyVisible.value = true
  scrollHistoryCursor()
  // 打开就重拉一次。抽屉此前只吃 `init()` 那一次拉取的结果,启动期失败(或本窗口打开后
  // 别处新建的会话)都会让它一直是空的 —— 这正是「Cmd+H 不展示历史消息」的成因
  // (docs/issues/maestro-chat-blind-send-path-and-cowork-parity.md #2)。
  // 不 await:先把抽屉开出来,列表到了再补上,免得打开动作被一次跨进程往返拖住。
  void messageStore.refreshHistory().then(scrollHistoryCursor)
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (!document.hasFocus() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
  const key = event.key.toLowerCase()
  if (command && (key === 'h' || key === 'n')) {
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (key === 'h') toggleHistory()
    else void startNewChat()
    return
  }
  if (!historyVisible.value || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  if (!['Escape', 'ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') closeHistory()
  else if (event.key === 'Enter') {
    if (event.repeat) return
    const item = messageStore.historySessions[historyCursor.value]
    if (item) void selectHistory(item.id)
  } else {
    const count = messageStore.historySessions.length
    if (!count) return
    historyCursor.value = (historyCursor.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
    scrollHistoryCursor()
  }
}

onMounted(() => {
  // Capture before the textarea can turn History's Enter into a message send.
  window.addEventListener('keydown', onPanelKeydown, true)
  void nextTick(focusComposer)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onPanelKeydown, true))

async function stop(): Promise<void> {
  await messageStore.turnService.stop(props.session.id)
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return
  if (slashVisible.value && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') shortcutStore.close()
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') shortcutStore.move(event.key === 'ArrowUp' ? -1 : 1)
      else if (event.key === 'Tab') completeShortcut()
      else void commitShortcut()
      return
    }
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  void send()
}

function updateComposerCaret(): void {
  composerCaret.value = composerRef.value?.selectionStart ?? input.value.length
}

function onComposerInput(): void { resizeComposer(); updateComposerCaret() }

function completeShortcut(): void {
  const token = slashToken.value
  const item = shortcutStore.active
  if (!token || !item || shortcutStore.pending) return
  input.value = input.value.slice(0, token.start) + item.name + input.value.slice(token.end)
  composerCaret.value = token.start + item.name.length
  void nextTick(() => composerRef.value?.setSelectionRange(composerCaret.value, composerCaret.value))
}

async function commitShortcut(): Promise<void> {
  const token = slashToken.value
  if (!token || shortcutStore.pending) return
  const revision = draftRevision
  const sessionId = props.session.id
  const draft = input.value.slice(0, token.start) + input.value.slice(token.end)
  const result = await shortcutStore.commit({
    newChat: startNewChat,
    copyContext: async () => {
      const context = messageStore.buildAgentContext(props.session, undefined, selectedFiles.value.map((file) => file.path))
      const summary = await coach.copyNextTurnContext({ sessionId, draft, context })
      if (!summary.ok) throw new Error(summary.error)
      if (!composerDisposed && props.session.id === sessionId) {
        Message.success(i18nHelper.maestroControl.chat.slashCopied.replace('{chars}', String(summary.chars)).replace('{entries}', String(summary.entries)))
      }
    }
  })
  if (composerDisposed || props.session.id !== sessionId) return
  if (!result.ok && result.error) Message.error(result.error)
  if (draftRevision !== revision) return
  if (!result.ok) {
    shortcutStore.update(slashToken.value)
    return
  }
  input.value = draft
  composerCaret.value = token.start
  await nextTick()
  resizeComposer()
  composerRef.value?.setSelectionRange(token.start, token.start)
}

/**
 * 芯片左段:打开**这个目录本身**,在 OnlyPreview 里(Ral 2026-09-07)。
 *
 * 原来这里挂的是 `chooseWorkspace` —— 点一个写着「你在哪个目录」的控件,弹出来的是「你想去哪个
 * 目录」。名实不符,而控件骗人比没有控件更糟;切换挪到旁边自己的按钮上去了。
 */
async function revealWorkspace(): Promise<void> {
  if (turnLocked.value || props.session.archivedAt) return
  const path = workspace.value?.path
  if (!path) return
  const result = await coach.openWorkspaceInPreview({ path }).catch(() => null)
  if (!result?.ok) Message.error(`Cannot open ${path}`)
}

async function chooseWorkspace(): Promise<void> {
  if (turnLocked.value || props.session.archivedAt) return
  await messageStore.chooseWorkspace(props.session.id)
}

async function clearWorkspace(): Promise<void> {
  if (turnLocked.value || props.session.archivedAt) return
  Modal.confirm({
    title: i18nHelper.maestroControl.chat.clearWorkspaceTitle,
    content: i18nHelper.maestroControl.chat.clearWorkspaceContent.replace('{name}', workspaceLabel.value),
    okText: i18nHelper.maestroControl.chat.clearWorkspace,
    cancelText: i18nHelper.maestroControl.chat.keepWorkspace,
    onOk: async () => {
      if (turnLocked.value || props.session.archivedAt) return
      await messageStore.clearWorkspace(props.session.id)
    }
  })
}

function setHistoryContainer(el: HTMLElement | null): void {
  historyContainer.value = el
}
</script>

<template>
  <div
    class="chat-panel"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      v-if="dragging && session.allowFiles && !turnLocked"
      class="chat-panel__drop-overlay"
    >
      <div class="chat-panel__drop-message">
        Drop files to attach
      </div>
    </div>
    <div class="chat-panel__toolbar">
      <Tooltip :content="shortcut('H')" position="bottom" mini>
        <IconBtn
        class="chat-panel__history-button"
        name="maestro__history"
        :aria-label="i18nHelper.maestroControl.chat.history"
        @click="toggleHistory"
      >
        <IconListDetails class="chat-panel__button-icon" :size="16" stroke="1.8" />
      </IconBtn>
      </Tooltip>
      <Tooltip :content="shortcut('N')" position="bottom" mini>
        <Button
        name="maestro__new_chat"
        class="chat-panel__new-chat"
        type="text"
        size="mini"
        :disabled="turnLocked"
        :aria-label="i18nHelper.maestroControl.chat.newChat"
        @click="startNewChat"
      >
        <template #icon>
          <IconPlus class="chat-panel__button-icon" :size="15" stroke="1.8" />
        </template>
        {{ i18nHelper.maestroControl.chat.newChat }}
      </Button>
      </Tooltip>
    </div>
    <MessageList :messages="session.messages" @container-ready="setHistoryContainer" />
    <Drawer
      v-if="historyContainer"
      v-model:visible="historyVisible"
      placement="left"
      :width="280"
      :popup-container="historyContainer"
      :header="false"
      :footer="false"
      :body-style="{ padding: '0', overflow: 'hidden' }"
      unmount-on-close
      @cancel="closeHistory"
    >
      <div class="chat-panel__history">
        <div class="chat-panel__history-header">
          <div class="chat-panel__history-title">{{ i18nHelper.maestroControl.chat.history }}</div>
          <IconBtn
            class="chat-panel__history-close"
            :title="i18nHelper.maestroControl.chat.closeHistory"
            :aria-label="i18nHelper.maestroControl.chat.closeHistory"
            @click="closeHistory"
          >
            <IconX class="chat-panel__button-icon" :size="16" stroke="1.8" />
          </IconBtn>
        </div>
        <div ref="historyList" name="maestro__history-list" class="chat-panel__history-list">
          <div v-if="!messageStore.historySessions.length" class="chat-panel__history-empty">
            {{ i18nHelper.maestroControl.chat.noHistory }}
          </div>
          <Button
            v-for="(item, index) in messageStore.historySessions"
            :key="item.id"
            class="chat-panel__history-item"
            :class="{
              'chat-panel__history-item--active': item.id === session.id,
              'chat-panel__history-item--cursor': index === historyCursor
            }"
            name="maestro__history-item"
            :data-history-cursor="index === historyCursor"
            :aria-current="item.id === session.id ? 'true' : undefined"
            type="text"
            long
            @click="selectHistory(item.id)"
          >
            <IconArrowRight v-if="item.id === session.id" class="chat-panel__history-current" :size="12" stroke="2.4" />
            <span class="chat-panel__history-item-title">{{ item.title || 'Maestro' }}</span>
            <span class="chat-panel__history-item-preview">{{ item.preview || formatSessionTime(item.updatedAt) }}</span>
          </Button>
        </div>
      </div>
    </Drawer>
    <div class="chat-panel__composer">
      <slot name="before-composer"></slot>
      <div
        v-if="session.allowFiles && selectedFiles.length"
        name="maestro__composer__attachments"
        class="chat-panel__attachments"
      >
        <div
          v-for="(f, i) in selectedFiles"
          :key="f.path"
          class="chat-panel__attachment-card"
        >
          <AttachmentCard :name="f.name" :path="f.path" :is-directory="f.isDirectory" />
          <IconBtn
            class="chat-panel__attachment-remove"
            :disabled="turnLocked"
            :title="i18nHelper.maestroControl.chat.removeAttachment"
            :aria-label="i18nHelper.maestroControl.chat.removeAttachmentNamed.replace('{name}', f.name)"
            @click="removeFile(i)"
          >
            <IconX class="chat-panel__button-icon" :size="10" stroke="2.4" />
          </IconBtn>
        </div>
      </div>
      <div class="chat-panel__input-wrap">
        <SlashMenu :store="shortcutStore" @select="shortcutStore.activeIndex = $event" @commit="commitShortcut" />
        <textarea
          ref="composerRef"
          v-model="input"
          :disabled="Boolean(session.archivedAt)"
          :placeholder="session.archivedAt ? i18nHelper.maestroControl.chat.archivedConversation : session.placeholder"
          rows="1"
          class="chat-panel__textarea"
          :class="{ 'chat-panel__textarea--recording': voiceRecording }"
          aria-autocomplete="list"
          :aria-expanded="slashVisible"
          :aria-controls="slashVisible ? 'maestro-slash-menu' : undefined"
          :aria-activedescendant="slashVisible ? `maestro-slash-${shortcutStore.activeIndex}` : undefined"
          @input="onComposerInput"
          @click="updateComposerCaret"
          @keyup="updateComposerCaret"
          @keydown="onComposerKeydown"
          @paste="onComposerPaste"
        ></textarea>
        <div
          v-if="voiceRecording"
          name="maestro__composer__voice_recording"
          class="chat-panel__voice-recording"
        >
          <span class="chat-panel__voice-wave" aria-hidden="true">
            <span class="chat-panel__voice-wave-bar"></span>
            <span class="chat-panel__voice-wave-bar"></span>
            <span class="chat-panel__voice-wave-bar"></span>
            <span class="chat-panel__voice-wave-bar"></span>
            <span class="chat-panel__voice-wave-bar"></span>
          </span>
          <span class="chat-panel__voice-time">{{ voiceRecordingLabel }}</span>
        </div>
      </div>
      <div class="chat-panel__composer-footer">
        <div v-if="session.allowFiles" name="maestro__composer__context" class="chat-panel__composer-tools">
          <!-- The duplicate Skills shortcut is intentionally hidden. The Workbench Skills pane
               and its internal coach/workbench-pane broadcast remain available in Workbench. -->
          <Tooltip v-if="session.allowFiles && !workspace" content="Set workspace" position="top">
            <Button
              name="maestro__composer__choose-workspace"
              class="chat-panel__choose-workspace"
              type="text"
              size="small"
              :disabled="turnLocked || Boolean(session.archivedAt)"
              :aria-label="i18nHelper.maestroControl.chat.chooseWorkspace"
              @click="chooseWorkspace"
            >
              {{ i18nHelper.maestroControl.chat.chooseWorkspace }}
            </Button>
          </Tooltip>
          <div
            v-else-if="session.allowFiles && workspace"
            name="maestro__composer__workspace"
            class="chat-panel__workspace"
          >
            <Tooltip :content="workspaceTitle" position="top" mini>
              <Button
                name="maestro__composer__workspace-open"
                class="chat-panel__workspace-select"
                type="text"
                html-type="button"
                :disabled="turnLocked || Boolean(session.archivedAt)"
                aria-label="Open workspace in OnlyPreview"
                @click="revealWorkspace"
              >
                <span name="maestro__composer__workspace-content" class="chat-panel__workspace-content">
                  <IconFolderOpen class="chat-panel__workspace-icon" :size="16" stroke="1.8" />
                  <span class="chat-panel__workspace-label">{{ workspaceLabel }}</span>
                </span>
              </Button>
            </Tooltip>
            <Tooltip content="Switch workspace" position="top" mini>
              <IconBtn
                name="maestro__composer__workspace-switch"
                class="chat-panel__workspace-action"
                :disabled="turnLocked || Boolean(session.archivedAt)"
                aria-label="Switch workspace"
                @click="chooseWorkspace"
              >
                <IconFolderSearch class="chat-panel__button-icon" :size="14" stroke="1.8" />
              </IconBtn>
            </Tooltip>
            <Tooltip content="Clear workspace" position="top" mini>
              <IconBtn
                name="maestro__composer__workspace-clear"
                class="chat-panel__workspace-action chat-panel__workspace-action--danger"
                :disabled="turnLocked || Boolean(session.archivedAt)"
                aria-label="Clear workspace"
                @click="clearWorkspace"
              >
                <IconX class="chat-panel__button-icon" :size="13" stroke="2" />
              </IconBtn>
            </Tooltip>
          </div>
          <IconBtn
            v-if="session.allowFiles"
            name="maestro__composer__attach"
            class="chat-panel__tool-button"
            :disabled="turnLocked"
            title="Attach files (PDF, Excel, Word, text…)"
            aria-label="Attach files"
            @click="pickFiles"
          >
            <IconPaperclip class="chat-panel__button-icon" :size="18" stroke="1.8" />
          </IconBtn>
        </div>
        <div class="chat-panel__composer-actions">
          <div class="chat-panel__model-controls"><slot name="before-actions"></slot></div>
          <IconBtn
            class="chat-panel__voice-button"
            :class="{
              'chat-panel__voice-button--recording': voiceRecording,
              'chat-panel__voice-button--busy': voiceBusy
            }"
            :disabled="Boolean(session.archivedAt) || (!voiceRecording && voiceBusy)"
            :title="voiceRecording ? 'Stop voice scribe' : voiceBusy ? 'Uploading voice' : 'Voice scribe'"
            :aria-label="voiceRecording ? 'Stop voice scribe' : 'Voice scribe'"
            @click="toggleVoiceScribe"
          >
            <IconLoader2 v-if="voiceBusy" class="chat-panel__voice-spinner" :size="18" stroke="1.8" />
            <IconPlayerPause v-else-if="voiceRecording" class="chat-panel__button-icon" :size="18" stroke="1.8" />
            <IconMicrophone v-else class="chat-panel__button-icon" :size="18" stroke="1.8" />
          </IconBtn>
          <!-- Stop 与 Send 同形同位、互斥显示 —— 以 cowork 的 `chat-panel__composer-stop` 为准
               (Ral 2026-09-09:两边风格不一致,以 cowork 为准)。要点是**纯图标 + 软色底 + 无边框**:
               原先那版是 Arco `type="outline" status="danger"` 的带框胶囊还带 "Stop" 字样,
               在同一排 32px 图标按钮里既比别人高一截、又是这一排唯一有描边的东西。
               文案不丢:它挪到 title / aria-label 上,i18n key 照旧。 -->
          <IconBtn
            v-if="Boolean(session.turn)"
            name="maestro__composer__stop"
            class="chat-panel__stop-button"
            :class="{ 'chat-panel__stop-button--aborting': session.turn?.aborting }"
            :disabled="session.turn?.aborting"
            :title="session.turn?.aborting ? i18nHelper.maestroControl.chat.stopping : i18nHelper.maestroControl.chat.stop"
            :aria-label="session.turn?.aborting ? i18nHelper.maestroControl.chat.stopping : i18nHelper.maestroControl.chat.stop"
            @click="stop"
          >
            <IconPlayerStop class="chat-panel__button-icon" :size="15" stroke="1.8" />
          </IconBtn>
          <IconBtn
            v-else
            name="maestro__composer__send"
            class="chat-panel__send-button"
            :disabled="!input.trim() || Boolean(session.archivedAt) || sendDisabled || Boolean(session.turn?.aborting)"
            :title="session.turn ? i18nHelper.maestroControl.chat.sendIntoTurn : i18nHelper.maestroControl.chat.send"
            :aria-label="i18nHelper.maestroControl.chat.send"
            @click="send"
          >
            <IconSend2 class="chat-panel__button-icon" :size="15" stroke="1.8" />
          </IconBtn>
        </div>
      </div>
      <input ref="fileInput" type="file" accept=".pdf,.doc,.docx,.docm,.ppt,.pps,.pot,.pptx,.pptm,.ppsx,.ppsm,.xls,.xlsx,.xlsm,.xlsb,.odt,.ods,.odp,.rtf,.epub,.csv,.tsv,.md,.markdown,.txt,.json,.html,.htm,.xml,.yaml,.yml,.log,.zip,.7z,.rar,.tar,.tgz,.gz,.xz,.bz2,.bz3,.zst,.lz4,.lzma,.lz,.sz,.br,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" multiple class="chat-panel__file-input" @change="onFilesPicked" />
    </div>
  </div>
</template>
