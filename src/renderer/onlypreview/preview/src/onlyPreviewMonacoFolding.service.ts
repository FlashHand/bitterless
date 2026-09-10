// 结构化文本(JSON/XML/YAML)预览的折叠策略(docs/plan/tasks/onlypreview-structured-text-folding-172.md)。
//
// 这个模块**故意没有 import**:`node --test` 直接加载它做断言,不需要打包器。
// 折叠开关与「默认展开几层」是产品决定,不是 Monaco 的默认值 —— 所以单独放一处,两仓逐字节相同。

/** 分类器(`onlyPreviewClassifier.service.ts` 的 `LANGUAGE_BY_EXTENSION`)给出的语言 id。 */
export const ONLY_PREVIEW_FOLDING_LANGUAGES: ReadonlySet<string> = new Set([
  'json',
  'json5',
  'xml',
  'yaml'
]);

/** 打开时保持展开的嵌套层数;更深的块起始就是折起来的。Ral 2026-09-10:「默认最多预览 5 层」。 */
export const ONLY_PREVIEW_FOLDING_VISIBLE_LEVELS = 5;

/**
 * Monaco 0.52 只注册了 `editor.foldLevel1`…`editor.foldLevel7`(`contrib/folding/browser/folding.js`
 * 里 `for (let i = 1; i <= 7; i++)`)。层级从 1 数起,1 = 最外层块。
 */
export const ONLY_PREVIEW_FOLDING_MAX_ACTION_LEVEL = 7;

export interface OnlyPreviewMonacoFoldingPlan {
  /** 传给 `monaco.editor.create` 的 `folding`。其它语言保持无折叠槽的现状。 */
  folding: boolean;
  /** 建好编辑器后要跑的 Monaco action id;`null` = 不做默认折叠。 */
  collapseActionId: string | null;
}

/** 「默认最多预览 N 层」= 把第 N+1 层折起来:更深的内容随之隐藏。 */
export const onlyPreviewFoldLevelActionId = (level: number): string => `editor.foldLevel${level}`;

export const resolveOnlyPreviewMonacoFolding = (
  language: string | null | undefined
): OnlyPreviewMonacoFoldingPlan => {
  const id = (language ?? '').trim().toLowerCase();
  if (!ONLY_PREVIEW_FOLDING_LANGUAGES.has(id)) return { folding: false, collapseActionId: null };
  const collapseLevel = ONLY_PREVIEW_FOLDING_VISIBLE_LEVELS + 1;
  return {
    folding: true,
    collapseActionId:
      collapseLevel <= ONLY_PREVIEW_FOLDING_MAX_ACTION_LEVEL
        ? onlyPreviewFoldLevelActionId(collapseLevel)
        : null
  };
};
