/**
 * OnlyPreview 上次是以 **tab** 还是 **独立窗口** 打开的 —— 下次按上次那样开。
 *
 * Ral 2026-09-09：「切到独立窗口打开的状态应该持久化 …… 如果上次 tab 打开，下次也是 tab 打开；
 * 如果上次是窗口打开下次也应该是窗口，且复用上次的位置」。**位置/尺寸/所在屏幕本来就已经持久化了**
 * (`windowStateService` 的 `'onlypreview'` 键,和 `omni` 同一套,`resolve()` 会按当前屏幕集校验),
 * 缺的只有「哪一种承载」这一位。
 *
 * **为什么单开一个键,而不是加进 `OnlyPreviewSettings`。** 那个对象的 parser 是严格的:未知字段抛错、
 * 每个字段必填。往里加一个字段,所有**已存**的记录都会解析失败 —— 读路径会兜住并回落默认值,
 * 于是每个人的 OnlyPreview 设置被静默重置一次。为一个不面向用户的状态位付这个代价不值得。
 * 而这个状态位也确实不属于那个对象:它是"上次的界面状态",和窗口位置同类,不是一条偏好。
 *
 * 存储的就绪等待照抄 `onlyPreviewSettings.service.ts` —— bitterless 那张表住在一个隐藏 sqlite
 * 渲染进程里,启动早期它还没起来。等不到就当没有记录(落默认),**不抛**:一个状态位读不到不该让
 * 「打开 OnlyPreview」这件事失败。
 */
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { SettingDao, SettingStoredValue } from '@preload/sqlite/dao/setting.dao';

/** 承载类型的**人话**形式。内部的 mount kind 是 `'standalone' | 'cowork'`,在边界上映射。 */
export type OnlyPreviewHostMountPreference = 'tab' | 'window';

const HOST_MOUNT_KEY = 'onlypreview_host';
const HOST_MOUNT_SUB_KEY = 'mount';
/** 默认 tab —— 工作区芯片一直是开 tab 的(mini-016),没有记录时就该保持那个行为。 */
const DEFAULT_HOST_MOUNT: OnlyPreviewHostMountPreference = 'tab';
const STORAGE_RETRY_ATTEMPTS = 26;
const STORAGE_RETRY_INTERVAL_MS = 200;

const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

const waitForStorage = async <T>(
  operation: () => Promise<T>,
  isReady: (value: T) => boolean
): Promise<T> => {
  let value = await operation();
  for (let attempt = 1; attempt < STORAGE_RETRY_ATTEMPTS && !isReady(value); attempt += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, STORAGE_RETRY_INTERVAL_MS);
    });
    value = await operation();
  }
  return value;
};

/** 认识的两个值之外的一切都当默认 —— 存坏了不该把 OnlyPreview 打不开。 */
const parseHostMount = (value: unknown): OnlyPreviewHostMountPreference =>
  value === 'window' || value === 'tab' ? value : DEFAULT_HOST_MOUNT;

/**
 * 内存里的那一份。
 *
 * **它的存在是为了让打开路径不必 await。** 「点工作区芯片 → 出现 OnlyPreview」这条路上多插一次
 * 存储读,在 bitterless 上最坏是 `waitForStorage` 的 26×200ms —— 芯片会像卡住。所以带就绪等待的
 * 那次读只发生在**启动预热**里(那时没人在等界面),打开路径读的是这一份。
 */
let cachedHostMount: OnlyPreviewHostMountPreference | null = null;

const readStoredHostMount = async (
  wait: boolean
): Promise<OnlyPreviewHostMountPreference | null> => {
  try {
    const fetch = async (): Promise<SettingStoredValue | null> =>
      (await settingEmitter.getStored({
        key: HOST_MOUNT_KEY,
        sub_key: HOST_MOUNT_SUB_KEY
      })) ?? null;
    const stored = wait
      ? await waitForStorage<SettingStoredValue | null>(fetch, (value) => value !== null)
      : await fetch();
    if (!stored) return null;
    if (!stored.exists || !stored.valid) return DEFAULT_HOST_MOUNT;
    return parseHostMount(stored.value);
  } catch {
    return null;
  }
};

/**
 * 启动时预热(带就绪等待)。**不 await、不抛** —— 预热失败只该让第一次打开落默认。
 *
 * 调用点紧挨着 `onlyPreviewSettingsService.hydrateFromStorage()`:同一个存储、同一个时机。
 */
export const hydrateOnlyPreviewHostMount = async (): Promise<void> => {
  const stored = await readStoredHostMount(true);
  if (stored && !cachedHostMount) cachedHostMount = stored;
};

/**
 * 打开路径用这个 —— **已预热就同步返回**,`null` 表示还不知道。
 *
 * 返回 `null` 而不是直接给默认值,是为了让调用方能区分「上次确实是 tab」和「还没读到」。
 * 目前两个调用方对这两种情形做同一件事(开 tab),但把它们混成一个值就再也分不开了。
 */
export const peekOnlyPreviewHostMount = (): OnlyPreviewHostMountPreference | null =>
  cachedHostMount;

/** 预热还没完成时的兜底读:**一次,不重试** —— 绝不为一个状态位卡住界面。 */
export const readOnlyPreviewHostMount = async (): Promise<OnlyPreviewHostMountPreference> => {
  const known = cachedHostMount;
  if (known) return known;
  const stored = await readStoredHostMount(false);
  if (stored) cachedHostMount = stored;
  return stored ?? DEFAULT_HOST_MOUNT;
};

/**
 * 清掉内存那一份。
 *
 * 和 `onlyPreviewSettingsService.clearCache()` 同一个理由:一个只写不清的进程级缓存,在测试里会让
 * 用例互相污染,在运行时也没有任何办法让它重新读一次。目前只有测试用到。
 */
export const clearOnlyPreviewHostMountCache = (): void => {
  cachedHostMount = null;
};

/**
 * 记下这一次落在哪一种承载上。
 *
 * **不 await、不抛。** 调用点是 host toggle 结算之后 —— 那时切换已经成功了,一次写不进去只该
 * 影响"下次默认开哪种",不该把一次成功的切换报成失败。
 */
export const rememberOnlyPreviewHostMount = (kind: OnlyPreviewHostMountPreference): void => {
  // 先更内存那一份 —— 下一次打开立刻按新的来,不等落盘。
  cachedHostMount = kind;
  void (async () => {
    try {
      await settingEmitter.upsert({
        key: HOST_MOUNT_KEY,
        sub_key: HOST_MOUNT_SUB_KEY,
        value: kind
      });
    } catch {
      // 存不下就算了 —— 见上面那段注释。
    }
  })();
};
