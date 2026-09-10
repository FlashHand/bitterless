/** 二维向量 / 点。算法层不区分"位置"和"位移",都用它。 */
export interface Vector {
  x: number
  y: number
}

/** 一个矩形目标。`x`/`y` 是**中心点**,`width`/`height` 缺省时退化为一个点。 */
export interface Box {
  x: number
  y: number
  width?: number
  height?: number
}
