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
