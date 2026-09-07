# `yarn typecheck:node` 是假绿 —— 它一条类型都不检查

`status: root-caused`
`reported: 2026-09-07 (Ral：「调整 check 方式，这样全量 check 没意义」)`

## 现象

`yarn typecheck:node` 一直是绿的。它检查不出任何类型错误 —— **包括必填字段漏了这种错误**。

```jsonc
// package.json:18
"typecheck:node": "tsc --noEmit --noCheck -p tsconfig.node.json --composite false"
//                              ^^^^^^^^^ 只解析，不做类型检查
```

`--noCheck` 让 tsc 建好 program 就退出。语法错误还报，类型错误一条不报。所以这个脚本
回答的是「这些文件能不能被解析」，不是「类型对不对」，而它的名字和退出码都在宣称后者。

## 为什么没人发现

去掉 `--noCheck` 之后并不会变红 —— 它**崩溃**：

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed
             - JavaScript heap out of memory
```

崩溃发生在 tsc 打印任何错误之前，而崩溃输出里不含 `error TS` 字样。所以任何
`grep -c 'error TS'` 式的计数会得到 **0**，和「零错误」在形态上完全一致。
`--max-old-space-size=12288` 也一样崩。这就是 2026-09-07 上午那个「bitterless 用真检查
跑出 0 错误」的结论 —— 它是崩溃产生的，不是检查产生的，**已作废**。

## 根因：两个文件把类型检查器打爆，不是项目太大

按面逐个实测（每个面一个独立子进程，内存不累积）：

| 面 | OOM | 错误数 | 秒 |
| --- | --- | --- | --- |
| `src/main/**` ＋ `src/shared/**` | 否 | 69 | 5.9 |
| `src/shared/**` | 否 | 4 | 1.6 |
| `src/main/onlypreview` ＋ `src/main/fileSearch` | 否 | 27 | 1.5 |
| `src/main/maestro/**` | 否 | 30 | 2.9 |
| `src/preload/onlypreview` ＋ `src/preload/fileSearch` | 否 | 4 | 1.4 |
| **`src/preload/**`** | **是** | — | 83 |
| `src/preload/sqlite/**`（48 文件 9584 行） | 是 | — | 83 |
| **`src/preload/base/**`（23 文件 2480 行）** | **是** | — | 82 |

`main` 全量只要 5.9 秒，而 2480 行的 `preload/base` 就能打爆 —— 所以**不是规模问题**。
在 `preload/base` 里逐文件二分（每个文件单独作为 include，依赖自然带入）：

| 文件 | OOM | 秒 |
| --- | --- | --- |
| **`langGraph/langGraph.helper.ts`**（7548 字节） | **是** | 81 |
| **`langGraph/defaultSkills/skill.registry.ts`**（1371 字节） | **是** | 81 |
| `langGraph/defaultSkills/*.skill.ts`（5 个） | 否 | 12.6 – 13.8 |
| 其余 16 个文件 | 否 | 0.6 – 1.6 |

**两个文件**。而且旁证很清楚：引用它们的 5 个 `*.skill.ts` 单文件检查要 13 秒（基线 0.7 秒，
慢 18 倍），说明代价来自 LangGraph 的泛型实例化，沿 import 传染。

## 这个假绿藏住了什么

只在 onlypreview ＋ fileSearch 这一小块定域检查（363 文件，1.5 秒），就有 **30 条**。
其中一批与严格度开关**无关** —— 也就是说不是「cowork 更严格才报」，本仓自己就有：

| 错误 | 处 | 位置 |
| --- | --- | --- |
| `TS2741` 漏必填字段 `projectIndexState` | 3 | `main/onlypreview/views/onlyPreviewPreviewRegion.service.ts` 234 / 272 / 649 |
| `TS2741` 漏必填字段（其他） | 2 | 同上文件族 |
| `TS1360` `Record<OnlyPreviewPreviewAdapterId, …>` 漏 `directory` 键 | 1 | `shared/onlypreview/onlyPreviewFind.registry.ts:27` |
| `TS2322` `'directory'` 不可赋给 `never` | 1 | `main/onlypreview/views/onlyPreviewPreviewView.service.ts:232` |
| `TS2556` spread 实参不是 tuple | 4 | `main/windows/onlyPreviewWindow.helper.ts` 642 / 677 / 705 / 741 |

`projectIndexState` 是 `OnlyPreviewPreviewPresentation` 的**必填**字段
（`shared/onlypreview/onlyPreview.types.ts:439`，类型 `OnlyPreviewProjectIndexState | null`），
三个构造点没给 —— 运行时那里是 `undefined`，不是声明的 `null`。区分这两者的读取方、或者
把它序列化过 IPC 的地方，拿到的形状与声明不符。

`TS2741` **不受 `strictNullChecks` 影响**（实测：`--strict` 与 `--strict false` 都报），
所以这三条与本仓 `strict: false` 的选择无关，是真缺陷。最后那条 `directory`
（TS1360 ＋ TS2322）大概率是同一个根因：适配器表少了一个成员，于是下游那个位置的联合被
收窄成 `never`。

## 修法

**按面拆开，每面一个独立进程，顺序跑** —— Ral 2026-09-07：「不如 main 单独 check
不同的 renderer 单独 check 都分开，免得一次性 oom」。理由不止是内存：

1. 单面 1.5 秒的反馈，比全量几分钟可用得多。
2. 一个面爆掉不会让其他面的结果消失。
3. 上面那张表本身就是产出 —— 哪个面有多少条错误，比一个总数有信息量。

`langGraph` 那两个文件必须**显式隔离并写明原因**，不能靠 `--noCheck` 无声地跳过全部。
真正的修复是消掉那处泛型爆炸；在那之前，隔离范围要写在配置里可见。

**不要**用「全局 `--noCheck`」或「全局放宽 strict」来换绿：前者是本 issue 本身，后者实测
更糟（cowork 侧同一份代码，全局关 `strictNullChecks` 令总数从 93 涨到 109，因为它弄坏了
判别联合的收窄）。

## 已落地（2026-09-07）

[`scripts/typecheck/surfaces.mjs`](../../scripts/typecheck/surfaces.mjs) —— 38 个面，每面一个独立
子进程顺序跑。面是**从文件系统发现的**，不是手写清单，所以新增一个 renderer 或 preload 模块当天
就被检查，不会无声漏掉；只有隔离名单是手写的，而且**每次运行都打印**（没人看见的跳过，正是本
issue 要修的东西）。

```
yarn typecheck            # 全部 38 个面
yarn typecheck:node       # --kind=node
yarn typecheck:web        # --kind=web
yarn typecheck:surfaces main preload/onlypreview     # 只跑指定面，1.5 秒反馈
TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck      # 打印去重后的诊断明细
```

脚本名现在都说真话：原先那条 parse-only 的命令保留为 **`parse:node`**，而 `typecheck:node`
指向真正的 node 面检查 —— 历史 `docs/plan/tasks/*.md` 的 `verify:` 行仍然能跑，而且现在真的
在检查类型（那本来就是它们宣称的事）。

**首次真实读数**（此前从未产出过）：

| | |
| --- | --- |
| 去重后的诊断 | **109** |
| 最大单面 | `main` 68 |
| 共同基线 | node 面各 4（来自 `src/shared`）；web 面各 3 |
| `renderer/common` | **0**（排除内部测试文件后） |
| 每面耗时 | 1.4 – 4.6 秒 |
| 隔离 | `preload/{agent,base,sqlite}` —— 3 个，具名 |

两处**排除**是知情的，都在每次运行时打印：

1. `preload/{agent,base,sqlite}` —— 到不了，tsc OOM。`exclude` 表达不了这一条（它只丢 root
   files 不丢依赖图，import 了爆炸文件的模块照样爆），所以按**名字**隔离。真正的修复是消掉
   LangGraph 那处泛型爆炸；隔离项一旦开始通过，说明已修好，条目就该删。
2. `**/*.test.ts` · `**/*.test.mts` · `**/tests/**/*` —— 这些文件引用 `node:test` 全局，而两份
   app tsconfig 都不提供，检查它们会报约 45 条「Cannot find name 'describe'」，
   全部来自 `src/renderer/common/poker/gto/tests/gtoEngine.test.ts` 一个文件。
   **代价：这些文件现在无处被类型检查** —— 这是个真缺口，正解是给测试单独一份带 runner 类型的
   配置，不是永久静音。

顺带修掉一条被假绿藏住的真缺陷：`src/main/windows/onlyPreviewCoworkMount.ts` 用了
`MaestroCompositeTabHostApi` 却没 import 它（它是 `src/shared/maestro/compositeTab.api.ts` 的
导出接口，不是全局）。`main` 面 69 → 68。

## 相关

- `../../micromeet-cowork/docs/plan/tasks/mini-016.md` —— cowork 侧同一份代码的检查结果，
  以及那份文档里「bitterless 是 0 错误」的更正。
- 5 条与严格度无关的缺陷需要在本仓修，并按 PQ-4 单向同步到 micromeet-cowork。
