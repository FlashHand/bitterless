import type { ChatErrorCard } from './message.type'

/**
 * 时间线错误卡的**唯一构造入口**（Ral 2026-09-10：「需要统一的返回 error 的函数封装」）。
 *
 * 为什么必须只有一个入口:失败路径不止一条(投递抛错、main 返回 `ok:false`、工具执行失败、
 * 跨进程克隆失败…)。每条各自拼一张卡的结果是三种不一致 —— 标题有的带 `Error:` 前缀有的不带、
 * 副标题有时是阶段名有时是整句话、全文有时被 `String(err)` 吃掉栈。而错误卡的全部价值就在于
 * **一眼认出是什么、在哪一步**,不一致就等于没有。
 *
 * 三层的分工是刻意的:
 *  · `title`    —— **一行**,回答"是什么坏了"。取第一行并裁到 120 字,不带前缀噪声;
 *  · `subtitle` —— **一行**,回答"在哪一步"。由调用方给(它才知道自己是哪一步);
 *  · `detail`   —— 全文,含 `name` 与栈。只在弹窗里显示 —— 几十行栈铺在时间线上会把上下文顶掉。
 */

/** 一行的上限。超过就裁 —— 卡片上标题与副标题各自只有一行的位置。 */
const ONE_LINE_LIMIT = 120

const oneLine = (value: string): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > ONE_LINE_LIMIT ? `${collapsed.slice(0, ONE_LINE_LIMIT - 1)}…` : collapsed
}

/**
 * 把任何抛出来的东西正规化成全文。
 *
 * `String(err)` 对 Error 只给 `name: message`，**栈会丢**。而错误卡存在的理由之一就是
 * "点开能看全" —— 丢了栈就退化成一行红字，跟修好之前没区别。
 */
const detailOf = (err: unknown): string => {
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`
    const cause = err.cause !== undefined ? `\n\nCaused by: ${detailOf(err.cause)}` : ''
    return err.stack ? `${err.stack}${cause}` : `${head}${cause}`
  }
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err, null, 2)
  } catch {
    return String(err)
  }
}

/** 标题:第一行、去掉 `Error:` / `TypeError:` 这类前缀噪声(它已经由 name 表达了)。 */
const titleOf = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const firstLine = raw.split('\n')[0] || ''
  const stripped = firstLine.replace(/^\s*[A-Za-z_$][\w$]*Error\s*:\s*/, '').trim()
  return oneLine(stripped || firstLine || String(err))
}

/**
 * 构造一张错误卡。**所有失败路径都走这里。**
 *
 * @param err       抛出来的东西（Error / string / 任意值）
 * @param options.subtitle  这一步是什么（调用方给 —— 只有它知道自己是哪一步）
 * @param options.title     覆盖标题；不给就从 `err` 推
 */
export const buildErrorCard = (
  err: unknown,
  options: { subtitle?: string; title?: string } = {}
): ChatErrorCard => {
  const detail = detailOf(err)
  return {
    title: oneLine(options.title || titleOf(err)) || 'Unknown error',
    subtitle: options.subtitle ? oneLine(options.subtitle) : undefined,
    // 全文不裁 —— 弹窗自己滚。裁全文等于把"点开能看全"这件事取消掉。
    detail
  }
}
