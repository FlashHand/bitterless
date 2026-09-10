/**
 * 地址栏里那一串是不是一条**本机绝对路径** —— 也就是「该交给 OnlyPreview 而不是网页引擎」的
 * 那个判据(Ral 2026-09-09:「先判断是不是 win/mac 的绝对路径然后判断文件是否存在」)。
 *
 * **为什么住在 vendored 的 shared 面**:两个 app 的地址栏都要问同一个问题(bitterless 的 maestro
 * 顶栏、micromeet-cowork 的 home 顶栏),但它们的导航实现毫无共同祖先 —— 一个 `normalizeUrl` 直
 * 接补 scheme,一个还带搜索兜底。判据要是各写一份,两份正则会各自演化,而**差异不会以任何形式报错**:
 * 一边能打开的路径另一边被拿去搜索,只能靠人肉发现。`src/shared/onlypreview/` 是两仓逐字节等同
 * 的那一面,放在这里 = 一份定义 ＋ 漂移可机检。
 *
 * 这里**只有纯判据,不碰文件系统** —— 本目录的东西渲染进程也在 import,一个 `node:fs` 会把它变成
 * 一颗地雷。「文件在不在」以及「不在时给哪个 `file://`」是各仓 main 侧自己的事(它们的落点本来
 * 就不同:bitterless 落 OnlyPreview 独立窗口,cowork 落 mini-app tab)。
 */

/**
 * POSIX 绝对路径 —— `/` 开头,**第二个字符不是 `/`**。
 *
 * 排除 `//` 是为了不动既有行为:`//example.com`(协议相对写法)既不是本机路径,也不是地址栏该
 * 补 scheme 的东西。排除单独一个 `/` 同理 —— 那是根目录,但作为地址栏输入更可能是手滑。
 */
const POSIX_ABSOLUTE_PATH = /^\/[^/]/;

/**
 * Windows 绝对路径 —— 盘符(`C:\x` / `C:/x`)与 UNC(`\\server\share`)。
 *
 * **盘符后面必须跟分隔符。** 少了这一条,`c:8080`(单标签主机 ＋ 端口,内网 dev server 的常见
 * 写法)会被读成 C 盘 —— 那是一条真地址被判成一个不存在的文件。
 */
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\])/;

/**
 * 这一串是不是一条本机绝对路径。
 *
 * 两个平台的形状都认,不管当前跑在哪个平台上 —— 判据是「输入长什么样」,不是「本机能不能解析」。
 * 一条 Windows 路径贴进 mac 上的地址栏,正确结果是「这个文件不存在」,而不是把它拿去搜索引擎搜。
 */
export const isAbsoluteFilePath = (input: string): boolean => {
  const value = (input || '').trim();
  if (!value) return false;
  return POSIX_ABSOLUTE_PATH.test(value) || WINDOWS_ABSOLUTE_PATH.test(value);
};

/**
 * 一条绝对路径的 `file://` 写法 —— **地址栏显示用的那一行**
 * (Ral 2026-09-10:「我只是希望 url 上显示 file:// …只要看起来像真实浏览器就好」)。
 *
 * **不用 `node:url` 的 `pathToFileURL`。** 本目录的东西渲染进程也 import(文件头那段注释),
 * 而 `node:url` 和 `node:fs` 一样是 node-only —— 一个 import 就把这一面变成地雷。
 *
 * **保留百分号编码,不解码。** 他要的就是"看起来像真实浏览器",而 Chrome 的地址栏对 `file://`
 * 里的空格显示的正是 `%20`。顺带这也让这一行能被原样敲回去(见 `resolveAddressBarLocalPath`)。
 *
 * 逐段编码,而不是整串 `encodeURI`:后者会放过 `#` 和 `?`,而一个叫 `a#b.md` 的文件那样编出来会在
 * `#` 处被截断 —— 那是一条**指向别的文件**的 URL,不是一条难看的 URL。
 *
 * 也**不是** `encodeURIComponent`:它把 `+` `&` `,` `:` `;` `=` `@` `$` 也编掉,而浏览器和
 * `node:url` 的 `pathToFileURL` 都原样留着。一个叫 `a+b` 的目录显示成 `a%2Bb` 就不像真实浏览器了,
 * 而"像真实浏览器"正是这条需求本身。所以安全字符集照 `pathToFileURL` 的实际行为来
 * (测试里直接拿它当参照 oracle),唯一要单独处理的是 `~` —— `encodeURIComponent` 放过它,node 编它。
 */
const FILE_URL_SAFE_CHARACTER = /^[A-Za-z0-9!$&'()*+,\-.:;=@_]$/;

const encodeFileUrlCharacter = (character: string): string =>
  character === '~' ? '%7E' : encodeURIComponent(character);

/** 一段路径的百分号编码。`for...of` 按**码位**迭代,所以代理对(emoji)不会被拆坏。 */
const encodeFileUrlSegment = (segment: string): string => {
  let encoded = '';
  for (const character of segment) {
    encoded += FILE_URL_SAFE_CHARACTER.test(character)
      ? character
      : encodeFileUrlCharacter(character);
  }
  return encoded;
};

export const toLocalFileUrl = (absolutePath: string): string => {
  const value = (absolutePath || '').trim();
  if (!isAbsoluteFilePath(value)) return '';
  // UNC(`\\server\share`)→ `file://server/share`:两个反斜杠对应 authority,不是路径的一部分。
  const unc = /^\\\\([^\\]+)\\?(.*)$/.exec(value);
  if (unc) {
    const authority = encodeFileUrlSegment(unc[1] ?? '');
    const rest = (unc[2] ?? '').split(/[\\/]+/).filter(Boolean).map(encodeFileUrlSegment).join('/');
    return `file://${authority}${rest ? `/${rest}` : ''}`;
  }
  const windows = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  if (windows) {
    const rest = (windows[2] ?? '').split(/[\\/]+/).filter(Boolean).map(encodeFileUrlSegment).join('/');
    return `file:///${windows[1]}:${rest ? `/${rest}` : '/'}`;
  }
  const segments = value.split('/').filter(Boolean).map(encodeFileUrlSegment).join('/');
  return `file:///${segments}`;
};

/**
 * 地址栏那一串对应的**本机绝对路径**,`null` = 不是本机路径。裸路径和 `file://` 两种写法都认。
 *
 * **为什么必须认 `file://`。** 一旦地址栏显示成 `file:///…`,人按一下回车就该回到同一个文件。
 * 只认裸路径的话那次回车会落到 `normalizeUrl`,Chromium 在普通 tab 里直接加载那条 URL ——
 * 一个 `.csv` 变成原始文本,而不是回到 OnlyPreview。**显示成什么就必须能被敲回去**,这是
 * "显示 file://" 这条需求的承重部分而不是附带
 * (`docs/features/onlypreview-address-bar-shows-file-url.md`)。
 *
 * **带 authority 的一律读成 UNC** —— `file://server/share/x` → `\\server\share\x`,`server` 是
 * 什么名字不影响这个判断(`file://example.com/x` 同理)。这不是放宽面:裸的 `\\server\share` 本来
 * 就被上面的 `isAbsoluteFilePath` 认,而"认"只是分类,接下来调用方还要查存在性 —— 在 mac 上一条
 * UNC 一定不存在,于是落 `missing`,由 Chromium 出它自己的错误页。UNC 这一支是必须的:少了它
 * Windows 上那条往返就断了。`file://localhost/x` 按标准等价于 `file:///x`。
 */
export const resolveAddressBarLocalPath = (input: string): string | null => {
  const value = (input || '').trim();
  if (!value) return null;
  if (isAbsoluteFilePath(value)) return value;
  const match = /^file:\/\/([^/]*)(\/.*)?$/i.exec(value);
  if (!match) return null;
  const authority = match[1] ?? '';
  const rest = match[2] ?? '';
  const decode = (segment: string): string | null => {
    try {
      return decodeURIComponent(segment);
    } catch {
      // 坏的百分号序列(`%zz`)—— 当成"不是本机路径",而不是把原样那一串当路径:
      // 后者会拿一条我们没读懂的东西去碰文件系统。
      return null;
    }
  };
  const segments: string[] = [];
  for (const segment of rest.split('/')) {
    if (!segment) continue;
    const decoded = decode(segment);
    if (decoded === null) return null;
    segments.push(decoded);
  }
  if (authority) {
    // `file://server/share/x` → `\\server\share\x`
    const host = decode(authority);
    if (host === null || host.toLowerCase() === 'localhost') {
      // `file://localhost/x` 是本机的合法写法,等价于 `file:///x`
      return host === null ? null : `/${segments.join('/')}`;
    }
    return `\\\\${host}${segments.length ? `\\${segments.join('\\')}` : ''}`;
  }
  const first = segments[0] ?? '';
  // `file:///C:/x` → `C:\x`
  if (/^[A-Za-z]:$/.test(first)) {
    return `${first}${segments.length > 1 ? `\\${segments.slice(1).join('\\')}` : '\\'}`;
  }
  if (!segments.length) return null;
  return `/${segments.join('/')}`;
};
