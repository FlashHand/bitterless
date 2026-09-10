// 拟人鼠标轨迹 —— 给定起点和目标,产出一串"人手会走"的采样点和每一步的停留时间。
//
// 谁在用:CDP 驱动的自动点击(`main/drive/humanMouse.ts`)。一次性瞬移到目标点的指针有两个硬伤:
// 路径上的元素收不到 mouseover(hover 才出现的二级菜单永远打不开),以及单点跳变是最好认的自动化特征。
//
// 算法出处:ghost-cursor(MIT, © 2021 Xetera)的 Bézier + Fitts's Law 思路,详见
// `algorithm.readme.md`。这里是**重写**,不是拷贝:控制点的生成保持原样(那是它最值钱的一笔),
// 时长模型换成了真正的 Fitts 方程,节奏改用曲线的**真实**导数(原实现拿采样点当控制点近似)。
import { CubicBezier } from './bezier.helper'
import type { Box, Vector } from './algorithm.type'

/** 单步间隔的下限/上限。太密没意义(页面也就 60fps),太疏看着像卡顿。 */
const MIN_STEP_MS = 6
const MAX_STEP_MS = 34
/** 采样密度:大约每 12ms 一个点。 */
const STEP_TARGET_MS = 12
const MIN_STEPS = 12
const MAX_STEPS = 100

/** Fitts 方程 MT = a + b·ID 的两个常数。取值偏"熟练用户",拟人不能拖慢自动化。 */
const FITTS_BASE_MS = 90
const FITTS_PER_BIT_MS = 120
const MIN_DURATION_MS = 90
const DEFAULT_MAX_DURATION_MS = 900

/** 控制点偏离直线的幅度。太小接近直线,太大绕远路。 */
const MIN_SPREAD_PX = 2
const MAX_SPREAD_PX = 200

/** 超过这个距离才「过冲再回修」。近距离过冲看着像抽搐。 */
const DEFAULT_OVERSHOOT_THRESHOLD_PX = 500
const DEFAULT_OVERSHOOT_RADIUS_PX = 120

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Vector, b: Vector): Vector => ({ x: a.x + b.x, y: a.y + b.y })
const mult = (a: Vector, k: number): Vector => ({ x: a.x * k, y: a.y * k })
const magnitude = (a: Vector): number => Math.hypot(a.x, a.y)
/** 垂线方向(逆时针旋转 90°)。 */
const perpendicular = (a: Vector): Vector => ({ x: a.y, y: -a.x })
const setMagnitude = (a: Vector, length: number): Vector => {
  const size = magnitude(a)
  return size === 0 ? { x: 0, y: 0 } : mult(a, length / size)
}
const randomBetween = (min: number, max: number): number => Math.random() * (max - min) + min
/** 线段 a→b 上的随机一点。 */
const pointOnSegment = (a: Vector, b: Vector): Vector => add(a, mult(sub(b, a), Math.random()))

/**
 * Fitts's Law 的难度指数(bit):ID = log₂(D/W + 1)。
 * 目标越远、越小越难瞄,所需时间随之线性增长 —— 这是人手运动最经得起验证的一条规律。
 */
export const fittsIndex = (distancePx: number, targetWidthPx: number): number =>
  Math.log2(distancePx / Math.max(1, targetWidthPx) + 1)

/**
 * 目标点周围半径 `radius` 内的随机一点 —— 用来制造"过冲"。
 * 人不会一次瞄准到位:先冲过头,再小幅回修。这是拟人轨迹里最像人的一笔。
 */
export const overshootPoint = (target: Vector, radius: number): Vector => {
  const angle = Math.random() * 2 * Math.PI
  // sqrt 是为了在圆内**均匀**取点(不 sqrt 的话点会挤在圆心)。
  const distance = radius * Math.sqrt(Math.random())
  return { x: target.x + distance * Math.cos(angle), y: target.y + distance * Math.sin(angle) }
}

/**
 * 元素框内的随机落点(`box.x`/`box.y` 是**中心**)。每次都点正中心也是个自动化特征。
 * `insetRatio` 从四边各收进百分之多少,避开边框和圆角。
 */
export const randomPointInBox = (box: Box, insetRatio = 0.3): Vector => {
  const width = box.width ?? 0
  const height = box.height ?? 0
  if (width < 4 || height < 4) return { x: box.x, y: box.y }
  const insetX = (width * insetRatio) / 2
  const insetY = (height * insetRatio) / 2
  return {
    x: randomBetween(box.x - width / 2 + insetX, box.x + width / 2 - insetX),
    y: randomBetween(box.y - height / 2 + insetY, box.y + height / 2 - insetY)
  }
}

/**
 * 过 `start`、`end` 的三次贝塞尔,两个控制点在垂直于行进方向上随机偏出去。
 *
 * 两个控制点**按 x 排序**是照搬 ghost-cursor 的行为:向左移动时排序会把两个控制点相对行进方向对调,
 * 曲线因此偶尔带一个小回勾 —— 那不是 bug,人手本来就不走完美圆弧。
 */
const curveThrough = (start: Vector, end: Vector): CubicBezier => {
  const spread = clamp(magnitude(sub(end, start)), MIN_SPREAD_PX, MAX_SPREAD_PX)
  const side = Math.round(Math.random()) === 1 ? 1 : -1
  const anchor = (): Vector => {
    const mid = pointOnSegment(start, end)
    const normal = mult(setMagnitude(perpendicular(sub(mid, start)), spread), side)
    return pointOnSegment(mid, add(mid, normal))
  }
  const [a, b] = [anchor(), anchor()].sort((left, right) => left.x - right.x)
  return new CubicBezier(start, a, b, end)
}

export interface HumanPath {
  /** 采样点,`points[0]` 就是 `start`。 */
  points: Vector[]
  /** `delays[i]` = 走到 `points[i + 1]` 之后停留多久。长度 = `points.length - 1`。 */
  delays: number[]
}

export interface HumanPathOptions {
  /** 目标宽度,喂给 Fitts —— 目标越大越好瞄、移动越快。默认 100。 */
  targetWidth?: number
  /** 整条轨迹的墙钟上限。默认 900ms。 */
  maxDurationMs?: number
  /** 超过这个距离才过冲再回修。默认 500px;传 0 关闭。 */
  overshootThresholdPx?: number
  /** 过冲的半径。默认 120px。 */
  overshootRadiusPx?: number
}

/**
 * 一段轨迹的节奏:总时长由 Fitts 决定,再按曲线**瞬时速度的倒数**分配到每一步 ——
 * 速度大的地方(曲线陡)间隔短,接近端点时速度趋缓、间隔自然拉长,于是有了加速和减速。
 */
const legDelays = (curve: CubicBezier, steps: number, durationMs: number): number[] => {
  const weights: number[] = []
  let sum = 0
  for (let i = 1; i <= steps; i += 1) {
    const speed = curve.speed(i / steps)
    const weight = Number.isFinite(speed) && speed > 0 ? 1 / speed : 1
    weights.push(weight)
    sum += weight
  }
  if (sum <= 0) return weights.map(() => STEP_TARGET_MS)
  return weights.map((weight) => clamp((durationMs * weight) / sum, MIN_STEP_MS, MAX_STEP_MS))
}

const buildLeg = (start: Vector, end: Vector, targetWidth: number, maxDurationMs: number): HumanPath => {
  const curve = curveThrough(start, end)
  const difficulty = fittsIndex(curve.length(), targetWidth)
  const durationMs = clamp(FITTS_BASE_MS + FITTS_PER_BIT_MS * difficulty, MIN_DURATION_MS, maxDurationMs)
  const steps = clamp(Math.round(durationMs / STEP_TARGET_MS), MIN_STEPS, MAX_STEPS)
  return { points: curve.lut(steps), delays: legDelays(curve, steps, durationMs) }
}

/**
 * 从 `start` 到 `end` 的一条拟人轨迹。距离够远时内部拆成「过冲 + 回修」两段,
 * 但对外**始终是一条连续路径** —— 调用方按 `points` 逐点派发、按 `delays` 停留即可。
 */
export const humanPath = (start: Vector, end: Vector, options: HumanPathOptions = {}): HumanPath => {
  const targetWidth = Math.max(8, options.targetWidth ?? 100)
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const threshold = options.overshootThresholdPx ?? DEFAULT_OVERSHOOT_THRESHOLD_PX
  const radius = options.overshootRadiusPx ?? DEFAULT_OVERSHOOT_RADIUS_PX

  const legs: HumanPath[] = []
  if (threshold > 0 && magnitude(sub(end, start)) > threshold) {
    const missed = overshootPoint(end, radius)
    legs.push(buildLeg(start, missed, targetWidth, maxDurationMs))
    // 回修段的目标宽度按过冲半径算 —— 近距离小幅修正,本来就该快。
    legs.push(buildLeg(missed, end, radius, maxDurationMs))
  } else {
    legs.push(buildLeg(start, end, targetWidth, maxDurationMs))
  }

  const points = legs[0].points.slice()
  const delays = legs[0].delays.slice()
  for (const leg of legs.slice(1)) {
    // 丢掉衔接处重复的那个点,否则会派发一次零位移的 mouseMoved。
    points.push(...leg.points.slice(1))
    delays.push(...leg.delays)
  }

  const total = delays.reduce((sum, ms) => sum + ms, 0)
  if (total > maxDurationMs) {
    const scale = maxDurationMs / total
    return { points, delays: delays.map((ms) => Math.max(1, ms * scale)) }
  }
  return { points, delays }
}
