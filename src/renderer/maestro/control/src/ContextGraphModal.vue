<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { IconCornerDownRight, IconLock, IconX } from '@tabler/icons-vue';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import type { ContextGraphBlockView, ContextGraphView } from '@maestro-shared/coach.api';
import { messageStore } from './store/message.store';
// 样式走脚本侧引入,与同目录六个兄弟一致(SlashMenu / MessageItem / ChatPanel … 全是这个写法)。
// 仓里两种写法都有:bitterless 自己的 home 渲染器用 `<style>@import`,而 maestro/control 这一支
// 是从 cowork 移植过来的,整目录用脚本引入 —— 一个目录里只该有一种,否则 diff 里这个文件会格外扎眼。
import './ContextGraphModal.less';

/**
 * `/view_context_graph` 的弹窗 —— 回答的是**「此刻的上下文长什么结构」**,不是「上下文的正文」
 * (正文那条路仍归 `/view_context`,它去剪贴板)。契约:`docs/features/maestro-context-graph.md`。
 *
 * Ral 2026-09-09:「从 system prompt 开始 每个消息的类型都要展示出来…一个 block 一个 block 的展示…
 * 通过 modal 弹窗…半透明…点击后可以跳转对应的消息区域,如果是不显示在 UI 上的上下文 block 就不能点击,
 * 要能区分 turn」。目标他后来点明了:**为了理解当前上下文的结构**。
 *
 * 由此定下四件事:
 *
 * **① 这个组件不算任何东西。** 类型、体量、回合、压缩边界、能不能点(`messageId`)全部由 main 给
 * (`main/agent/contextGraph.service.ts`)—— 渲染层看不到工具调用与工具返回正文,而那是窗口里最大的
 * 一块,自己算就会画出一张漂亮但不对的图;而这个弹窗的全部价值恰恰是"它就是模型看到的那份结构"。
 * 这里只做**排版**:分段、量条、可点态。
 *
 * **② 半透明不是装饰。** 点一个块会跳到聊天里对应那条消息 —— 底下那一层就是跳转的落点,盖死了这个
 * 动作就不可理解。因此遮罩半透明 + 轻模糊,而**跳成功才关弹窗**:落点在弹窗底下,不关等于跳给自己看。
 *
 * **③ 不可点的块要看得出来是"不能点",而不是"点了没反应"。** 可点态**抬起一层**(阴影)+ hover +
 * 右下箭头;不可点态是平的半透明白 + 锁形 + 默认光标 + `div`(连按钮语义都不给)。
 * 判据只有一个:`messageId` 有没有 —— main 认领不到就留空(fail closed),**错链比不可点糟得多**。
 *
 * **④ 一条边框都不用**(Ral 2026-09-09 的全局规则)。分层靠底色落差 / 抬起 / 留白,细节在兄弟 `.less`。
 */

const props = defineProps<{ graph: ContextGraphView }>();
const emit = defineEmits<{ close: [] }>();

/**
 * 文案表用 `computed` 而不是 `const copy = i18nHelper.maestroControl.contextGraph` —— 切语言时
 * `applyRendererLanguage()` 是把 `maestroControl` **整个替换**掉的,常量引用会当场变成上一门语言的表。
 */
const copy = computed(() => i18nHelper.maestroControl.contextGraph);

/**
 * `{n}` / `{blocks}` / `{chars}` 的本地替换。**刻意不抽公共的**:本仓没有插值器,三个既有调用点各写
 * 一份(`ChatPanel.vue` 的 `withCount`、`turn.service.ts` 的 `interpolateChatCopy`、
 * `ResponseStatus.vue` 的链式 `.replace`),抽一个共享的就要同时改那三处 —— 本次没被要求的重构。
 */
const fill = (copyText: string, values: Record<string, string | number>): string => {
  let out = copyText;
  for (const [key, value] of Object.entries(values)) out = out.replace(`{${key}}`, String(value));
  return out;
};

/**
 * 类型 → 墨色。**同一类型在分布条、色轨、类型名上永远同一个颜色** —— 这张图要能被"扫"读,颜色是它
 * 唯一的索引;换个位置换个颜色就等于没有索引。
 * 未知类型(pi 以后新增的条目种类)落灰而不是随机上色:没见过的东西不该看起来比已知的更重要。
 */
const INK: Record<string, string> = {
  system: '#475569',
  user: '#165dff',
  assistant: '#0f766e',
  tool_call: '#b45309',
  tool_result: '#7c3aed',
  compaction: '#be185d',
  pending: '#0284c7'
};
const inkOf = (type: string): string =>
  INK[type] || (type.startsWith('custom_message') ? '#0891b2' : '#94a3b8');

const num = (value: number): string => value.toLocaleString();
const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() || path;

/**
 * 量条的分母是**最大那一块**,不是总量:总量当分母时,除了那一两块巨物之外全是看不见的细线 ——
 * 而"一条 tool_result 吃掉 58k 而 system 只有 17k"正是这张图要一眼说清的事。
 * 用 `reduce` 而不是 `Math.max(...blocks)`:没压缩过的长会话能有几千块,展开成实参是没必要的风险。
 */
const maxChars = computed(() =>
  props.graph.blocks.reduce(
    (top, block) => Math.max(top, block.chars),
    Math.max(props.graph.systemChars, props.graph.pending.chars, 1)
  )
);
const widthOf = (chars: number): string =>
  `${Math.max(2, Math.round((chars / maxChars.value) * 100))}%`;

interface TurnGroup {
  turn: number;
  chars: number;
  blocks: ContextGraphBlockView[];
}

/**
 * 按**上下文回合**分段。块本身有序且 `turn` 单调不减,所以一次线性扫描就够 —— 不排序、不分组归并:
 * 顺序就是模型看到的顺序,任何重排都会骗人。
 */
const groups = computed<TurnGroup[]>(() => {
  const out: TurnGroup[] = [];
  for (const block of props.graph.blocks) {
    const last = out[out.length - 1];
    if (last && last.turn === block.turn) {
      last.blocks.push(block);
      last.chars += block.chars;
      continue;
    }
    out.push({ turn: block.turn, chars: block.chars, blocks: [block] });
  }
  return out;
});

/** 头部那条分布条 —— 它回答「谁在吃窗口」,所以 system 与 pending 也算进去(它们同样占窗口)。 */
const segments = computed(() => {
  const rows = [
    { type: 'system', chars: props.graph.systemChars },
    ...props.graph.byType.map((total) => ({ type: total.type, chars: total.chars })),
    { type: 'pending', chars: props.graph.pending.chars }
  ].filter((row) => row.chars > 0);
  const total = rows.reduce((sum, row) => sum + row.chars, 0) || 1;
  return rows.map((row) => ({ ...row, pct: (row.chars / total) * 100 }));
});

// 只有 provider/model —— 窗口(token)不在这份投影里,理由写在 `ContextGraphView` 上。
const modelLine = computed(() => `${props.graph.provider || '?'}/${props.graph.model || '?'}`);

const hasPending = computed(
  () =>
    !!props.graph.pending.workspace ||
    !!props.graph.pending.attachments?.length ||
    !!props.graph.pending.draft
);

/**
 * 不可点的**两个不同原因**,要说成两句话:
 * · `system` / `tool_call` / `tool_result` / `compaction` —— 界面上**本来就没有**这一块;
 * · `user` / `assistant` 而 `messageId` 空 —— 界面上有它,但 main **认领不到**(fail closed)。
 *
 * 混成一句会把第二种说成第一种,于是"为什么这条 user 点不了"就成了一个无法回答的问题 ——
 * 而这个弹窗存在的理由正是回答这类问题。
 */
const CARRIED_TYPES = ['user', 'assistant'];
const lockLabelOf = (block: ContextGraphBlockView): string =>
  CARRIED_TYPES.includes(block.type) ? copy.value.notLocated : copy.value.notShown;

/**
 * 跳转。**跳到了才关** —— 关掉之后那条消息会闪 1.6s(`message.store` 的高亮),那就是回执;
 * 没找到(消息已被清掉)就什么都不做,弹窗留着,而不是关掉一个"看起来成功了"的动作。
 */
const jump = (block: ContextGraphBlockView): void => {
  if (!block.messageId) return;
  if (messageStore.scrollToMessage(block.messageId)) emit('close');
};

// Esc 关闭。装在 window 上而不是根节点上:焦点可能落在弹窗里任意一个块按钮上,也可能还在输入框里。
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  emit('close');
};
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <!-- 遮罩点击关闭用 `.self`:点在纸面上不能关 —— 这张纸上到处都是可点的块。 -->
  <div name="contextGraph" class="context-graph" @click.self="emit('close')">
    <section name="contextGraph__sheet" class="context-graph__sheet">
      <!-- 深色头 —— 它是这张"仪表"的身份:白纸压在白聊天上会糊成一片,而这条墨带一眼分出层次。 -->
      <header name="contextGraph__head" class="context-graph__head">
        <div class="context-graph__head-row">
          <div class="context-graph__identity">
            <div class="context-graph__title">{{ copy.title }}</div>
            <div class="context-graph__model">{{ modelLine }}</div>
          </div>
          <button
            type="button"
            name="contextGraph__close"
            class="context-graph__close"
            :title="copy.close"
            :aria-label="copy.close"
            @click="emit('close')"
          >
            <IconX :size="14" stroke="1.8" />
          </button>
        </div>
        <div name="contextGraph__meter" class="context-graph__meter">
          <span
            v-for="segment in segments"
            :key="segment.type"
            class="context-graph__meter__seg"
            :style="{ width: `${segment.pct}%`, background: inkOf(segment.type) }"
            :title="`${segment.type} · ${num(segment.chars)}`"
          ></span>
        </div>
        <div class="context-graph__totals">
          <span>{{ fill(copy.turns, { n: graph.turns }) }}</span>
          <span class="context-graph__totals__dot">·</span>
          <span>{{ fill(copy.blocks, { n: graph.blocks.length }) }}</span>
          <span class="context-graph__totals__dot">·</span>
          <span>{{ fill(copy.chars, { n: num(graph.totalChars) }) }}</span>
        </div>
      </header>

      <div name="contextGraph__body" class="context-graph__body">
        <!-- ① system prompt。**永远第一块、永远不可点** —— 它在上下文里,但界面上没有它。 -->
        <div
          name="contextGraph__system"
          class="context-graph__block context-graph__block--locked"
        >
          <span
            class="context-graph__block__rail"
            :style="{ background: inkOf('system') }"
          ></span>
          <span class="context-graph__block__head">
            <span class="context-graph__block__type" :style="{ color: inkOf('system') }">
              {{ copy.systemPrompt }}
            </span>
            <span class="context-graph__block__chars">{{ num(graph.systemChars) }}</span>
            <IconLock :size="10" stroke="1.8" class="context-graph__block__icon" />
          </span>
          <span class="context-graph__block__meter">
            <span
              class="context-graph__block__fill"
              :style="{ width: widthOf(graph.systemChars), background: inkOf('system') }"
            ></span>
          </span>
          <span v-if="graph.systemPreview" class="context-graph__block__preview">
            {{ graph.systemPreview }}
          </span>
        </div>

        <!-- ② 被 summary 吸收的那一段。**只有合计** —— 它们模型已经看不到,逐条列出来画的是"我们存了
             什么",而不是模型看到的结构。它们在聊天里**仍然看得见**,所以这里说的是「模型看不到」,
             而不是「界面上没有」—— 两句话意思差很远。 -->
        <div
          v-if="graph.absorbed"
          name="contextGraph__absorbed"
          class="context-graph__absorbed"
        >
          <div class="context-graph__absorbed__title">
            {{
              fill(copy.absorbed, {
                blocks: graph.absorbed.blocks,
                chars: num(graph.absorbed.chars)
              })
            }}
          </div>
          <div class="context-graph__chips">
            <span
              v-for="total in graph.absorbed.byType"
              :key="total.type"
              class="context-graph__chip"
              :style="{ color: inkOf(total.type) }"
            >
              {{ total.type }} {{ total.blocks }}
            </span>
          </div>
          <div class="context-graph__absorbed__note">{{ copy.absorbedNote }}</div>
        </div>

        <!-- ③ 存活的块,按上下文回合分段。 -->
        <div v-if="graph.noHistory" name="contextGraph__empty" class="context-graph__empty">
          {{ copy.noHistory }}
        </div>
        <div
          v-for="group in groups"
          :key="`turn-${group.turn}-${group.blocks[0].i}`"
          name="contextGraph__turn"
          class="context-graph__turn"
        >
          <!-- 回合标题**吸顶**:一个回合里可能有十几块工具往返,滚到中间时"我在第几轮"不该消失。 -->
          <div class="context-graph__turn__head">
            <span class="context-graph__turn__label">
              {{ fill(copy.turn, { n: group.turn }) }}
            </span>
            <span class="context-graph__turn__chars">{{ num(group.chars) }}</span>
          </div>
          <div class="context-graph__blocks">
            <!-- 可点 = `button`,不可点 = `div`:连按钮语义都不给,读屏器也不会念出一个点不动的按钮。 -->
            <component
              :is="block.messageId ? 'button' : 'div'"
              v-for="block in group.blocks"
              :key="block.i"
              :type="block.messageId ? 'button' : undefined"
              name="contextGraph__block"
              class="context-graph__block"
              :class="
                block.messageId ? 'context-graph__block--linked' : 'context-graph__block--locked'
              "
              :title="block.messageId ? copy.jump : lockLabelOf(block)"
              @click="jump(block)"
            >
              <span
                class="context-graph__block__rail"
                :style="{ background: inkOf(block.type) }"
              ></span>
              <span class="context-graph__block__head">
                <span class="context-graph__block__type" :style="{ color: inkOf(block.type) }">
                  {{ block.type }}
                </span>
                <span v-if="block.tool" class="context-graph__block__tool">{{ block.tool }}</span>
                <span class="context-graph__block__chars">{{ num(block.chars) }}</span>
                <IconCornerDownRight
                  v-if="block.messageId"
                  :size="11"
                  stroke="1.8"
                  class="context-graph__block__icon"
                />
                <IconLock v-else :size="10" stroke="1.8" class="context-graph__block__icon" />
              </span>
              <span class="context-graph__block__meter">
                <span
                  class="context-graph__block__fill"
                  :style="{ width: widthOf(block.chars), background: inkOf(block.type) }"
                ></span>
              </span>
              <span v-if="block.preview" class="context-graph__block__preview">
                {{ block.preview }}
              </span>
              <span v-if="!block.messageId" class="context-graph__block__note">
                {{ lockLabelOf(block) }}
              </span>
            </component>
          </div>
        </div>

        <!-- ④ 这一次 send 会**追加**的东西 —— 还没进上下文,所以也不可点。
             它复用 `__block` 的那套行内元素(色轨 / 类型名 / 字符数),因为它就是一个块;
             只是底色换成实色淡蓝,与吸收段的斜纹构成反义。 -->
        <div
          v-if="hasPending"
          name="contextGraph__pending"
          class="context-graph__block context-graph__block--pending"
        >
          <span
            class="context-graph__block__rail"
            :style="{ background: inkOf('pending') }"
          ></span>
          <div class="context-graph__block__head">
            <span class="context-graph__block__type" :style="{ color: inkOf('pending') }">
              {{ copy.pending }}
            </span>
            <span class="context-graph__block__chars">{{ num(graph.pending.chars) }}</span>
            <IconLock :size="10" stroke="1.8" class="context-graph__block__icon" />
          </div>
          <div v-if="graph.pending.workspace" class="context-graph__pending-row">
            {{ copy.workspace }} · {{ graph.pending.workspace }}
          </div>
          <div v-if="graph.pending.attachments?.length" class="context-graph__chips">
            <span
              v-for="path in graph.pending.attachments"
              :key="path"
              class="context-graph__chip"
              :title="path"
            >
              {{ baseName(path) }}
            </span>
          </div>
          <div v-if="graph.pending.draft" class="context-graph__pending-draft">
            {{ graph.pending.draft }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
