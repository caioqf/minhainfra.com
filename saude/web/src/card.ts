import { geoBounds, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import type { Feature, Geometry } from 'geojson'

/** cruz de saúde (24 x 24, cantos arredondados) */
export const CRUZ = 'M10 3h4a1 1 0 0 1 1 1v5h5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-5v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h5V4a1 1 0 0 1 1-1z'

/** Imagem para compartilhar (1080 x 1350, formato retrato do Instagram), desenhada num canvas. */
export interface CardOpts {
  marca: string // "minhainfra · saúde"
  icone: 'raio' | 'gota' | 'cruz'
  lugar: string // "Campinas"
  sublugar: string // "São Paulo · CPFL-PAULISTA"
  numero: string // "4,8"
  unidade: string // "h"
  frase: string // "sem energia por consumidor em Campinas (SP)"
  periodo: string // "média · 12 meses até set 2026"
  destaques: string[] // linhas curtas: "585º de 644 em São Paulo", "-6% vs 12 meses antes"
  legenda: { cores: string[]; rotulos: string[]; titulo: string } | null
  /** com zoom = true, o mapa mostra só os arredores do destaque (a cidade e os vizinhos) */
  mapa: { feats: Feature<Geometry>[]; cores: string[]; destaque: Feature<Geometry> | null; contornos: Feature<Geometry>[]; zoom?: boolean }
  url: string
  fonte: string
  /** foto da cidade (Wikimedia Commons) para o topo do card */
  foto?: { img: HTMLImageElement; credito: string } | null
}

const W = 1080, H = 1350
const ICONES = {
  raio: 'M13 2 4 14h7l-1 8 9-12h-7z',
  gota: 'M12 2.5S5 10.2 5 14.5a7 7 0 0 0 14 0C19 10.2 12 2.5 12 2.5z',
  cruz: CRUZ,
}

export async function desenharCard(o: CardOpts): Promise<HTMLCanvasElement> {
  await document.fonts.ready
  const cs = getComputedStyle(document.documentElement)
  const v = (k: string) => cs.getPropertyValue(k).trim()
  const cor = { bg: v('--panel'), fg: v('--fg'), fg2: v('--fg-2'), fg3: v('--fg-3'), linha: v('--line-2'), tinta: v('--luz-ink'), luz: v('--luz'), sem: v('--m-sem'), borda: v('--m-borda'), uf: v('--m-uf') }
  const serif = 'Newsreader, Georgia, serif', sans = 'Geist, Helvetica, Arial, sans-serif'

  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')!
  c.fillStyle = cor.bg
  c.fillRect(0, 0, W, H)
  const M = 80
  const FOTO_H = 440
  if (o.foto) {
    // foto cobrindo o topo, recortada ao centro, com degradê para a marca ficar legível
    const { img } = o.foto
    const esc = Math.max(W / img.naturalWidth, FOTO_H / img.naturalHeight)
    const dw = img.naturalWidth * esc, dh = img.naturalHeight * esc
    c.save()
    c.beginPath()
    c.rect(0, 0, W, FOTO_H)
    c.clip()
    c.drawImage(img, (W - dw) / 2, (FOTO_H - dh) / 2, dw, dh)
    c.restore()
    const g = c.createLinearGradient(0, 0, 0, 200)
    g.addColorStop(0, 'rgba(0,0,0,0.55)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, W, 200)
    const g2 = c.createLinearGradient(0, FOTO_H - 90, 0, FOTO_H)
    g2.addColorStop(0, 'rgba(0,0,0,0)')
    g2.addColorStop(1, 'rgba(0,0,0,0.5)')
    c.fillStyle = g2
    c.fillRect(0, FOTO_H - 90, W, 90)
    c.fillStyle = 'rgba(255,255,255,0.88)'
    c.font = `400 19px ${sans}`
    c.textBaseline = 'alphabetic'
    let cred = o.foto.credito
    while (c.measureText(cred).width > W - 2 * M && cred.length > 10) cred = cred.slice(0, -2)
    if (cred !== o.foto.credito) cred = cred.trimEnd() + '…'
    c.fillText(cred, M, FOTO_H - 22)
  }

  // marca
  c.save()
  c.translate(M, 70)
  c.scale(1.6, 1.6)
  c.fillStyle = cor.luz
  c.fill(new Path2D(ICONES[o.icone]))
  c.restore()
  c.fillStyle = o.foto ? '#ffffff' : cor.fg2
  c.font = `400 34px ${serif}`
  c.textBaseline = 'middle'
  c.fillText(o.marca, M + 52, 90)

  // lugar
  c.textBaseline = 'alphabetic'
  c.fillStyle = cor.fg
  let y = o.foto ? FOTO_H + 100 : 225
  y = texto(c, o.lugar, M, y, W - 2 * M, `400 76px ${serif}`, 84, 2)
  c.fillStyle = cor.fg3
  y = texto(c, o.sublugar, M, y + 6, W - 2 * M, `400 30px ${sans}`, 38, 1)

  // número grande
  y += o.foto ? 150 : 175
  c.fillStyle = cor.tinta
  c.font = `300 ${o.foto ? 170 : 200}px ${serif}`
  c.fillText(o.numero, M - 6, y)
  const nw = c.measureText(o.numero).width
  c.font = `400 ${o.foto ? 72 : 84}px ${serif}`
  c.fillText(o.unidade, M + nw + 6, y)

  // frase e período
  c.fillStyle = cor.fg
  y = texto(c, o.frase, M, y + 64, W - 2 * M, `500 40px ${sans}`, 50, 3)
  c.fillStyle = cor.fg3
  y = texto(c, o.periodo, M, y + 4, W - 2 * M, `400 30px ${sans}`, 38, 2)

  // destaques
  y += 18
  for (const d of o.destaques.slice(0, 3)) {
    c.fillStyle = cor.luz
    c.beginPath()
    c.arc(M + 7, y - 11, 6, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = cor.fg2
    y = texto(c, d, M + 28, y + 2, W - 2 * M - 28, `400 31px ${sans}`, 40, 2) + 6
  }

  // minimapa no espaço que sobrou
  const topoMapa = Math.max(y + 24, 760)
  const baseMapa = H - 150
  if (o.mapa.feats.length && baseMapa - topoMapa > 180) {
    let feats = o.mapa.feats, cores = o.mapa.cores
    const area: [[number, number], [number, number]] = [[M, topoMapa], [W - M - (o.legenda ? 220 : 0), baseMapa]]
    let alvo: GeoPermissibleObjects = { type: 'FeatureCollection', features: feats } as unknown as GeoPermissibleObjects
    if (o.mapa.zoom && o.mapa.destaque) {
      // caixa em volta da cidade: 4x o tamanho dela, com um mínimo para cidades pequenas, na proporção da área do mapa
      const [[x0, y0], [x1, y1]] = geoBounds(o.mapa.destaque)
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const prop = (area[1][0] - area[0][0]) / (area[1][1] - area[0][1])
      let h = Math.max((y1 - y0) * 4, (x1 - x0) * 4 / prop, 0.5)
      h = Math.min(h, 6)
      const w = h * prop / Math.cos((cy * Math.PI) / 180)
      const caixa = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]]
      alvo = { type: 'MultiPoint', coordinates: [caixa[0], caixa[1]] } as GeoPermissibleObjects
      const ok = feats.map((ft) => {
        try {
          const [[a, b], [c2, d]] = geoBounds(ft)
          return c2 >= caixa[0][0] && a <= caixa[1][0] && d >= caixa[0][1] && b <= caixa[1][1]
        } catch { return false } // município sem geometria na malha
      })
      feats = feats.filter((_, i) => ok[i])
      cores = cores.filter((_, i) => ok[i])
    }
    const proj = geoMercator().fitExtent(area, alvo)
    const gp = geoPath(proj, c)
    c.save()
    if (o.mapa.zoom) {
      // recorte arredondado: os vizinhos não vazam para fora do quadro
      c.beginPath()
      c.roundRect(area[0][0], area[0][1], area[1][0] - area[0][0], area[1][1] - area[0][1], 18)
      c.clip()
      c.fillStyle = cor.sem
      c.globalAlpha = 0.35
      c.fillRect(area[0][0], area[0][1], area[1][0] - area[0][0], area[1][1] - area[0][1])
      c.globalAlpha = 1
    }
    feats.forEach((ft, i) => {
      c.beginPath()
      gp(ft)
      c.fillStyle = cores[i] || cor.sem
      c.fill()
    })
    if (feats.length < 1200) {
      c.strokeStyle = cor.borda
      c.lineWidth = o.mapa.zoom ? 1.6 : 0.8
      feats.forEach((ft) => { c.beginPath(); gp(ft); c.stroke() })
    }
    c.strokeStyle = cor.uf
    c.lineWidth = 1.4
    for (const ft of o.mapa.contornos) { c.beginPath(); gp(ft); c.stroke() }
    if (o.mapa.destaque) {
      c.beginPath()
      gp(o.mapa.destaque)
      c.lineJoin = 'round'
      c.strokeStyle = cor.bg
      c.lineWidth = 9
      c.stroke()
      c.strokeStyle = cor.fg
      c.lineWidth = 4.5
      c.stroke()
    }
    c.restore()
    // legenda vertical à direita do mapa
    if (o.legenda) {
      const lx = W - M - 190
      const ly = baseMapa - o.legenda.cores.length * 30 - 10
      c.fillStyle = cor.fg3
      // título acima das cores, em até 4 linhas
      const linhasTit = Math.min(4, Math.ceil((c.measureText(o.legenda.titulo).width || 1) / 190) + 1)
      texto(c, o.legenda.titulo, lx, ly - 18 - (linhasTit - 1) * 25, 190, `400 20px ${sans}`, 25, 4)
      o.legenda.cores.forEach((k, i) => {
        c.fillStyle = k
        c.fillRect(lx, ly + i * 30, 26, 24)
        c.fillStyle = cor.fg3
        c.font = `400 20px ${sans}`
        if (i > 0 && o.legenda!.rotulos[i - 1]) c.fillText(o.legenda!.rotulos[i - 1], lx + 36, ly + i * 30 + 6)
      })
    }
  }

  // rodapé
  c.strokeStyle = cor.linha
  c.lineWidth = 2
  c.beginPath()
  c.moveTo(M, H - 110)
  c.lineTo(W - M, H - 110)
  c.stroke()
  c.fillStyle = cor.fg
  c.font = `500 32px ${sans}`
  c.fillText(o.url, M, H - 58)
  c.fillStyle = cor.fg3
  c.font = `400 24px ${sans}`
  const fw = c.measureText(o.fonte).width
  c.fillText(o.fonte, W - M - fw, H - 60)
  return cv
}

/** escreve com quebra de linha; devolve o y da última linha */
function texto(c: CanvasRenderingContext2D, t: string, x: number, y: number, larg: number, fonte: string, lh: number, maxLinhas: number) {
  c.font = fonte
  const palavras = t.split(/\s+/)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tenta = atual ? `${atual} ${p}` : p
    if (c.measureText(tenta).width > larg && atual) { linhas.push(atual); atual = p } else atual = tenta
  }
  if (atual) linhas.push(atual)
  const mostra = linhas.slice(0, maxLinhas)
  if (linhas.length > maxLinhas) {
    let u = mostra[maxLinhas - 1]
    while (c.measureText(u + '…').width > larg && u.length) u = u.slice(0, -1)
    mostra[maxLinhas - 1] = u + '…'
  }
  mostra.forEach((l, i) => c.fillText(l, x, y + i * lh))
  return y + (mostra.length - 1) * lh + lh
}

/** Modal com a prévia e as ações: compartilhar (celular), baixar, copiar link. Com mais de uma versão, mostra a escolha. */
export function abrirCompartilhar(versoes: { rotulo: string; cv: HTMLCanvasElement }[], nomeArquivo: string, url: string, textoCompartilhar: string) {
  let modal = document.getElementById('compartilhar')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'compartilhar'
    modal.className = 'metodo'
    document.body.appendChild(modal)
  }
  let atual = 0
  modal.innerHTML = `<div class="metodo-caixa compartilhar-caixa" role="dialog" aria-label="Compartilhar">
      <button class="fechar" aria-label="Fechar">×</button>
      <h2>Compartilhar</h2>
      ${versoes.length > 1 ? `<nav class="seg compartilhar-versoes" aria-label="Versão da imagem">${versoes.map((v, i) => `<button data-v="${i}" class="${i === 0 ? 'on' : ''}">${v.rotulo}</button>`).join('')}</nav>` : ''}
      <div class="compartilhar-previa"><img alt="Prévia da imagem para compartilhar" /></div>
      <div class="compartilhar-acoes">
        <button class="pill principal" data-a="share">Compartilhar imagem</button>
        <button class="pill" data-a="baixar">Baixar imagem</button>
        <button class="pill" data-a="link">Copiar link</button>
      </div>
      <p class="nota compartilhar-msg" aria-live="polite"></p>
    </div>`
  const img = modal.querySelector<HTMLImageElement>('.compartilhar-previa img')!
  const mostrar = (i: number) => {
    atual = i
    img.src = versoes[i].cv.toDataURL('image/png')
    modal!.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => b.classList.toggle('on', +b.dataset.v! === i))
  }
  mostrar(0)
  modal.hidden = false
  const msg = modal.querySelector<HTMLElement>('.compartilhar-msg')!
  const fechar = () => { modal!.hidden = true; document.removeEventListener('keydown', esc, true) }
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fechar() } }
  document.addEventListener('keydown', esc, true)
  modal.onclick = async (e) => {
    const alvo = e.target as HTMLElement
    if (alvo === modal || alvo.closest('.fechar')) return fechar()
    const v = alvo.closest<HTMLElement>('[data-v]')
    if (v) { mostrar(+v.dataset.v!); msg.textContent = ''; return }
    const a = alvo.closest<HTMLElement>('[data-a]')?.dataset.a
    if (!a) return
    const cv = versoes[atual].cv
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))
    if (a === 'share') {
      const file = blob ? new File([blob], nomeArquivo, { type: 'image/png' }) : null
      try {
        if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: `${textoCompartilhar} ${url}` })
        else if (navigator.share) await navigator.share({ text: textoCompartilhar, url })
        else { await copiar(url); msg.textContent = 'Este navegador não compartilha imagens. Copiamos o link; baixe a imagem para postar.' }
      } catch { /* cancelado pela pessoa */ }
    } else if (a === 'baixar' && blob) {
      const u = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = u
      link.download = nomeArquivo
      link.click()
      setTimeout(() => URL.revokeObjectURL(u), 2000)
      msg.textContent = 'Imagem baixada.'
    } else if (a === 'link') {
      msg.textContent = (await copiar(url)) ? 'Link copiado.' : url
    }
  }
}

async function copiar(t: string) {
  try { await navigator.clipboard.writeText(t); return true } catch { return false }
}
