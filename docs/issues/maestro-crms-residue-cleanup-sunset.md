# AI-CRMS 残留清理到 2026-12-31 到期删除

`status: 待到期执行(2026-12-31)`
`created: 2026-09-10`
`契约: docs/features/maestro-crms-retirement.md #6.9`

## 这条账是什么

AI-CRMS 退役(2026-09)删掉了所有 writer,但**删 writer 不会删数据**。为了不在用户盘上留一枚
可用的 CRMS JWT,退役时加了一段一次性开机清理。那段代码是**有寿命的**:它每次启动都要被解释
一遍,而且 `crmsResidueCleanup` 这个名字会让三年后的人以为 bl 还跟 crms 有关系。

marker 门控让它的运行成本接近零,但**认知成本不为零** —— 那才是这条账要收的。

## 为什么是 2026-12-31,不是更早或永久

- **不能只留一个版本。** 跳版升级是常态:一台从 2026-08 直接升到 2026-11 的机器,如果清理只活在
  2026-09 那一版里,它的 JWT 永远不会被清。留存窗口要覆盖「用户实际会跳过多少版本」,不是
  「我们发了几版」。
- **不能永久保留。** 见上一段。
- **一个季度**:Stable 与 Preview 两个通道各自至少滚过一轮,加上「装了没开」的机器有时间被打开
  一次。这是覆盖率与死代码之间一个可辩护的折中,不是精算出来的数。

## 到期要删什么(缺一不可)

| 删什么 | 在哪 |
|---|---|
| 纯决策层 | `src/main/maestro/retirement/crmsResidueCleanup.service.ts` |
| Electron 绑定层 | `src/main/maestro/retirement/crmsResidueCleanup.ts`(整个 `retirement/` 目录随之为空) |
| boot 调用点 | `src/main/xpc/maestroWindow.handler.ts` 的 `runCrmsResidueCleanupOnce()` 一行与其 import |
| localStorage 清理 | `src/preload/maestro/sqlite/crmsSessionResidue.ts` + `sqlite.preload.ts` 里的两行调用 |
| **marker 键本身** | config 表 `domain='maestro-retirement'` / `key='crms-residue-cleanup'` —— 不删就在库里留一个再也没人写的孤儿 |

marker 只有清理代码自己写。删代码时若不顺手清库,它会一直躺在那儿,而下一个读 config 表的人
无从判断它还有没有意义。

## 到期前不要做的事

- 不要因为「本机跑过一次了」就提前删 —— 判据是通道滚动覆盖,不是开发机的观察。
- 不要把 marker 的 domain / key 搬进 `src/shared/maestro/config.api.ts`。它现在故意只写在清理
  代码里,就是为了让删除是一次目录级操作,不必再去别处找残渣。
