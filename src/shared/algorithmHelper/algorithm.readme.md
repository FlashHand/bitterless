# Algorithm Helper

放"算法"本身 —— 与 Electron、Vue、CDP 都无关的纯函数。可在 main / preload / renderer 任意一侧引用。

| 文件 | 内容 |
|---|---|
| `algorithm.type.ts` | `Vector`、`Box` |
| `bezier.helper.ts` | `CubicBezier` —— 取点、瞬时速度、均匀采样、弧长 |
| `humanPath.helper.ts` | `humanPath()` 拟人鼠标轨迹、`randomPointInBox()`、`fittsIndex()`、`overshootPoint()` |

## 拟人轨迹

```ts
import { humanPath, randomPointInBox } from '@shared/algorithmHelper/humanPath.helper'

const target = randomPointInBox({ x, y, width, height })
const { points, delays } = humanPath(current, target, { targetWidth: width })
for (let i = 1; i < points.length; i += 1) {
  await dispatchMouseMoved(points[i])
  await wait(delays[i - 1])
}
```

三条规律凑成"像人":

1. **Bézier 曲线** —— 手不走直线。两个控制点在垂直于行进方向上随机偏出去,幅度按距离取 2–200px。
2. **Fitts's Law** —— `MT = a + b·log₂(D/W + 1)`。目标越远越小,花的时间越长;时长再按曲线的
   **瞬时速度倒数**分配到每一步,于是有加速段和减速段,而不是匀速。
3. **过冲再回修** —— 距离超过 500px 时先冲过目标一点,再小幅修正。人不会一次瞄准到位。

唯一的使用者目前是 `main/drive/humanMouse.ts`(CDP 驱动的自动点击)。

## 出处与许可

思路和控制点生成来自 [ghost-cursor](https://github.com/Xetera/ghost-cursor)(MIT,© 2021 Xetera)。

**为什么不直接依赖它**:它的入口 `lib/spoof.d.ts` 从 `puppeteer` 导入类型,而 puppeteer 只在它的
devDeps —— 从包根引进来 typecheck 直接炸,只能绕道 `ghost-cursor/lib/math` 这个非公开子路径。
为一个 CDP 应用引一个 puppeteer 生态的包,再从它的内部路径取三个函数,依赖关系不划算。

这里是**重写而非拷贝**:

- 控制点的生成(`curveThrough`)保持原样 —— 那是它最值钱的一笔,包括"按 x 排序"那个会造成小回勾的细节。
- 曲线换成自己实现的三次 Bézier,省掉 `bezier-js` 那套 CAD 级能力(求交、分割、offset)。
- 时长模型换成真正的 Fitts 方程;原实现只用它算步数,时长是常量。
- 每步节奏用曲线的**真实**导数,原实现拿采样点当控制点做近似。

原始 MIT 声明:

```
MIT License

Copyright (c) 2021 Xetera

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
