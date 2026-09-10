// AI-CRMS 退役后留在隐藏 sqlite 窗口 renderer localStorage 里的登录态。
//
// Sunset: 2026-12-31 — 见 docs/features/maestro-crms-retirement.md #6.9
// 到期删除的账:docs/issues/maestro-crms-residue-cleanup-sunset.md
//
// 这四个键是那枚 CRMS JWT 的原始落盘点,原来由 MaestroSessionDao 写。DAO 随 provider 一起删了,
// 于是 main 侧再也够不着它们 —— 它们落在这个隐藏窗口 partition 的 LevelDB 里,只有这个 preload
// 执行得到。所以清理只能放在这里,而且刻意**不注册任何 XPC 通道**:它不是服务,是一次性清理。
//
// 没有 marker 门控:四次 removeItem 比读一次 marker 还便宜,也不会留下一个 sunset 时还要再清
// 一遍的键。removeItem 对不存在的键是 no-op,重复执行安全。

// preload 的 tsconfig 不带 DOM lib;沿用原 session.dao 的本地声明。
declare const localStorage: {
  removeItem(key: string): void
}

// 键名与原 `session.api.ts` 一致:mtk = JWT 明文,crms.workspaceId = 租户 id,
// crms.region = 区域,mtk.ts = 写入时间戳。region 当年是「UI 偏好,不是凭据」所以 clearSession
// 故意留着,provider 退役之后它也成了孤儿 —— 四个一起清。
const CRMS_SESSION_KEYS = ['mtk', 'crms.workspaceId', 'crms.region', 'mtk.ts']

export const clearCrmsSessionResidue = (): void => {
  for (const key of CRMS_SESSION_KEYS) localStorage.removeItem(key)
}
