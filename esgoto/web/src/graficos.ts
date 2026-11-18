import { esc } from './fmt'

const NS = 'http://www.w3.org/2000/svg'

export interface BarrasOpts {
  valores: number[]
  rotulos: string[] // rótulo por barra (tooltip)
  marcas: { i: number; t: string }[] // rótulos do eixo x
  ativo: number | null
  altura?: number
  fmt: (v: number) => string
  onClick?: (i: number) => void
}

/** Barras verticais finas com tooltip por barra; a barra ativa fica em destaque. */
export function barras(el: HTMLElement, o: BarrasOpts) {
  const H = o.altura ?? 120
  const W = Math.max(200, el.clientWidth || 268)
  const pad = { t: 10, b: 18, l: 0, r: 28 }
  const max = Math.max(...o.valores, 0.0001)
  const n = o.valores.length
  const bw = (W - pad.l - pad.r) / n
  const gap = bw > 4 ? 1 : 0.4
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ticks = escalaTicks(max)
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img">`
  for (const t of ticks) {
    s += `<line class="grade" x1="0" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`
    s += `<text class="eixo" x="${W}" y="${y(t) + 3.5}" text-anchor="end">${esc(o.fmt(t))}</text>`
  }
  o.valores.forEach((v, i) => {
    const x = pad.l + i * bw + gap / 2
    const top = y(v)
    const hgt = Math.max(0.5, H - pad.b - top)
    const r = Math.min(2, (bw - gap) / 2)
    s += `<path class="bar${i === o.ativo ? ' on' : ''}" data-i="${i}" d="${barraArredondada(x, top, bw - gap, hgt, r)}"/>`
  })
  for (const m of o.marcas) s += `<text class="eixo" x="${pad.l + m.i * bw}" y="${H - 4}">${esc(m.t)}</text>`
  // área de captura larga
  s += `<rect x="0" y="0" width="${W - pad.r}" height="${H}" fill="transparent" class="cap"/>`
  s += `</svg><div class="gtip"></div>`
  el.innerHTML = s
  el.classList.add('grafico')
  const svg = el.querySelector('svg')!
  const tip = el.querySelector<HTMLDivElement>('.gtip')!
  const bars = [...el.querySelectorAll<SVGPathElement>('.bar')]
  let atual = -1
  const idx = (ev: MouseEvent) => {
    const r = svg.getBoundingClientRect()
    const x = ((ev.clientX - r.left) / r.width) * W
    return Math.max(0, Math.min(n - 1, Math.floor((x - pad.l) / bw)))
  }
  svg.addEventListener('pointermove', (ev) => {
    const i = idx(ev)
    if (i === atual) return
    bars[atual]?.classList.remove('hov')
    atual = i
    bars[i].classList.add('hov')
    const r = svg.getBoundingClientRect()
    tip.innerHTML = `<b>${esc(o.fmt(o.valores[i]))}</b> · ${esc(o.rotulos[i])}`
    tip.style.left = `${((pad.l + (i + 0.5) * bw) / W) * r.width}px`
    tip.style.top = `${(y(o.valores[i]) / H) * r.height - 6}px`
    tip.classList.add('on')
  })
  svg.addEventListener('pointerleave', () => {
    bars[atual]?.classList.remove('hov')
    atual = -1
    tip.classList.remove('on')
  })
  if (o.onClick) svg.addEventListener('click', (ev) => o.onClick!(idx(ev)))
}

function barraArredondada(x: number, y: number, w: number, h: number, r: number) {
  if (h < r) r = h
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function escalaTicks(max: number) {
  const passos = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]
  const p = passos.find((s) => max / s <= 3) ?? max / 3
  const t: number[] = []
  for (let v = p; v <= max * 1.001; v += p) t.push(+v.toFixed(2))
  return t
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}
