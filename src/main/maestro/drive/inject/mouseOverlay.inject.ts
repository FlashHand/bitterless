// 这个文件**整份**被编译成一条注入表达式,交给 CDP `Runtime.evaluate` 在**页面里**执行。
// **bl 与 cowork 在这里刻意不同形。** cowork 把它做成 vite 虚拟模块,理由是那边 main 开着
// `esbuild: { keepNames: true }` —— keepNames 会给内部每一个具名函数套一层**模块作用域**的
// `__name` 辅助,于是 `String(fn)` 注入进页面就是 ReferenceError,**覆盖层整个消失且一声不响**
// (cowork 2026-08-31 起坏,09-09 Ral 报「虚拟鼠标没了」时才发现)。
//
// bl **没有开 keepNames**(核过 electron.vite.config.ts 全文零命中),所以走 bl 自己那套
// `String(fn)` 注入 —— 与 `debuggerCapture.ts` 的 `snapshotWalker` 同一形制,不为这一个覆盖层
// 引入一整套构建期虚拟模块机制。
//
// 约束因此落在这个文件上:**内部不许出现具名函数声明**,也不许引用任何模块作用域的东西。
// 守卫 `check-injected-cursor.mjs` 钉住这一条 —— 违反的表现是页面里 ReferenceError,
// 而它**不会让任何编译或测试变红**。
//
// 为什么不能留在 humanMouse.ts 里用 `String(fn)` 注入:main 开着 `esbuild: { keepNames: true }`,
// keepNames 会给函数**内部每一个具名函数**套一层模块作用域的 `__name` 辅助函数 —— 这里有 5 个
// (`mount` · `resize` · `draw` · `push` · `step`)。那些引用随文本进了页面,页面里没有它,
// 于是覆盖层在第一个初始化器上就抛 ReferenceError:**虚拟鼠标和彗星尾巴整个消失,而且一声不响**
// (`ensureOverlay` 的返回值没人看,`evaluate` 也不读 exceptionDetails)。
//
// 2026-08-31 起坏,2026-09-09 Ral 报「之前有虚拟的鼠标和彗星鼠标轨迹,现在没有了」时才发现 ——
// 它是这一类里第 9 处,前一轮审查漏了这个文件。
// 见 docs/issues/main-process-injected-script-keepnames.md
//
// 改完跑 `yarn check:injected-scripts`。

/**
 * 注入页面的覆盖层。**自成一体,不引用外层作用域**(它被字符串化后在页面里求值)。
 *
 * 三件事:AI-CRMS 蓝的箭头光标、彗星尾巴、点击涟漪。全部 `pointer-events:none`,不干扰真实事件。
 * 尾巴用 canvas 画 —— 每帧按"距头部的距离"给 alpha 和线宽做渐变,头粗尾细、头亮尾透,
 * 并且**按累计长度裁到 240px**(Ral 2026-08-13:「淡蓝色像彗星那样渐变的尾巴,最多延伸 240px」)。
 */
export const MOUSE_OVERLAY = (): void => {
  const w = window as unknown as Record<string, unknown>
  if (w.__maestroCursor) return
  const TAIL_MAX_PX = 240
  const TAIL_MAX_AGE_MS = 520
  const ID = '__maestro_cdp_cursor__'

  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483646;pointer-events:none'
  const ctx = canvas.getContext('2d')

  const arrow = document.createElement('div')
  arrow.id = ID
  arrow.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform'
  arrow.innerHTML =
    '<div style="position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:50%;background:radial-gradient(circle,rgba(77,155,255,.5),rgba(77,155,255,0) 70%)"></div>' +
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 0 5px #4d9bff)"><path d="M5 2.5l13.5 6.8-5.8 1.4-2.9 5.6z" fill="#165dff" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>'

  const mount = (): void => {
    const root = document.documentElement
    if (!canvas.isConnected) root.appendChild(canvas)
    if (!arrow.isConnected) root.appendChild(arrow)
  }
  mount()

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(window.innerWidth * dpr)
    canvas.height = Math.floor(window.innerHeight * dpr)
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  window.addEventListener('resize', resize)

  const trail: { x: number; y: number; t: number }[] = []
  let raf = 0

  const draw = (): void => {
    raf = 0
    if (!ctx) return
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    const now = Date.now()
    // 从头部往回累计长度,超过 240px 或太旧的一律丢掉 —— 尾巴长度是**按像素**裁的,不是按点数。
    let acc = 0
    let cut = trail.length
    for (let i = trail.length - 1; i > 0; i -= 1) {
      const dx = trail[i].x - trail[i - 1].x
      const dy = trail[i].y - trail[i - 1].y
      acc += Math.sqrt(dx * dx + dy * dy)
      if (acc > TAIL_MAX_PX || now - trail[i - 1].t > TAIL_MAX_AGE_MS) {
        cut = i
        break
      }
      cut = i - 1
    }
    if (cut > 0) trail.splice(0, cut)

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 1; i < trail.length; i += 1) {
      // 越靠近头部越亮、越粗 —— 彗星的形状。
      const k = i / trail.length
      const age = Math.max(0, 1 - (now - trail[i].t) / TAIL_MAX_AGE_MS)
      ctx.strokeStyle = 'rgba(77,155,255,' + (0.5 * k * age).toFixed(3) + ')'
      ctx.lineWidth = 1 + 5 * k
      ctx.beginPath()
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y)
      ctx.lineTo(trail[i].x, trail[i].y)
      ctx.stroke()
    }
    if (trail.length > 1) raf = requestAnimationFrame(draw)
  }

  const push = (x: number, y: number): void => {
    mount()
    arrow.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    trail.push({ x, y, t: Date.now() })
    if (!raf) raf = requestAnimationFrame(draw)
  }

  w.__maestroCursor = {
    /** 按主进程给的同一条轨迹与节奏跑动画 —— 于是可见光标和真实指针走的是同一条线。 */
    follow(points: { x: number; y: number }[], delays: number[]): void {
      let i = 0
      const step = (): void => {
        if (i >= points.length) return
        push(points[i].x, points[i].y)
        const d = delays[Math.min(i, delays.length - 1)] || 12
        i += 1
        window.setTimeout(step, d)
      }
      step()
    },
    ripple(x: number, y: number): void {
      mount()
      const r = document.createElement('div')
      r.style.cssText =
        'position:fixed;left:' + x + 'px;top:' + y + 'px;width:10px;height:10px;margin:-5px 0 0 -5px;' +
        'border:2px solid #165dff;border-radius:50%;z-index:2147483646;pointer-events:none;opacity:.85;transition:all .45s ease-out'
      document.documentElement.appendChild(r)
      requestAnimationFrame(() => {
        r.style.width = '38px'
        r.style.height = '38px'
        r.style.margin = '-19px 0 0 -19px'
        r.style.opacity = '0'
      })
      window.setTimeout(() => r.remove(), 480)
    }
  }
}
