// 三次贝塞尔曲线 —— 只实现我们真正用到的四件事:取点、取瞬时速度、均匀采样、算弧长。
//
// 为什么自己写而不是拉 `bezier-js`:我们用的是 `Bezier` 的 4 个方法里的 3 个,而它带着
// 求交、分割、offset、arc approximation 一整套 CAD 级能力。四阶以上、任意次数的曲线我们
// 一条都不需要 —— 三次(4 个控制点)就是拟人轨迹的全部。
import type { Vector } from './algorithm.type'

/** 弧长的采样数。折线逼近,64 段对我们这种平滑短曲线误差 < 0.01%。 */
const LENGTH_SAMPLES = 64

/**
 * 三次贝塞尔:B(t) = (1-t)³P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³P3,t ∈ [0,1]。
 * P0/P3 是起点终点(曲线必过),P1/P2 是控制点(曲线一般不过)。
 */
export class CubicBezier {
  constructor(
    readonly p0: Vector,
    readonly p1: Vector,
    readonly p2: Vector,
    readonly p3: Vector
  ) {}

  /** t 处的点。 */
  point(t: number): Vector {
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return {
      x: a * this.p0.x + b * this.p1.x + c * this.p2.x + d * this.p3.x,
      y: a * this.p0.y + b * this.p1.y + c * this.p2.y + d * this.p3.y
    }
  }

  /**
   * t 处的**瞬时速度** |B'(t)| —— 导数向量的模。
   * 这是拟人节奏的来源:曲线陡的地方速度大(该走得快),接近端点时速度小(自然减速)。
   * 匀速直线才是最不像人的走法。
   */
  speed(t: number): number {
    const u = 1 - t
    const dx = 3 * u * u * (this.p1.x - this.p0.x) + 6 * u * t * (this.p2.x - this.p1.x) + 3 * t * t * (this.p3.x - this.p2.x)
    const dy = 3 * u * u * (this.p1.y - this.p0.y) + 6 * u * t * (this.p2.y - this.p1.y) + 3 * t * t * (this.p3.y - this.p2.y)
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * 均匀采样 `steps + 1` 个点(t = i/steps)。
   * 注意是**按 t 均匀,不是按弧长均匀** —— 弯处点更密,这恰好合用:节奏本来就该由 speed 决定。
   */
  lut(steps: number): Vector[] {
    const points: Vector[] = []
    for (let i = 0; i <= steps; i += 1) points.push(this.point(i / steps))
    return points
  }

  /** 弧长(折线逼近)。只用来喂 Fitts 的距离项,不需要高斯求积那种精度。 */
  length(): number {
    let total = 0
    let prev = this.point(0)
    for (let i = 1; i <= LENGTH_SAMPLES; i += 1) {
      const next = this.point(i / LENGTH_SAMPLES)
      total += Math.hypot(next.x - prev.x, next.y - prev.y)
      prev = next
    }
    return total
  }
}
