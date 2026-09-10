/**
 * 从一份 pi 凭据里读出**身份**(哪个账号、什么套餐、什么时候过期)—— 只为把报错说成人话。
 *
 * 为什么需要它:在此之前,应用对"登录着哪个账号"一无所知(`docs/issues/codex-connected-account-not-identified.md`,
 * 2026-08-20 就受理了)。于是一台机器上 CLI 登的是 A、应用登的是 B 时,界面与报错都说不出这件事,
 * 而两者在 UI 上完全一样 —— 报上来的抱怨就是「我明明登录成功了」。
 *
 * 三条纪律:
 * · **只解码,不校验。** 这不是鉴权,是显示;签名由服务端管,这里读错了最坏结果是少说一句话。
 * · **永不返回 token 本体。** 返回值里只有 email / 套餐 / 过期时间,调用方因此不可能把它打进日志。
 * · **绝不抛。** 凭据形状是外部数据(pi 的,而且会变);任何一步失败就当"读不出来",
 *   诊断退回到没有身份的版本,而不是把一次登录失败升级成一个崩溃。
 */

export interface CredentialIdentity {
  /** ChatGPT 账号邮箱(读不出就没有)。 */
  account?: string;
  /** `pro` / `plus` / … —— 套餐类型,用来解释"这个号能不能用 Codex"。 */
  plan?: string;
  /** `expires`(毫秒)转成的本地时间串;没有这个字段就没有。 */
  expiresAt?: string;
  /** 已过期。**注意**:pi 的 `checkProviderAuth` 从不看 `expires`,所以"已连接"对过期 token 也为真。 */
  expired?: boolean;
  /** 凭据类型(`oauth` / `api` …)。 */
  type?: string;
}

/** JWT 的 payload 段 —— base64url,可能没有 padding。失败就回 null,绝不抛。 */
const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * OpenAI 把这些声明放在带命名空间的键下,而且**嵌套与扁平两种形状都出现过**
 * (`{"https://api.openai.com/profile": {email}}` 与 `{"https://api.openai.com/profile.email": …}`),
 * 所以两种都试 —— 只试一种的话,换一版 token 就静默少说一句话。
 */
const claim = (payload: Record<string, unknown>, group: string, key: string): string | undefined => {
  const nested = payload[`https://api.openai.com/${group}`];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const value = (nested as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  const flat = payload[`https://api.openai.com/${group}.${key}`];
  return typeof flat === 'string' ? flat : undefined;
};

export const describeCredentialIdentity = (credential: unknown, now = Date.now()): CredentialIdentity => {
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) return {};
  const record = credential as Record<string, unknown>;
  const identity: CredentialIdentity = {};
  if (typeof record.type === 'string') identity.type = record.type;
  if (typeof record.expires === 'number' && Number.isFinite(record.expires)) {
    identity.expiresAt = new Date(record.expires).toLocaleString();
    identity.expired = record.expires < now;
  }
  const payload = typeof record.access === 'string' ? decodeJwtPayload(record.access) : null;
  if (payload) {
    identity.account = claim(payload, 'profile', 'email');
    identity.plan = claim(payload, 'auth', 'chatgpt_plan_type');
  }
  return identity;
};

/** 一行人话。没有任何可读身份时返回空串 —— 调用方据此决定要不要拼上去。 */
export const formatCredentialIdentity = (identity: CredentialIdentity): string => {
  const parts: string[] = [];
  if (identity.account) parts.push(`account ${identity.account}`);
  if (identity.plan) parts.push(`plan ${identity.plan}`);
  if (identity.expiresAt) parts.push(`${identity.expired ? 'EXPIRED at' : 'expires'} ${identity.expiresAt}`);
  return parts.join(' · ');
};
