import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import test, { describe } from 'node:test';
import { build } from 'esbuild';

const root = resolvePath(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolvePath(root, path), 'utf8');

/**
 * 地址栏吃一条本机绝对路径(Ral 2026-09-09,`docs/features/address-bar-local-path.md`)。
 *
 * 判据本身是两仓共用的那一份(`@shared/onlypreview/onlyPreviewTargetInput`),所以这里两件事都要测:
 * ① 那份判据的边界 —— 它是**两个 app 的地址栏**共同依赖的,判错的代价在两边同时发生;
 * ② 本仓的落点 —— **在** → OnlyPreview 独立窗口,**不在** → 一发 `file://` 让 Chromium 出它自己
 *    的「文件不存在」页。把不存在判成存在,操作者看到的是一个空预览面而不是"文件不存在"。
 */
const compiled = await build({
  stdin: {
    contents: [
      "export { isAbsoluteFilePath } from './src/shared/onlypreview/onlyPreviewTargetInput.ts';",
      "export { resolveLocalPathTarget } from './src/main/maestro/windows/main/localPathTarget.ts';"
    ].join('\n'),
    resolveDir: root
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolvePath(root, 'tsconfig.node.json'),
  external: ['electron']
});
const { isAbsoluteFilePath, resolveLocalPathTarget } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

/** 只认这几条存在 —— 不碰真实文件系统,所以这张表就是"文件系统"。 */
const withExisting = (...paths) => {
  const set = new Set(paths);
  return (path) => set.has(path);
};

const PATHS = [
  '/Users/ral/Documents/projects/overmind/tmp/wecom-markdown-v2-doc.html',
  '/Users/ral/x.pdf',
  '/tmp',
  '/Users/ral/My Documents/a.html',
  '/Users/ral/项目/说明.md',
  'C:\\Users\\ral\\x.html',
  'c:/Users/ral/x.html',
  'D:\\a b\\c.pdf',
  '\\\\server\\share\\x.docx'
];

const NOT_PATHS = [
  '',
  '   ',
  'example.com',
  'https://example.com',
  'file:///Users/ral/x.pdf',
  'localhost:5173',
  // 单字母主机 ＋ 端口:盘符只有在后面跟了分隔符时才是盘符,否则这是一台主机
  'c:8080',
  'cors 怎么配',
  'Users/ral/x.html',
  // 协议相对写法与单独一个斜杠都不算路径
  '//example.com',
  '/',
  '//'
];

describe('isAbsoluteFilePath(两仓共用的判据)', () => {
  test('两个平台的绝对路径都认,不管当前跑在哪个平台', () => {
    for (const value of PATHS) assert.ok(isAbsoluteFilePath(value), value);
  });

  test('地址、搜索词、相对路径都不是绝对路径', () => {
    for (const value of NOT_PATHS) assert.ok(!isAbsoluteFilePath(value), JSON.stringify(value));
  });

  test('带空格的路径算路径 —— 这条是它区别于"有空白就不是地址"的地方', () => {
    assert.ok(isAbsoluteFilePath('/Users/ral/My Documents/a.html'));
    assert.ok(isAbsoluteFilePath('D:\\a b\\c.pdf'));
  });

  test('null / undefined 不抛', () => {
    for (const value of [undefined, null]) assert.equal(isAbsoluteFilePath(value), false);
  });
});

describe('resolveLocalPathTarget', () => {
  test('文件在 → preview,交出去的是归一后的路径', () => {
    // 用 `.docx`:`.html` 现在落的是 `chrome`(普通 tab 自己能渲染),见下面那一组
    assert.deepEqual(resolveLocalPathTarget('/Users/ral/x.docx', withExisting('/Users/ral/x.docx')), {
      kind: 'preview',
      path: '/Users/ral/x.docx'
    });
  });

  test('目录同样是 preview —— OnlyPreview 有正式的 directory adapter', () => {
    assert.equal(
      resolveLocalPathTarget('/Users/ral/Documents', withExisting('/Users/ral/Documents')).kind,
      'preview'
    );
  });

  test('文件不在 → missing,且给的是一个 Chromium 真能吃的 file:// URL', () => {
    const target = resolveLocalPathTarget('/Users/ral/nope.html', withExisting());
    assert.equal(target.kind, 'missing');
    assert.equal(target.fileUrl, 'file:///Users/ral/nope.html');
    assert.equal(new URL(target.fileUrl).protocol, 'file:');
  });

  test('空格与中文进 URL 时被编码,而不是把 URL 截断', () => {
    const target = resolveLocalPathTarget('/Users/ral/My Docs/说明.md', withExisting());
    assert.ok(!target.fileUrl.includes(' '), target.fileUrl);
    assert.equal(decodeURIComponent(new URL(target.fileUrl).pathname), '/Users/ral/My Docs/说明.md');
  });

  test('归一在存在性判断之前 —— `..` 与重复斜杠不该让一个真文件被判成不存在', () => {
    const exists = withExisting('/Users/ral/x.html');
    assert.equal(resolveLocalPathTarget('/Users/ral/sub/../x.html', exists).kind, 'chrome');
    assert.equal(resolveLocalPathTarget('/Users//ral///x.html', exists).kind, 'chrome');
  });

  test('mac 上的 Windows 路径落 missing,不落 preview', () => {
    assert.equal(resolveLocalPathTarget('C:\\Users\\ral\\x.html', withExisting()).kind, 'missing');
  });

  test('不是绝对路径 → missing 且 fileUrl 为空串(调用方的 `if (!target) return` 吞掉)', () => {
    // **这一条守着一个静默缺陷**:`resolve('')` 是当前工作目录,而它一定存在 —— 少了前置判断,
    // 空输入会变成"预览 cwd"。所以这里的 exists 故意说"什么都在"。
    const everythingExists = () => true;
    for (const value of ['', '   ', 'example.com', 'Users/ral/x.html']) {
      assert.deepEqual(
        resolveLocalPathTarget(value, everythingExists),
        { kind: 'missing', fileUrl: '' },
        JSON.stringify(value)
      );
    }
  });

  test('默认用真实的 existsSync', () => {
    assert.equal(resolveLocalPathTarget(resolvePath(root, 'package.json')).kind, 'preview');
    assert.equal(resolveLocalPathTarget(resolvePath(root, 'no-such-file-ea91.json')).kind, 'missing');
  });
});

/** maestro 那一侧的接线。 */
describe('maestro navigate 的 path 分支', () => {
  const source = read('src/main/maestro/windows/main/maestroBrowserView.service.ts');
  const navigate = source.slice(
    source.indexOf('async navigate('),
    source.indexOf('async reload(')
  );

  test('存在的路径交给 OnlyPreview 并就地 return(不再落一发网页加载)', () => {
    assert.match(navigate, /local\.kind === 'preview'/);
    assert.match(navigate, /openOnlyPreviewAbsoluteTarget\(local\.path\)[\s\S]{0,40}return/);
  });

  test('路径那一支不过 normalizeUrl —— 否则被补成 https:///Users/…', () => {
    assert.match(navigate, /isLocalPath \? localFileUrl : normalizeUrl\(params\.url\)/);
  });

  test('判据用共用的那一份,不在本文件里重写正则', () => {
    assert.match(source, /import \{ isAbsoluteFilePath \} from '@shared\/onlypreview\/onlyPreviewTargetInput'/);
    assert.doesNotMatch(navigate, /\[A-Za-z\]:/, 'navigate 里出现盘符正则 = 判据被复制了一份');
  });
});

/**
 * 第三个落点:**普通 tab 自己就能渲染** 的本机文件(Ral 2026-09-09:「这个文件不会进入 onlypreview
 * 的预览,而是 new tab 打开一个页面去单独预览」)。
 *
 * 判错两边都有代价:该进 tab 的进了 OnlyPreview = 他明确不要的行为;该进预览面的落到 `file://` =
 * docx 会被浏览器**下载**下来,markdown 会变成一坨没渲染的纯文本。
 */
describe('普通 tab 能自己渲染的那一类', () => {
  const exists = () => true;

  test('Ral 的那个 PDF 落 chrome,在 tab 里加载,不进 OnlyPreview', () => {
    const target = resolveLocalPathTarget(
      '/Users/ral/Downloads/NOTE_voice_scribe_regional_language_2026-09-08.pdf',
      exists
    );
    assert.equal(target.kind, 'chrome');
    assert.equal(new URL(target.fileUrl).protocol, 'file:');
  });

  test('pdf / 图片 / 音视频 / html 都落 chrome', () => {
    for (const path of ['/x/a.pdf', '/x/a.png', '/x/a.jpg', '/x/a.mp3', '/x/a.mp4', '/x/a.html', '/x/a.htm']) {
      assert.equal(resolveLocalPathTarget(path, exists).kind, 'chrome', path);
    }
  });

  test('需要预览组件的仍落 preview —— 落 chrome 会变成"下载"或"没渲染的纯文本"', () => {
    for (const path of ['/x/a.docx', '/x/a.xlsx', '/x/a.pptx', '/x/a.drawio', '/x/a.md', '/x/a.ts', '/x/a.json']) {
      assert.equal(resolveLocalPathTarget(path, exists).kind, 'preview', path);
    }
  });

  test('目录落 preview —— 普通 WebContents 只会给一个文件列表', () => {
    assert.equal(resolveLocalPathTarget('/Users/ral/Documents', exists).kind, 'preview');
  });

  test('不存在优先于格式判定 —— 一个不存在的 pdf 是 missing,不是 chrome', () => {
    assert.equal(resolveLocalPathTarget('/x/nope.pdf', () => false).kind, 'missing');
  });
});
