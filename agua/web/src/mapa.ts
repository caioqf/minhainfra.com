import { geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

type Props = { codarea: string }
type Bounds = [[number, number], [number, number]]

export interface MapaOpts {
  /** valor do município i (índice na ordem de `cods`), null = sem dado */
  valor: (i: number) => number | null
  cor: (v: number | null) => string
  rotuloUf: (uf: string) => string | null
  onHover: (i: number | null, x: number, y: number) => void
  onClick: (i: number | null) => void
  /** com estes dois, o mapa seleciona o estado inteiro até haver zoom suficiente para escolher cidade */
  onHoverUf?: (uf: string | null, x: number, y: number) => void
  onClickUf?: (uf: string) => void
  /** estados pequenos ganham chip lateral em vez de rótulo no mapa */
  comChips: () => boolean
  /** nome e importância (consumidores) do município, para os rótulos no zoom */
  nomeMun: (i: number) => string
  pesoMun: (i: number) => number
  /** retângulos (em px do canvas) cobertos por legenda, linha do tempo etc.; rótulos não vão para lá */
  obstaculos: () => [number, number, number, number][]
  margem: { t: number; r: number; b: number; l: number }
}

interface Vista { k: number; x: number; y: number }

export class Mapa {
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private w = 0
  private h = 0
  private paths: Path2D[] = []
  private caixas: Bounds[] = []
  private centros: [number, number][] = []
  private ordemPeso: number[] = []
  private ufPaths = new Map<string, Path2D>()
  private ufCaixas = new Map<string, Bounds>()
  private ufCentros = new Map<string, [number, number]>()
  private vista: Vista = { k: 1, x: 0, y: 0 }
  private anim = 0
  private hover: number | null = null
  private hoverUf: string | null = null
  private sel: number | null = null
  ufFoco: string | null = null
  private cores: Record<string, string> = {}
  private quadro = 0
  private arrasto: { x: number; y: number; vx: number; vy: number; moveu: boolean } | null = null
  private dedos = new Map<number, [number, number]>()
  private pinca: { d: number; k: number; wx: number; wy: number } | null = null

  constructor(
    private canvas: HTMLCanvasElement,
    private muns: Feature<Geometry, Props>[], // já na ordem dos índices
    private ufs: FeatureCollection<Geometry, Props>,
    private ufDe: (i: number) => string,
    private sigla: (codarea: string) => string,
    private o: MapaOpts,
  ) {
    this.ctx = canvas.getContext('2d')!
    new ResizeObserver(() => this.redimensionar()).observe(canvas)
    this.eventos()
    this.lerCores()
  }

  lerCores() {
    const cs = getComputedStyle(document.documentElement)
    for (const k of ['--m-borda', '--m-uf', '--fg', '--panel', '--fg-3', '--m-sem']) this.cores[k] = cs.getPropertyValue(k).trim()
    this.desenhar()
  }

  private redimensionar() {
    const r = this.canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = r.width
    this.h = r.height
    this.canvas.width = Math.round(r.width * this.dpr)
    this.canvas.height = Math.round(r.height * this.dpr)
    const m = this.o.margem
    const proj = geoMercator().fitExtent([[m.l, m.t], [this.w - m.r, this.h - m.b]], this.ufs as GeoPermissibleObjects)
    const gp = geoPath(proj)
    this.paths = this.muns.map((f) => new Path2D(gp(f) ?? ''))
    this.caixas = this.muns.map((f) => gp.bounds(f) as Bounds)
    this.centros = this.muns.map((f) => (f.geometry.type === 'Polygon' && !f.geometry.coordinates.length ? [NaN, NaN] : this.centroVisual(f, gp)))
    if (!this.ordemPeso.length) this.ordemPeso = this.muns.map((_, i) => i).sort((a, b) => this.o.pesoMun(b) - this.o.pesoMun(a))
    for (const f of this.ufs.features) {
      const s = this.sigla(f.properties.codarea)
      this.ufPaths.set(s, new Path2D(gp(f) ?? ''))
      this.ufCaixas.set(s, gp.bounds(f) as Bounds)
      this.ufCentros.set(s, this.centroVisual(f, gp))
    }
    const cs = [...this.ufCaixas.values()]
    this.limites = [[Math.min(...cs.map((c) => c[0][0])), Math.min(...cs.map((c) => c[0][1]))], [Math.max(...cs.map((c) => c[1][0])), Math.max(...cs.map((c) => c[1][1]))]]
    cancelAnimationFrame(this.anim)
    this.alvo = null
    this.vista = this.ufFoco ? (this.sel != null ? this.vistaMun(this.sel, this.ufFoco) : this.vistaPara(this.ufFoco)) : { k: 1, x: 0, y: 0 }
    this.desenhar()
    this.canvas.dispatchEvent(new CustomEvent('vista'))
  }

  /** centro do maior polígono do estado, para o rótulo não cair no mar */
  private centroVisual(f: Feature<Geometry, Props>, gp: ReturnType<typeof geoPath>): [number, number] {
    if (f.geometry.type === 'MultiPolygon') {
      let melhor: Feature | null = null
      let area = -1
      for (const coords of f.geometry.coordinates) {
        const g: Feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } }
        const a = gp.area(g)
        if (a > area) { area = a; melhor = g }
      }
      if (melhor) return gp.centroid(melhor) as [number, number]
    }
    return gp.centroid(f) as [number, number]
  }

  /** posição na tela do centro do estado (com a vista atual) */
  centroUf(uf: string): [number, number] | null {
    const c = this.ufCentros.get(uf)
    if (!c) return null
    return [c[0] * this.vista.k + this.vista.x, c[1] * this.vista.k + this.vista.y]
  }
  get zoomado() { return this.vista.k > 1.05 }
  get largura() { return this.w }
  get altura() { return this.h }

  private vistaPara(uf: string | null, folga = 0.86): Vista {
    const b = uf ? this.ufCaixas.get(uf) : undefined
    if (!b) return { k: 1, x: 0, y: 0 } // sem estado ou mapa ainda não medido (redimensionar() reaplica o foco)
    const m = this.o.margem
    const aw = this.w - m.l - m.r
    const ah = this.h - m.t - m.b
    const k = Math.min(14, folga * Math.min(aw / (b[1][0] - b[0][0]), ah / (b[1][1] - b[0][1])))
    const cx = (b[0][0] + b[1][0]) / 2
    const cy = (b[0][1] + b[1][1]) / 2
    return { k, x: m.l + aw / 2 - cx * k, y: m.t + ah / 2 - cy * k }
  }

  focar(uf: string | null) {
    this.ufFoco = uf
    this.animarPara(this.vistaPara(uf))
  }

  /** centraliza o município i na área útil do mapa, com zoom suficiente para enxergar ele e os vizinhos */
  focarMun(i: number, uf: string) {
    this.ufFoco = uf
    this.animarPara(this.vistaMun(i, uf))
  }

  private vistaMun(i: number, uf: string): Vista {
    const b = this.caixas[i]
    if (!b || !this.w || !isFinite(b[0][0])) return this.vistaPara(uf)
    const m = this.o.margem
    const aw = this.w - m.l - m.r
    const ah = this.h - m.t - m.b
    const bw = Math.max(b[1][0] - b[0][0], 1e-3), bh = Math.max(b[1][1] - b[0][1], 1e-3)
    // o município ocupa ~22% da área útil, mas nunca menos zoom que o do estado
    const kMun = 0.22 * Math.min(aw / bw, ah / bh)
    const k = Math.max(this.vistaPara(uf).k, Math.min(28, kMun))
    const cx = (b[0][0] + b[1][0]) / 2
    const cy = (b[0][1] + b[1][1]) / 2
    return { k, x: m.l + aw / 2 - cx * k, y: m.t + ah / 2 - cy * k }
  }

  /** zoom animado (botões) mantendo o ponto (cx, cy) da tela parado */
  zoomPor(f: number, cx = this.w / 2, cy = this.h / 2) {
    const base = this.alvo ?? this.vista
    this.animarPara(this.zoomEm(base, base.k * f, cx, cy), 320)
  }

  /** vista com zoom k em volta do ponto (cx, cy) da tela, já limitada */
  private zoomEm(v: Vista, k: number, cx: number, cy: number): Vista {
    k = Math.max(1, Math.min(40, k))
    const r = k / v.k
    return this.limitar({ k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r })
  }

  /** não deixa o mapa sair da tela; em k = 1 volta ao enquadramento original */
  private limitar(v: Vista): Vista {
    if (v.k <= 1.001) return { k: 1, x: 0, y: 0 }
    // o centro da tela tem que cair dentro do contorno do Brasil
    const [[x0, y0], [x1, y1]] = this.limites
    const cx = this.w / 2, cy = this.h / 2
    return {
      k: v.k,
      x: Math.min(cx - x0 * v.k, Math.max(cx - x1 * v.k, v.x)),
      y: Math.min(cy - y0 * v.k, Math.max(cy - y1 * v.k, v.y)),
    }
  }

  private aplicar(v: Vista) {
    cancelAnimationFrame(this.anim)
    this.alvo = null
    this.vista = v
    this.desenhar()
    this.canvas.dispatchEvent(new CustomEvent('vista'))
  }

  private alvo: Vista | null = null
  private limites: Bounds = [[0, 0], [0, 0]]

  private animarPara(alvo: Vista, dur = 750) {
    cancelAnimationFrame(this.anim)
    this.alvo = alvo
    const de = { ...this.vista }
    const t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    // interpola o centro em coordenadas do mapa e o zoom em escala log: o caminho fica reto, sem "barriga"
    const cx = this.w / 2, cy = this.h / 2
    const c0 = [(cx - de.x) / de.k, (cy - de.y) / de.k]
    const c1 = [(cx - alvo.x) / alvo.k, (cy - alvo.y) / alvo.k]
    const passo = (agora: number) => {
      const t = Math.min(1, (agora - t0) / dur)
      const e = ease(t)
      const k = Math.exp(Math.log(de.k) + (Math.log(alvo.k) - Math.log(de.k)) * e)
      const wx = c0[0] + (c1[0] - c0[0]) * e, wy = c0[1] + (c1[1] - c0[1]) * e
      this.vista = t < 1 ? { k, x: cx - wx * k, y: cy - wy * k } : alvo
      this.desenhar()
      this.canvas.dispatchEvent(new CustomEvent('vista'))
      if (t < 1) this.anim = requestAnimationFrame(passo)
      else this.alvo = null
    }
    this.anim = requestAnimationFrame(passo)
  }

  selecionar(i: number | null) {
    this.sel = i
    this.desenhar()
  }

  desenhar = () => {
    cancelAnimationFrame(this.quadro)
    this.quadro = requestAnimationFrame(() => this.pintar())
  }

  private pintar() {
    const { ctx, dpr, vista } = this
    if (!this.w) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(dpr * vista.k, 0, 0, dpr * vista.k, dpr * vista.x, dpr * vista.y)

    const foco = this.ufFoco
    const minX = -vista.x / vista.k, minY = -vista.y / vista.k
    const maxX = (this.w - vista.x) / vista.k, maxY = (this.h - vista.y) / vista.k
    // municípios
    for (let i = 0; i < this.paths.length; i++) {
      const b = this.caixas[i]
      if (b[1][0] < minX || b[0][0] > maxX || b[1][1] < minY || b[0][1] > maxY) continue
      ctx.globalAlpha = foco && this.ufDe(i) !== foco ? 0.22 : 1
      ctx.fillStyle = this.o.cor(this.o.valor(i))
      ctx.fill(this.paths[i])
    }
    ctx.globalAlpha = 1
    // bordas municipais só quando dá para enxergar
    if (vista.k > 1.6) {
      ctx.strokeStyle = this.cores['--m-borda']
      ctx.lineWidth = 0.6 / vista.k
      for (let i = 0; i < this.paths.length; i++) {
        if (foco && this.ufDe(i) !== foco) continue
        const b = this.caixas[i]
        if (b[1][0] < minX || b[0][0] > maxX || b[1][1] < minY || b[0][1] > maxY) continue
        ctx.stroke(this.paths[i])
      }
    }
    // estados
    ctx.strokeStyle = this.cores['--m-uf']
    ctx.lineWidth = 0.9 / vista.k
    for (const p of this.ufPaths.values()) ctx.stroke(p)
    if (foco) {
      ctx.strokeStyle = this.cores['--fg']
      ctx.lineWidth = 1.6 / vista.k
      ctx.stroke(this.ufPaths.get(foco)!)
    }
    // estado sob o mouse (modo de escolher estado)
    if (this.hoverUf) {
      const p = this.ufPaths.get(this.hoverUf)
      if (p) {
        ctx.fillStyle = this.cores['--fg']
        ctx.globalAlpha = 0.08
        ctx.fill(p)
        ctx.globalAlpha = 1
        ctx.lineWidth = 4 / vista.k
        ctx.strokeStyle = this.cores['--panel']
        ctx.stroke(p)
        ctx.lineWidth = 2 / vista.k
        ctx.strokeStyle = this.cores['--fg']
        ctx.stroke(p)
      }
    }
    // seleção e hover
    for (const [i, lw] of [[this.sel, 2.4], [this.hover, 1.8]] as [number | null, number][]) {
      if (i == null) continue
      ctx.lineWidth = (lw + 2) / vista.k
      ctx.strokeStyle = this.cores['--panel']
      ctx.stroke(this.paths[i])
      ctx.lineWidth = lw / vista.k
      ctx.strokeStyle = this.cores['--fg']
      ctx.stroke(this.paths[i])
    }
    // rótulos dos estados
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const ocupados: [number, number, number, number][] = [...this.o.obstaculos()]
    if (!foco) {
      for (const [uf, c] of this.ufCentros) {
        const miudo = ['RN', 'PB', 'PE', 'AL', 'SE', 'ES', 'RJ', 'DF'].includes(uf) && vista.k < 2
        if (miudo && this.o.comChips()) continue
        const x = c[0] * vista.k + vista.x
        const y = c[1] * vista.k + vista.y
        if (x < 0 || y < 0 || x > this.w || y > this.h) continue
        const rot = this.o.rotuloUf(uf)
        if (miudo) { this.texto(uf, x, y, '600 9.5px Geist, sans-serif'); ocupados.push([x - 10, y - 7, x + 10, y + 7]); continue }
        this.texto(uf, x, y - 6, '600 11px Geist, sans-serif')
        if (rot) this.texto(rot, x, y + 7, '500 10.5px Geist, sans-serif', 0.75)
        ocupados.push([x - 22, y - 14, x + 22, y + 14])
      }
    }
    this.rotulosMun(ocupados)
  }

  /** nomes dos municípios quando há zoom: os mais populosos primeiro, sem sobrepor */
  private rotulosMun(ocupados: [number, number, number, number][]) {
    const { ctx, vista } = this
    if (vista.k < 2.2) return
    const max = Math.round(Math.min(90, (this.w * this.h) / 9000))
    const fonte = '500 10.5px Geist, sans-serif'
    ctx.font = fonte
    const cabe = (r: [number, number, number, number]) => !ocupados.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])
    const tentar = (i: number, forte: boolean) => {
      const c = this.centros[i]
      if (!c || !isFinite(c[0])) return false
      const x = c[0] * vista.k + vista.x, y = c[1] * vista.k + vista.y
      if (x < 0 || y < 0 || x > this.w || y > this.h) return false
      if (!forte && this.ufFoco && this.ufDe(i) !== this.ufFoco) return false
      const nome = this.o.nomeMun(i)
      ctx.font = forte ? '600 12px Geist, sans-serif' : fonte
      const tw = ctx.measureText(nome).width
      // município pequeno demais na tela para o nome caber razoavelmente: só entra se for selecionado
      const b = this.caixas[i]
      const larg = (b[1][0] - b[0][0]) * vista.k
      if (!forte && larg < Math.min(tw * 0.6, 40)) return false
      const r: [number, number, number, number] = [x - tw / 2 - 3, y - 8, x + tw / 2 + 3, y + 8]
      // o nome inteiro tem que caber na tela
      if (!forte && (r[0] < 4 || r[2] > this.w - 4 || r[1] < 4 || r[3] > this.h - 4)) return false
      if (!forte && !cabe(r)) return false
      ocupados.push(r)
      this.texto(nome, x, y, forte ? '600 12px Geist, sans-serif' : fonte, forte ? 1 : 0.85)
      return true
    }
    if (this.sel != null) tentar(this.sel, true)
    let n = 0
    for (const i of this.ordemPeso) {
      if (n >= max) break
      if (i === this.sel) continue
      if (tentar(i, false)) n++
    }
  }

  private texto(t: string, x: number, y: number, fonte: string, alpha = 1) {
    const { ctx } = this
    ctx.font = fonte
    ctx.globalAlpha = alpha
    ctx.lineWidth = 3
    ctx.strokeStyle = this.cores['--panel']
    ctx.strokeText(t, x, y)
    ctx.fillStyle = this.cores['--fg']
    ctx.fillText(t, x, y)
    ctx.globalAlpha = 1
  }

  /** estado sob o ponto da tela */
  private acertarUf(sx: number, sy: number): string | null {
    const px = (sx - this.vista.x) / this.vista.k
    const py = (sy - this.vista.y) / this.vista.k
    const { ctx } = this
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    let achou: string | null = null
    for (const [uf, b] of this.ufCaixas) {
      if (px < b[0][0] || px > b[1][0] || py < b[0][1] || py > b[1][1]) continue
      if (ctx.isPointInPath(this.ufPaths.get(uf)!, px, py)) { achou = uf; break }
    }
    ctx.restore()
    return achou
  }

  /** cidade só é escolhida dentro do estado em foco ou com zoom; fora disso, o clique pega o estado inteiro */
  private modoEstado(sx: number, sy: number): string | null {
    if (!this.o.onClickUf) return null
    const uf = this.acertarUf(sx, sy)
    if (!uf) return null
    if (this.ufFoco === uf || this.vista.k >= 3) return null
    return uf
  }

  private acertar(sx: number, sy: number): number | null {
    const px = (sx - this.vista.x) / this.vista.k
    const py = (sy - this.vista.y) / this.vista.k
    const { ctx } = this
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    let achou: number | null = null
    for (let i = 0; i < this.paths.length; i++) {
      const b = this.caixas[i]
      if (px < b[0][0] || px > b[1][0] || py < b[0][1] || py > b[1][1]) continue
      if (ctx.isPointInPath(this.paths[i], px, py)) { achou = i; break }
    }
    ctx.restore()
    return achou
  }

  private eventos() {
    const c = this.canvas
    const pos = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = c.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top] as const
    }
    const atualizarToque = () => { c.style.touchAction = this.vista.k > 1 ? 'none' : 'pan-y' }
    c.addEventListener('vista', atualizarToque)
    atualizarToque()

    c.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e)
      this.dedos.set(e.pointerId, [x, y])
      c.setPointerCapture(e.pointerId)
      if (this.dedos.size === 2) {
        // começa a pinça: guarda distância, zoom e o ponto do mapa sob o meio dos dedos
        const [a, b] = [...this.dedos.values()]
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        this.pinca = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k: this.vista.k, wx: (mx - this.vista.x) / this.vista.k, wy: (my - this.vista.y) / this.vista.k }
        this.arrasto = null
        return
      }
      this.arrasto = { x, y, vx: this.vista.x, vy: this.vista.y, moveu: false }
    })

    c.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e)
      if (this.dedos.has(e.pointerId)) this.dedos.set(e.pointerId, [x, y])
      if (this.pinca && this.dedos.size === 2) {
        const [a, b] = [...this.dedos.values()]
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const k = Math.max(1, Math.min(40, this.pinca.k * (Math.hypot(a[0] - b[0], a[1] - b[1]) / this.pinca.d)))
        this.aplicar(this.limitar({ k, x: mx - this.pinca.wx * k, y: my - this.pinca.wy * k }))
        return
      }
      if (this.arrasto) {
        const dx = x - this.arrasto.x, dy = y - this.arrasto.y
        if (Math.abs(dx) + Math.abs(dy) > 4) this.arrasto.moveu = true
        if (this.arrasto.moveu && this.vista.k > 1) {
          this.aplicar(this.limitar({ ...this.vista, x: this.arrasto.vx + dx, y: this.arrasto.vy + dy }))
          c.style.cursor = 'grabbing'
          if (this.hover != null) { this.hover = null; this.o.onHover(null, 0, 0) }
          return
        }
      }
      if (e.pointerType === 'touch') return
      const uf = this.modoEstado(x, y)
      if (uf) {
        if (uf !== this.hoverUf || this.hover != null) { this.hoverUf = uf; this.hover = null; this.desenhar() }
        c.style.cursor = 'pointer'
        this.o.onHoverUf?.(uf, x, y)
        return
      }
      if (this.hoverUf) { this.hoverUf = null; this.desenhar() }
      const i = this.acertar(x, y)
      if (i !== this.hover) { this.hover = i; this.desenhar() }
      c.style.cursor = i == null ? (this.vista.k > 1 ? 'grab' : 'default') : 'pointer'
      this.o.onHover(i, x, y)
    })

    const soltar = (e: PointerEvent, cancelou: boolean) => {
      this.dedos.delete(e.pointerId)
      if (this.pinca) {
        // depois da pinça, nada de clique; o dedo que sobrou continua arrastando
        if (this.dedos.size < 2) this.pinca = null
        const resto = [...this.dedos.values()][0]
        this.arrasto = resto ? { x: resto[0], y: resto[1], vx: this.vista.x, vy: this.vista.y, moveu: true } : null
        return
      }
      const moveu = this.arrasto?.moveu
      this.arrasto = null
      if (cancelou || moveu) return
      const [x, y] = pos(e)
      const uf = this.modoEstado(x, y)
      if (uf) {
        this.hoverUf = null
        this.o.onHover(null, 0, 0)
        this.o.onClickUf!(uf)
        return
      }
      const i = this.acertar(x, y)
      if (e.pointerType === 'touch') this.o.onHover(i, x, y)
      this.o.onClick(i)
    }
    c.addEventListener('pointerup', (e) => soltar(e, false))
    c.addEventListener('pointercancel', (e) => soltar(e, true))
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return
      this.hover = null
      this.hoverUf = null
      this.desenhar()
      this.o.onHover(null, 0, 0)
    })

    c.addEventListener('wheel', (e) => {
      // em telas onde a página rola, só dá zoom com Ctrl/Cmd ou pinça do trackpad (que chega como ctrlKey)
      if (!e.ctrlKey && !e.metaKey && window.innerWidth <= 1180) return
      e.preventDefault()
      const [x, y] = pos(e)
      // zoom contínuo e proporcional ao giro: trackpad manda dezenas de eventos pequenos, mouse manda poucos grandes
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      const f = Math.exp(-Math.max(-200, Math.min(200, dy)) * (e.ctrlKey ? 0.012 : 0.0025))
      const base = this.alvo ?? this.vista
      this.aplicar(this.zoomEm(base, base.k * f, x, y))
    }, { passive: false })

    c.addEventListener('dblclick', (e) => {
      const [x, y] = pos(e)
      this.zoomPor(e.shiftKey ? 1 / 2 : 2, x, y)
    })
  }
}
