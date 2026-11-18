import './style.css'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { carregar, ficha, UF_COD, UF_NOME, type Brasil, type MapaDados, type Meta, type Causa, type Limite } from './dados'
import { Mapa } from './mapa'
import { barras } from './graficos'
import { desenharCard, abrirCompartilhar, type CardOpts } from './card'
import { arquivoFoto, carregarImagem, creditoFoto, preencherFoto, urlFoto, urlOriginal } from './foto'
import * as f from './fmt'
import { montarSecoes } from './secoes'

type Sel = { tipo: 'br' } | { tipo: 'uf'; uf: string } | { tipo: 'mun'; i: number }
type Props = { codarea: string }

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const app = $('#app')
montarSecoes('energia')

// faixas da escala (horas por consumidor); 7 cores, de --m0 a --m6
const FAIXAS: Record<number, number[]> = { 12: [8, 12, 20, 32, 50, 80], 1: [0.5, 1, 2, 4, 8, 16] }
const PEQUENOS = ['RN', 'PB', 'PE', 'AL', 'SE', 'ES', 'RJ', 'DF']
// camada "Limite ANEEL": DEC em 12 meses ÷ limite, em %; 6 cores de --l0 (bem abaixo) a --l5 (bem acima)
const FAIXAS_LIM = [60, 80, 100, 120, 150]
type Camada = 'horas' | 'limite'

async function iniciar() {
  const limP = carregar<Limite>('data/limite.json')
  const [meta, brasil, mapa, topoMun, topoUf] = await Promise.all([
    carregar<Meta>('data/meta.json'),
    carregar<Brasil>('data/brasil.json'),
    carregar<MapaDados>('data/mapa.json'),
    carregar<Topology<{ BRMU: GeometryCollection<Props> }>>('geo/municipios.topo.json'),
    carregar<Topology<{ BRUF: GeometryCollection<Props> }>>('geo/ufs.topo.json'),
  ])
  const N = mapa.cods.length
  const M = mapa.meses.length
  const ultimo = M - 1
  const idxCod = new Map(mapa.cods.map((c, i) => [c, i]))

  // somas acumuladas por município para janelas móveis
  const acH = mapa.horas10.map((linha) => { const a = new Float64Array(M + 1); linha.forEach((v, j) => (a[j + 1] = a[j] + v / 10)); return a })
  const acQ = mapa.quedas.map((linha) => { const a = new Float64Array(M + 1); linha.forEach((v, j) => (a[j + 1] = a[j] + v)); return a })
  // ano sem nenhum registro no município = sem dado (área de cooperativa ou conjunto sem correspondência)
  const anoDe = mapa.meses.map((m) => m.slice(0, 4))
  const temAno = mapa.horas10.map((linha) => {
    const s = new Set<string>()
    linha.forEach((v, j) => v > 0 && s.add(anoDe[j]))
    return s
  })
  const ufMesAc: Record<string, Float64Array> = {}
  for (const [uf, arr] of Object.entries(brasil.ufMes)) { const a = new Float64Array(M + 1); arr.forEach((v, j) => (a[j + 1] = a[j] + v)); ufMesAc[uf] = a }
  const brAc = new Float64Array(M + 1); brasil.serie.forEach((s, j) => (brAc[j + 1] = brAc[j] + s.h))
  const brN = new Float64Array(M + 1); brasil.serie.forEach((s, j) => (brN[j + 1] = brN[j] + s.n))
  const brAf = new Float64Array(M + 1); brasil.serie.forEach((s, j) => (brAf[j + 1] = brAf[j] + s.af))

  const st = { t: ultimo, janela: 12 as 1 | 12, sel: { tipo: 'br' } as Sel, tocando: 0, camada: 'horas' as Camada }
  let lim: Limite | null = null
  let limMin = 11
  const ini = (t: number) => Math.max(0, t - st.janela + 1)
  const soma = (a: ArrayLike<number>, t: number) => a[t + 1] - a[ini(t)]
  const valorMun = (i: number, t = st.t): number | null => (temAno[i].has(anoDe[t]) ? soma(acH[i], t) : null)
  const quedasMun = (i: number, t = st.t) => soma(acQ[i], t)
  const valorUf = (uf: string, t = st.t) => soma(ufMesAc[uf], t)
  const valorBr = (t = st.t) => soma(brAc, t)
  const anterior = (t: number) => t - st.janela

  // cores
  let rampa: string[] = []
  const lerRampa = () => {
    const cs = getComputedStyle(document.documentElement)
    rampa = [0, 1, 2, 3, 4, 5, 6].map((k) => cs.getPropertyValue(`--m${k}`).trim())
    rampa.push(cs.getPropertyValue('--m-sem').trim())
  }
  lerRampa()
  let rampaL: string[] = []
  const lerRampaL = () => {
    const cs = getComputedStyle(document.documentElement)
    rampaL = [0, 1, 2, 3, 4, 5].map((k) => cs.getPropertyValue(`--l${k}`).trim())
  }
  lerRampaL()
  const faixa = (v: number, fx = FAIXAS[st.janela]) => { let k = 0; while (k < fx.length && v >= fx[k]) k++; return k }
  const corHoras = (v: number | null) => (v == null ? rampa[7] : rampa[faixa(v)])
  const corLim = (v: number | null) => (v == null ? rampa[7] : rampaL[faixa(v, FAIXAS_LIM)])
  const ehLim = () => st.camada === 'limite' && lim != null
  const cor = (v: number | null) => (ehLim() ? corLim(v) : corHoras(v))
  // valor da camada ativa
  const razaoMun = (i: number, t = st.t) => lim?.razao[i]?.[t] ?? null
  const razaoUf = (uf: string, t = st.t) => lim?.ufRazao[uf]?.[t] ?? null
  const valorC = (i: number) => (ehLim() ? razaoMun(i) : valorMun(i))
  const valorUfC = (uf: string): number | null => (ehLim() ? razaoUf(uf) : valorUf(uf))
  const fmtC = (v: number | null) => (v == null ? '–' : ehLim() ? `${f.int(v)}%` : f.horas(v))
  const tintaSobre = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16)
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
    return l > 0.55 ? '#171512' : '#fafaf9'
  }

  // geometria na mesma ordem dos índices de mapa.json
  const fcMun = feature(topoMun, topoMun.objects.BRMU) as FeatureCollection<Geometry, Props>
  const porCod = new Map(fcMun.features.map((ft) => [+ft.properties.codarea, ft]))
  const vazio: Feature<Geometry, Props> = { type: 'Feature', properties: { codarea: '0' }, geometry: { type: 'Polygon', coordinates: [] } }
  const muns = mapa.cods.map((c) => porCod.get(c) ?? vazio)
  const fcUf = feature(topoUf, topoUf.objects.BRUF) as FeatureCollection<Geometry, Props>

  const pequeno = () => window.innerWidth <= 760
  const tip = $('#tip')
  const palco = $('#palco')
  const mapaCv = new Mapa($('#mapa') as HTMLCanvasElement, muns, fcUf, (i) => mapa.ufs[i], (c) => UF_COD[c], {
    valor: (i) => valorC(i),
    cor,
    rotuloUf: (uf) => { const v = valorUfC(uf); return v == null ? null : fmtC(v) },
    onHover: (i, x, y) => mostrarTip(i, x, y),
    onHoverUf: (uf, x, y) => mostrarTipUf(uf, x, y),
    onClickUf: (uf) => selecionar({ tipo: 'uf', uf }, true),
    onClick: (i) => {
      if (i == null) return
      const uf = mapa.ufs[i]
      if (!mapaCv.ufFoco || mapaCv.ufFoco !== uf) {
        if (st.sel.tipo === 'br' || (st.sel.tipo === 'uf' && st.sel.uf !== uf) || st.sel.tipo === 'mun') selecionar({ tipo: 'mun', i }, true)
      } else selecionar({ tipo: 'mun', i }, false)
    },
    comChips: () => !pequeno(),
    nomeMun: (i) => mapa.nomes[i],
    pesoMun: (i) => mapa.dom[i],
    obstaculos: () => {
      const base = palco.getBoundingClientRect()
      return ['#legenda', '#tempo', '#trilha', '.zoom'].flatMap((q) => {
        const el = palco.querySelector<HTMLElement>(q)
        if (!el || !el.offsetWidth) return []
        const r = el.getBoundingClientRect()
        return [[r.left - base.left - 4, r.top - base.top - 4, r.right - base.left + 4, r.bottom - base.top + 4] as [number, number, number, number]]
      })
    },
    margem: pequeno() ? { t: 64, r: 8, b: 120, l: 8 } : { t: 46, r: 96, b: 84, l: 24 },
  })

  // estado sob o mouse: nome, valor e o convite para clicar
  function mostrarTipUf(uf: string | null, x: number, y: number) {
    if (uf == null) { tip.classList.remove('on'); return }
    const v = valorUfC(uf)
    const per = ehLim() || st.janela === 12 ? `12 meses até ${f.mes(mapa.meses[st.t])}` : f.mesLongo(mapa.meses[st.t])
    const num = v == null ? '–' : ehLim() ? `${f.int(v)}%` : f.horasNum(v)
    const rot = ehLim() ? 'do limite da ANEEL' : 'horas sem energia por consumidor'
    tip.innerHTML = `<div class="t">${UF_NOME[uf]}</div><div class="s">${per}</div><div class="v">${num}<small>${rot}</small></div><div class="aviso">Clique para ver as cidades</div>`
    const pw = palco.clientWidth, ph = palco.clientHeight
    const tw = tip.offsetWidth || 240, th = tip.offsetHeight || 130
    let tx = x + 16, ty = y - th / 2
    if (tx + tw > pw - 10) tx = x - tw - 16
    ty = Math.max(10, Math.min(ph - th - 80, ty))
    tip.style.left = `${tx}px`
    tip.style.top = `${ty}px`
    tip.classList.add('on')
  }

  function mostrarTip(i: number | null, x: number, y: number) {
    if (i == null) { tip.classList.remove('on'); return }
    if (ehLim()) { tip.innerHTML = tipLimite(i); return posicionarTip(x, y) }
    const v = valorMun(i)
    const a = anterior(st.t)
    const va = a >= 0 && temAno[i].has(anoDe[a]) ? soma(acH[i], a) : null
    const per = st.janela === 12 ? `12 meses até ${f.mes(mapa.meses[st.t])}` : f.mesLongo(mapa.meses[st.t])
    tip.innerHTML = `<div class="t">${f.esc(mapa.nomes[i])}</div><div class="s">${UF_NOME[mapa.ufs[i]]} · ${per}</div>` +
      (v == null
        ? `<div class="aviso">Sem registros neste período. Áreas atendidas por cooperativas não entram na base da ANEEL.</div>`
        : `<div class="v">${f.horasNum(v)}<small>horas sem energia por consumidor</small></div>
           <div class="r"><span>${f.int(quedasMun(i))} interrupções</span>${va ? `<span class="var ${v > va ? 'up' : 'down'}">${f.pct(v / va - 1)} vs ${st.janela === 12 ? '12 meses antes' : 'ano anterior'}</span>` : ''}</div>`)
    posicionarTip(x, y)
  }
  function tipLimite(i: number) {
    const r = razaoMun(i)
    const cab = `<div class="t">${f.esc(mapa.nomes[i])}</div><div class="s">${UF_NOME[mapa.ufs[i]]} · 12 meses até ${f.mes(mapa.meses[st.t])}</div>`
    if (r == null) return cab + `<div class="aviso">Sem dado de limite para este município. Áreas de cooperativas e conjuntos sem correspondência ficam de fora.</div>`
    const ano = +anoDe[st.t]
    const comp = lim!.munAno[i].find((x) => x[0] === ano)
    return cab + `<div class="v">${f.int(r)}%<small>do limite de horas sem energia da ANEEL</small></div>
      <div class="r"><span class="selo ${r > 100 ? 'acima' : 'dentro'}">${r > 100 ? 'acima do limite' : 'dentro do limite'}</span>${comp?.[3] != null ? `<span>${f.reais(comp[3])} em compensações em ${ano}*</span>` : ''}</div>
      ${comp?.[3] != null ? '<div class="aviso">* estimativa: compensações da área de atendimento repartidas entre os municípios</div>' : ''}`
  }
  function posicionarTip(x: number, y: number) {
    const pw = palco.clientWidth, ph = palco.clientHeight
    const tw = tip.offsetWidth || 240, th = tip.offsetHeight || 130
    let tx = x + 16, ty = y - th / 2
    if (tx + tw > pw - 10) tx = x - tw - 16
    ty = Math.max(10, Math.min(ph - th - 80, ty))
    tip.style.left = `${tx}px`
    tip.style.top = `${ty}px`
    tip.classList.add('on')
  }

  // ---------- chips dos estados pequenos ----------
  const chips = $('#chips')
  function desenharChips() {
    if (pequeno() || mapaCv.zoomado || (st.sel.tipo !== 'br' && mapaCv.ufFoco)) { chips.innerHTML = ''; return }
    const w = mapaCv.largura
    const xs = w - (pequeno() ? 52 : 84)
    const itens = PEQUENOS.map((uf) => ({ uf, c: mapaCv.centroUf(uf) })).filter((d) => d.c) as { uf: string; c: [number, number] }[]
    // empilha em ordem de altura mantendo espaçamento mínimo
    itens.sort((a, b) => a.c[1] - b.c[1])
    const passo = pequeno() ? 25 : 28
    let ult = -Infinity
    const ys = itens.map((d) => { const y = Math.max(d.c[1] - 12, ult + passo); ult = y; return y })
    let svg = '<svg>'
    let html = ''
    itens.forEach((d, k) => {
      const v = valorUfC(d.uf)
      const bg = cor(v)
      svg += `<line x1="${d.c[0]}" y1="${d.c[1]}" x2="${xs}" y2="${ys[k] + 12}"/><circle cx="${d.c[0]}" cy="${d.c[1]}" r="2" fill="currentColor" opacity=".6"/>`
      html += `<button class="chip" data-uf="${d.uf}" style="left:${xs}px;top:${ys[k]}px;background:${bg};color:${tintaSobre(bg)}">${d.uf}<b>${fmtC(v)}</b></button>`
    })
    chips.innerHTML = svg + '</svg>' + html
  }
  chips.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.chip')
    if (b) selecionar({ tipo: 'uf', uf: b.dataset.uf! }, true)
  })
  $('#mapa').addEventListener('vista', desenharChips)

  // ---------- legenda ----------
  function desenharLegenda() {
    if (ehLim()) {
      $('#legenda').innerHTML = `<div class="tit">Horas sem energia em 12 meses, em % do limite da ANEEL</div>
        <div class="esc">${rampaL.map((c) => `<span style="background:${c}"></span>`).join('')}</div>
        <div class="rot"><span></span>${FAIXAS_LIM.map((v) => `<span>${v}</span>`).join('')}</div>
        <div class="lados"><span>dentro do limite</span><span>acima</span></div>`
      return
    }
    const fx = FAIXAS[st.janela]
    $('#legenda').innerHTML = `<div class="tit">Horas sem energia por consumidor${st.janela === 12 ? ', em 12 meses' : ', no mês'}</div>
      <div class="esc">${rampa.slice(0, 7).map((c) => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="rot"><span></span>${fx.map((v) => `<span>${v < 1 ? f.int(v * 60) + 'm' : v}</span>`).join('')}</div>`
  }

  // ---------- linha do tempo ----------
  const slider = $('#slider') as HTMLInputElement
  function prepararRegua() {
    slider.min = String(ehLim() ? limMin : st.janela === 12 ? 11 : 0)
    slider.max = String(ultimo)
    if (st.t < +slider.min) st.t = +slider.min
    slider.value = String(st.t)
    const min = +slider.min
    const anos = $('#anos')
    anos.innerHTML = mapa.meses
      .map((m, j) => (m.endsWith('-01') && j >= min ? `<span style="left:${((j - min) / (ultimo - min)) * 100}%">${m.slice(pequeno() ? 2 : 0, 4)}</span>` : ''))
      .join('')
  }
  slider.addEventListener('input', () => { parar(); mudarT(+slider.value) })
  $('#btn-ultimo').addEventListener('click', () => { parar(); mudarT(ultimo) })
  const play = $('#play')
  const icoPlay = play.innerHTML
  function parar() {
    if (!st.tocando) return
    clearInterval(st.tocando)
    st.tocando = 0
    play.innerHTML = icoPlay
  }
  play.addEventListener('click', () => {
    if (st.tocando) return parar()
    if (st.t >= ultimo) mudarT(+slider.min)
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
    st.tocando = window.setInterval(() => { if (st.t >= ultimo) parar(); else mudarT(st.t + 1) }, 240)
  })

  function mudarT(t: number) {
    st.t = t
    slider.value = String(t)
    const m = mapa.meses[t]
    $('#tempo-rotulo').innerHTML = `${f.mes(m)}<small>${st.janela === 12 || ehLim() ? 'janela de 12 meses' : 'mês selecionado'}</small>`
    $('#btn-ultimo').classList.toggle('on', t === ultimo)
    mapaCv.desenhar()
    desenharChips()
    renderHero()
    renderEsq()
    renderDir(false)
    salvarUrl()
  }

  // ---------- seleção ----------
  function selecionar(s: Sel, zoom: boolean) {
    st.sel = s
    mapaCv.selecionar(s.tipo === 'mun' ? s.i : null)
    if (s.tipo === 'mun') mapaCv.focarMun(s.i, mapa.ufs[s.i])
    else if (zoom) mapaCv.focar(s.tipo === 'br' ? null : s.uf)
    renderTrilha()
    renderHero()
    renderEsq()
    renderDir(true)
    desenharChips()
    salvarUrl()
  }

  function renderTrilha() {
    const s = st.sel
    if (s.tipo === 'br' && !mapaCv.ufFoco) { $('#trilha').innerHTML = ''; return }
    const uf = s.tipo === 'uf' ? s.uf : s.tipo === 'mun' ? mapa.ufs[s.i] : mapaCv.ufFoco!
    $('#trilha').innerHTML = `<button data-ir="br">Brasil</button>›` +
      (s.tipo === 'mun' ? `<button data-ir="uf" data-uf="${uf}">${UF_NOME[uf]}</button>›<span class="atual">${f.esc(mapa.nomes[s.i])}</span>` : `<span class="atual">${UF_NOME[uf]}</span>`)
  }
  $('#trilha').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    if (b.dataset.ir === 'br') selecionar({ tipo: 'br' }, true)
    else selecionar({ tipo: 'uf', uf: b.dataset.uf! }, true)
  })

  // ---------- hero ----------
  function renderHero() {
    if (ehLim()) return renderHeroLimite()
    const s = st.sel
    const t = st.t
    const a = anterior(t)
    let nome = 'no Brasil', v = valorBr(t), va = a >= 0 ? valorBr(a) : null
    let n = soma(brN, t), af: number | null = soma(brAf, t)
    if (s.tipo === 'uf') { nome = `em ${UF_NOME[s.uf]}`; v = valorUf(s.uf); va = a >= 0 ? valorUf(s.uf, a) : null; n = somaUf(s.uf, quedasMun); af = null }
    if (s.tipo === 'mun') {
      nome = `em ${mapa.nomes[s.i]} (${mapa.ufs[s.i]})`
      const vm = valorMun(s.i)
      v = vm ?? NaN
      va = a >= 0 && temAno[s.i].has(anoDe[a]) ? soma(acH[s.i], a) : null
      n = quedasMun(s.i); af = null
    }
    const quando = st.janela === 12 ? `12 meses até ${f.mes(mapa.meses[t])}` : f.mesLongo(mapa.meses[t])
    const varia = va && !isNaN(v) ? `<span class="var ${v > va ? 'up' : 'down'}">${f.pct(v / va - 1)}</span>` : '–'
    const estimado = s.tipo === 'mun' && t < mapa.meses.indexOf(meta.corteMunicipio.slice(0, 7))
    const [num, un] = isNaN(v) ? ['–', ''] : v < 1 ? [f.int(Math.round(v * 60)), 'min'] : [f.horasNum(v), 'h']
    $('#hero').innerHTML = `
      <div class="num troca">${num}<small>${un}</small></div>
      <div class="frase troca">
        <b>${isNaN(v) ? `sem registros de interrupção ${nome}` : `sem energia por consumidor ${nome}`}</b>
        <span>média · ${quando}${estimado ? ' <em class="estim">· estimativa por área de atendimento</em>' : ''}</span>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="v">${varia}</div><div class="l">vs ${st.janela === 12 ? '12 meses antes' : 'mesmo mês do ano anterior'}</div></div>
        <div class="kpi"><div class="v">${f.compacto(n)}</div><div class="l">interrupções</div></div>
        ${af != null ? `<div class="kpi"><div class="v">${f.compacto(af)}</div><div class="l">vezes que alguém ficou sem energia</div></div>` : ''}
      </div>`
  }
  function renderHeroLimite() {
    const L = lim!
    const s = st.sel
    const t = st.t
    const ano = anoDe[t]
    const quando = `12 meses até ${f.mes(mapa.meses[t])}`
    const parcial = L.brAno[ano] && L.brAno[ano].meses < 12 ? ` (até ${f.mesCurto(mapa.meses[ultimo])})` : ''
    // rótulo curto do período das compensações: cabe em 2 linhas no card
    const periodoComp = parcial ? `jan a ${f.mesCurto(mapa.meses[ultimo])} ${ano}` : ano
    let num = '–', un = '', frase = '', kpis = ''
    const kpi = (v: string, l: string) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`
    if (s.tipo === 'br') {
      const p = L.brConsAcima[t]
      num = p == null ? '–' : f.int(p * 100); un = '%'
      frase = `<b>dos consumidores em área acima do limite da ANEEL</b><span>${quando}</span>`
      const A = L.brAno[ano]
      if (A?.reais != null) kpis += kpi(f.reais(A.reais), `compensações, ${periodoComp}`) + kpi(f.compacto(A.qtd ?? 0), 'créditos na conta de luz')
      // contagem de áreas só em ano fechado: DEC parcial contra limite anual não diz nada
      const anoF = A && A.meses < 12 ? String(+ano - 1) : ano
      const F = L.brAno[anoF]
      if (F) kpis += kpi(`${f.int(F.conjsAcima)} de ${f.int(F.conjs)}`, `áreas estouraram o limite em ${anoF}`)
    } else {
      const r = s.tipo === 'uf' ? razaoUf(s.uf) : razaoMun(s.i)
      const nome = s.tipo === 'uf' ? `em ${UF_NOME[s.uf]}` : `em ${mapa.nomes[s.i]} (${mapa.ufs[s.i]})`
      num = r == null ? '–' : f.int(r); un = r == null ? '' : '%'
      frase = r == null ? `<b>sem dado de limite ${nome}</b><span>área de cooperativa ou sem correspondência</span>`
        : `<b>do limite da ANEEL ${nome}</b><span>${quando} · ${r > 100 ? 'acima do limite' : 'dentro do limite'}</span>`
      const linha = s.tipo === 'uf' ? L.ufAno[s.uf]?.[ano] : (() => { const x = L.munAno[s.i].find((y) => String(y[0]) === ano); return x ? [x[1], x[2], x[3], x[4]] as const : undefined })()
      if (linha?.[2] != null) {
        kpis += kpi(f.reais(linha[2]), `compensações, ${periodoComp}`)
        const cons = s.tipo === 'uf' ? somaUf(s.uf, (i) => mapa.dom[i]) : mapa.dom[s.i]
        if (cons) kpis += kpi(f.reaisCent(linha[2] / cons), 'por consumidor')
      }
    }
    $('#hero').innerHTML = `<div class="num troca">${num}<small>${un}</small></div><div class="frase troca">${frase}</div>${kpis ? `<div class="kpis">${kpis}</div>` : ''}`
  }
  const somaUf = (uf: string, fn: (i: number) => number) => { let s = 0; for (let i = 0; i < N; i++) if (mapa.ufs[i] === uf) s += fn(i); return s }

  // ---------- painel esquerdo: Brasil ----------
  function renderEsqLimite() {
    const L = lim!
    const t = st.t
    const ufs = Object.keys(L.ufRazao).map((uf) => ({ uf, v: razaoUf(uf) })).filter((d) => d.v != null).sort((a, b) => b.v! - a.v!) as { uf: string; v: number }[]
    const maxUf = Math.max(150, ufs[0]?.v ?? 0)
    const selUf = st.sel.tipo === 'uf' ? st.sel.uf : st.sel.tipo === 'mun' ? mapa.ufs[st.sel.i] : null
    // distribuidoras: último ano completo até o mês escolhido
    let ano = anoDe[t]
    if (!L.brAno[ano] || L.brAno[ano].meses < 12) ano = String(+ano - 1)
    const dist = (L.distAno[ano] ?? []).filter((d) => d.n >= 300000).map((d) => ({ ...d, r: (d.dec / d.lim) * 100 })).sort((a, b) => b.r - a.r).slice(0, 10)
    const maxD = Math.max(150, dist[0]?.r ?? 0)
    $('#painel-esq').innerHTML = `
      <div class="bloco"><h2>Brasil, % do limite</h2><p class="sub">Horas sem energia em 12 meses ÷ limite</p><div id="g-br"></div></div>
      <div class="bloco"><h3>Estados</h3><p class="sub">% do limite, 12 meses até ${f.mes(mapa.meses[t])}</p>
        <ul class="rank" id="rank-uf">${ufs.map((d) => `<li data-uf="${d.uf}" class="${d.uf === selUf ? 'on' : ''}"><span class="tag">${d.uf}</span><span class="barra"><i style="width:${(d.v / maxUf) * 100}%;background:${corLim(d.v)}"></i></span><span class="val">${f.int(d.v)}%</span></li>`).join('')}</ul></div>
      <div class="bloco"><h3>Distribuidoras em ${ano}</h3><p class="sub">% do limite e compensações pagas, acima de 300 mil clientes</p>
        <ul class="rank dist">${dist.map((d) => `<li title="DEC ${f.horas(d.dec)} · limite ${f.horas(d.lim)}${d.reais != null ? ' · ' + f.reais(d.reais) + ' em compensações' : ''}"><span class="nome">${f.esc(d.sig)}</span><span class="val">${f.int(d.r)}%</span><span class="barra"><i style="width:${(d.r / maxD) * 100}%;background:${corLim(d.r)}"></i></span></li>`).join('')}</ul></div>`
    const idx = mapa.meses.map((_, j) => j).filter((j) => j >= limMin)
    barras($('#g-br'), {
      valores: idx.map((j) => L.brRazao[j] ?? 0), rotulos: idx.map((j) => mapa.meses[j]).map(f.mes),
      marcas: idx.map((j, k) => ({ k, m: mapa.meses[j] })).filter((d) => d.m.endsWith('-01') && +d.m.slice(0, 4) % 2 === 0).map((d) => ({ i: d.k, t: d.m.slice(0, 4) })),
      ativo: t - limMin, altura: 72, fmt: (v) => `${f.int(v)}%`, onClick: (k) => { parar(); mudarT(idx[k]) },
    })
    $('#rank-uf').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li')
      if (li) selecionar({ tipo: 'uf', uf: li.dataset.uf! }, true)
    })
  }

  function renderEsq() {
    if (ehLim()) return renderEsqLimite()
    const t = st.t
    const ano = anoDe[t]
    const A = brasil.anos[ano]
    const ufs = Object.keys(ufMesAc).map((uf) => ({ uf, v: valorUf(uf) })).sort((a, b) => b.v - a.v)
    const maxUf = ufs[0]?.v || 1
    const selUf = st.sel.tipo === 'uf' ? st.sel.uf : st.sel.tipo === 'mun' ? mapa.ufs[st.sel.i] : null
    const dist = (A?.distribuidoras ?? []).filter((d) => d.dec != null && (d.consumidores ?? 0) >= 300000).sort((a, b) => b.dec! - a.dec!)
    const top = dist.slice(0, 10)
    const maxD = top[0]?.dec || 1
    const parcial = A && A.meses < 12 ? ` (jan a ${f.mesCurto(mapa.meses[mapa.meses.lastIndexOf(mapa.meses.filter((m) => m.startsWith(ano)).pop()!)])})` : ''
    $('#painel-esq').innerHTML = `
      <div class="bloco"><h2>Brasil, mês a mês</h2><p class="sub">Horas por consumidor em cada mês</p><div id="g-br"></div></div>
      <div class="bloco"><h3>Estados</h3><p class="sub">${st.janela === 12 ? 'Horas por consumidor em 12 meses' : 'Horas por consumidor no mês'}</p>
        <ul class="rank" id="rank-uf">${ufs.map((d) => `<li data-uf="${d.uf}" class="${d.uf === selUf ? 'on' : ''}"><span class="tag">${d.uf}</span><span class="barra"><i style="width:${(d.v / maxUf) * 100}%"></i></span><span class="val">${f.horas(d.v)}</span></li>`).join('')}</ul></div>
      <div class="bloco"><h3>Distribuidoras em ${ano}${parcial}</h3><p class="sub">Horas por consumidor, acima de 300 mil clientes</p>
        <ul class="rank dist">${top.map((d) => `<li title="${f.esc(d.nome)}"><span class="nome">${f.esc(d.sig)}</span><span class="val">${f.horas(d.dec!)}</span><span class="barra"><i style="width:${(d.dec! / maxD) * 100}%"></i></span></li>`).join('')}</ul></div>`
    const marcas = mapa.meses.map((m, j) => ({ m, j })).filter((d) => d.m.endsWith('-01') && +d.m.slice(0, 4) % 2 === 1).map((d) => ({ i: d.j, t: d.m.slice(0, 4) }))
    barras($('#g-br'), {
      valores: brasil.serie.map((s) => s.h), rotulos: mapa.meses.map(f.mes), marcas, ativo: t, altura: 72,
      fmt: (v) => f.horas(v).replace(',0 ', ' '), onClick: (i) => { parar(); mudarT(Math.max(+slider.min, i)) },
    })
    $('#rank-uf').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li')
      if (li) selecionar({ tipo: 'uf', uf: li.dataset.uf! }, true)
    })
  }

  // ---------- painel direito: seleção ----------
  let renderId = 0
  async function renderDir(anima: boolean) {
    const id = ++renderId
    const s = st.sel
    const el = $('#painel-dir')
    const t = st.t
    const ano = anoDe[t]
    const per = st.janela === 12 ? `nos 12 meses até ${f.mes(mapa.meses[t])}` : `em ${f.mesLongo(mapa.meses[t])}`
    let html = ''
    if (s.tipo === 'br') {
      const A = brasil.anos[ano]
      html = `<div class="titulo-sel"><div><h2>Brasil</h2><div class="trilha-sel">${f.compacto(meta.consumidores)} consumidores · ${f.int(N)} municípios</div></div></div>
        ${ehLim() && lim?.brConsAcima[t] != null ? `<div class="big">${f.int(lim.brConsAcima[t]! * 100)}%<small>dos consumidores em área acima do limite da ANEEL, 12 meses até ${f.mes(mapa.meses[t])}</small></div>` : `<div class="big">${f.horasNum(valorBr())}<small>horas sem energia por consumidor ${per}</small></div>`}
        ${ehLim() ? blocoLimite() : ''}
        <div class="bloco"><h3>Por que faltou energia em ${ano}</h3><p class="sub">Parcela do tempo total sem energia, por causa informada pela distribuidora</p>${listaCausas(A?.causas ?? [])}</div>
        <div class="bloco"><h3>Maiores apagões de ${ano}</h3><p class="sub">Eventos que somaram mais horas sem energia (consumidores × duração)</p>
          <ul class="eventos">${(A?.maiores ?? []).slice(0, 8).map((e) => {
            const i = e.cod != null ? idxCod.get(e.cod) : undefined
            const onde = i != null ? `${mapa.nomes[i]} (${mapa.ufs[i]})` : e.conj
            return `<li class="${i != null ? 'clicavel' : ''}" ${i != null ? `data-i="${i}"` : ''}><span class="q">${f.esc(onde)}</span><span class="h">${f.horas(e.h)}</span>
              <span class="d">${f.dataHora(e.ini)} · ${f.int(e.af)} consumidores · ${f.esc(e.detalhe ?? e.causa ?? 'causa não informada')} · ${f.esc(e.sig)}${i != null && e.conj ? ` · área ${f.esc(e.conj)}` : ''}</span></li>`
          }).join('')}</ul>
          ${+ano < 2026 ? '<p class="nota">Antes de 2026 a ANEEL não informava o município de cada interrupção; mostramos o principal município da área atendida.</p>' : ''}</div>
        ${ehLim() ? '' : blocoLimite()}`
    } else if (s.tipo === 'uf') {
      const lista = Object.keys(ufMesAc).sort((a, b) => valorUf(b) - valorUf(a))
      const pos = lista.indexOf(s.uf) + 1
      const muns = [] as { i: number; v: number }[]
      for (let i = 0; i < N; i++) if (mapa.ufs[i] === s.uf) { const v = valorMun(i); if (v != null) muns.push({ i, v }) }
      muns.sort((a, b) => b.v - a.v)
      const ordemAlfa = Object.keys(UF_NOME).sort((a, b) => UF_NOME[a].localeCompare(UF_NOME[b]))
      html = `<div class="titulo-sel"><div><h2>${UF_NOME[s.uf]}</h2><div class="trilha-sel">${pos}º estado com mais horas sem energia · ${f.int(muns.length)} municípios com dados</div></div>
          <div class="nav"><button data-uf="${ordemAlfa[(ordemAlfa.indexOf(s.uf) + 26) % 27]}" aria-label="Estado anterior">‹</button><button data-uf="${ordemAlfa[(ordemAlfa.indexOf(s.uf) + 1) % 27]}" aria-label="Próximo estado">›</button></div></div>
        <div class="big">${f.horasNum(valorUf(s.uf))}<small>horas por consumidor ${per}</small></div>
        ${ehLim() ? blocoLimite() : ''}
        <div class="bloco"><h3>Mês a mês</h3><div id="g-sel"></div></div>
        <div class="bloco"><h3>Onde mais faltou energia</h3><p class="sub">Municípios ${per}</p>${listaMuns(muns.slice(0, 10))}</div>
        <div class="bloco"><h3>Onde menos faltou</h3>${listaMuns(muns.slice(-5).reverse())}</div>
        ${ehLim() ? '' : blocoLimite()}`
    } else {
      const i = s.i
      html = `<div class="titulo-sel"><div><h2>${f.esc(mapa.nomes[i])}</h2><div class="trilha-sel">${UF_NOME[mapa.ufs[i]]} · carregando…</div></div></div>`
      el.innerHTML = html
      const fc = await ficha(mapa.cods[i])
      if (id !== renderId) return
      const v = valorMun(i)
      const naUf: number[] = []
      for (let j = 0; j < N; j++) if (mapa.ufs[j] === mapa.ufs[i]) { const x = valorMun(j); if (x != null) naUf.push(x) }
      naUf.sort((a, b) => b - a)
      const pos = v != null ? naUf.indexOf(v) + 1 : 0
      const anos = Object.entries(fc.anos).filter(([a]) => meta.anos.includes(a)).sort()
      html = `<figure class="foto"></figure><div class="titulo-sel"><div><h2>${f.esc(fc.nome)}</h2><div class="trilha-sel">${UF_NOME[fc.uf]}${fc.dist.length ? ' · ' + fc.dist.map((d) => f.esc(d.sig)).join(', ') : ''}</div></div></div>
        <div class="big">${v == null ? '–' : f.horasNum(v)}<small>horas sem energia por consumidor ${per}</small></div>
        ${v != null ? `<p class="nota">${pos}º de ${naUf.length} em ${UF_NOME[fc.uf]} (1º = mais tempo sem energia). Cerca de ${f.compacto(fc.dom)} consumidores estimados.</p>` : '<p class="nota">Sem registros neste período. Áreas atendidas por cooperativas não entram na base da ANEEL.</p>'}
        ${blocoLimite()}
        <div class="bloco"><h3>Mês a mês</h3><div id="g-sel"></div></div>
        <div class="bloco"><h3>Ano a ano</h3><p class="sub">Horas por consumidor${anos.some(([a]) => a < '2026') ? ', estimadas para anos anteriores a 2026' : ''}</p><div id="g-anos"></div></div>
        <div class="bloco"><h3>Causas nos últimos 12 meses</h3>${listaCausas(fc.causas)}</div>
        <div class="bloco"><h3>Piores interrupções desde 2026</h3><p class="sub">Desde que a ANEEL passou a informar o município</p>
          <ul class="eventos">${fc.piores.map((e) => `<li><span class="q">${f.int(e.af)} consumidores</span><span class="h">${f.horas(e.h)}</span>
            <span class="d">${f.dataHora(e.ini)} · ${f.esc(e.detalhe ?? e.causa ?? 'causa não informada')}${e.local ? ' · ' + f.esc(e.local) : ''} · ${f.esc(e.sig)}</span></li>`).join('') || '<li><span class="d">Nenhuma registrada.</span></li>'}</ul></div>`
      el.innerHTML = html
      preencherFoto(el.querySelector('figure.foto'), fc.cod, fc.nome)
      const anosEl = el.querySelector<HTMLElement>('#g-anos')
      if (anosEl && anos.length) {
        const ultimoAno = meta.anos[meta.anos.length - 1]
        barras(anosEl, {
          valores: anos.map(([, d]) => d.chi / fc.dom), rotulos: anos.map(([a]) => (a === ultimoAno ? `${a} (até ${f.mesCurto(mapa.meses[ultimo])})` : a)),
          marcas: anos.map(([a], k) => ({ i: k, t: a.slice(2) })), ativo: anos.findIndex(([a]) => a === ano), altura: 90, fmt: (x) => f.horas(x),
        })
      }
    }
    if (s.tipo !== 'mun') el.innerHTML = html
    if (anima) { el.scrollTop = 0; el.classList.remove('troca'); void el.offsetWidth; el.classList.add('troca') }
    const g = el.querySelector<HTMLElement>('#g-sel')
    if (g) {
      const valores = s.tipo === 'uf' ? brasil.ufMes[s.uf] : s.tipo === 'mun' ? mapa.horas10[s.i].map((x) => x / 10) : []
      const marcas = mapa.meses.map((m, j) => ({ m, j })).filter((d) => d.m.endsWith('-01') && +d.m.slice(0, 4) % 2 === 1).map((d) => ({ i: d.j, t: d.m.slice(0, 4) }))
      barras(g, { valores, rotulos: mapa.meses.map(f.mes), marcas, ativo: st.t, altura: 100, fmt: (x) => f.horas(x), onClick: (j) => { parar(); mudarT(Math.max(+slider.min, j)) } })
    }
  }
  $('#painel-dir').addEventListener('click', (e) => {
    const alvo = e.target as HTMLElement
    const li = alvo.closest<HTMLElement>('[data-i]')
    if (li) return selecionar({ tipo: 'mun', i: +li.dataset.i! }, true)
    const nav = alvo.closest<HTMLElement>('[data-uf]')
    if (nav) selecionar({ tipo: 'uf', uf: nav.dataset.uf! }, true)
  })

  // ---------- limite da ANEEL e compensações ----------
  const EXPLICA = `<div class="explica">
      <p><b>O que é o limite.</b> A ANEEL fixa, para cada área de atendimento, um máximo anual de horas sem energia (o DEC). No DEC oficial não entram tempestades e emergências, por isso ele é menor que as horas do mapa.</p>
      <p><b>Compensação.</b> Também há limites para cada consumidor (DIC, FIC e DMIC). Se o seu passou, a distribuidora tem de dar um crédito na conta de luz, sem você pedir (PRODIST, Módulo 8). Se acha que deveria ter recebido e não recebeu, reclame na distribuidora e depois na ANEEL, pelo 167.</p>
    </div>`
  function linhasLimite(rows: { a: string; dec: number; lim: number; reais: number | null; meses?: number }[]) {
    const max = Math.max(...rows.map((r) => Math.max(r.dec, r.lim))) * 1.08 || 1
    return `<ul class="limite">${rows.map((r) => {
      const parcial = r.meses != null && r.meses < 12
      return `<li><span class="a">${r.a}${parcial ? '*' : ''}</span><span class="trilho"><i class="${r.dec > r.lim ? 'acima' : ''}" style="width:${(r.dec / max) * 100}%"></i><b style="left:${(r.lim / max) * 100}%"></b></span>
        <span class="v">${f.horasNum(r.dec)} / ${f.horasNum(r.lim)} h</span>${r.reais != null ? `<span class="r">${f.reais(r.reais)} em compensações</span>` : ''}</li>`
    }).join('')}</ul>
    <div class="limite-leg"><span><i></i>dentro</span><span><i class="acima"></i>acima</span><span><b></b>limite</span>${rows.some((r) => r.meses != null && r.meses < 12) ? `<span>* até ${f.mesCurto(mapa.meses[ultimo])}</span>` : ''}</div>`
  }
  function blocoLimite() {
    if (!lim) return `<div class="bloco"><h3>Limite da ANEEL</h3><p class="nota">Carregando…</p></div>`
    const L = lim
    const s = st.sel
    const parcialDe = (a: string) => L.brAno[a]?.meses
    if (s.tipo === 'br') {
      const rows = Object.entries(L.brAno).map(([a, d]) => ({ a, dec: d.dec, lim: d.lim, reais: d.reais, meses: d.meses }))
      return `<div class="bloco"><h3>Limite da ANEEL, ano a ano</h3><p class="sub">DEC oficial do Brasil (horas por consumidor) e o limite médio. Barra vermelha = acima.</p>
        ${linhasLimite(rows)}${EXPLICA}</div>`
    }
    if (s.tipo === 'uf') {
      const rows = Object.entries(L.ufAno[s.uf] ?? {}).sort().map(([a, d]) => ({ a, dec: d[0], lim: d[1], reais: d[2], meses: parcialDe(a) }))
      return `<div class="bloco"><h3>Limite da ANEEL em ${UF_NOME[s.uf]}</h3><p class="sub">DEC oficial e limite médio do estado, com as compensações pagas</p>
        ${rows.length ? linhasLimite(rows) : '<p class="nota">Sem dados.</p>'}${EXPLICA}</div>`
    }
    const i = s.i
    const areas = L.munConj[i]
    const rows = L.munAno[i].map((x) => ({ a: String(x[0]), dec: x[1], lim: x[2], reais: x[3], meses: parcialDe(String(x[0])) }))
    if (!rows.length) return `<div class="bloco"><h3>Limite da ANEEL</h3><p class="nota">Sem dado de limite para este município. Áreas atendidas por cooperativas e conjuntos sem correspondência ficam de fora.</p></div>`
    return `<div class="bloco"><h3>Passou do limite da ANEEL?</h3>
      ${areas.length ? `<p class="sub">Áreas de atendimento que cobrem ${f.esc(mapa.nomes[i])}, em ${L.anoConj}</p>
      <ul class="areas">${areas.map(([nome, sig, share, dec, lm]) => {
        const acima = lm != null && dec > lm
        return `<li><span>${f.esc(nome)}</span>${lm != null ? `<span class="selo ${acima ? 'acima' : 'dentro'}">${acima ? `${f.int((dec / lm) * 100)}% do limite` : 'dentro do limite'}</span>` : '<span></span>'}
          <span class="d">${f.esc(sig)} · DEC ${f.horas(dec)}${lm != null ? ` · limite ${f.horas(lm)}` : ''}${areas.length > 1 ? ` · ${f.int(share * 100)}% dos consumidores daqui` : ''}</span></li>`
      }).join('')}</ul>` : ''}
      <h3>Ano a ano no município</h3><p class="sub">Média das áreas, pesada pelos consumidores daqui. Compensações estimadas pela parte do município em cada área.</p>
      ${linhasLimite(rows)}${EXPLICA}</div>`
  }

  function listaCausas(cs: Causa[]) {
    const tot = cs.reduce((a, c) => a + c.chi, 0)
    if (!tot) return '<p class="nota">Sem registros.</p>'
    const top = cs.slice(0, 7)
    return `<ul class="causas">${top.map((c) => {
      const p = c.chi / tot
      return `<li><span class="n">${f.esc(c.detalhe === 'Não informado' ? c.causa : c.detalhe)} <span>· ${f.esc(c.causa)}</span></span><span class="p">${f.int(p * 100)}%</span><span class="trilho"><i style="width:${p * 100}%"></i></span></li>`
    }).join('')}</ul>`
  }
  function listaMuns(xs: { i: number; v: number }[]) {
    return `<ul class="eventos">${xs.map((d) => `<li class="clicavel" data-i="${d.i}"><span class="q">${f.esc(mapa.nomes[d.i])}</span><span class="h">${f.horas(d.v)}</span></li>`).join('')}</ul>`
  }

  // ---------- busca ----------
  const busca = $('#busca'), bInput = $('#busca-input') as HTMLInputElement, bLista = $('#busca-lista')
  const indice = mapa.nomes.map((n, i) => ({ i, k: f.semAcento(n) }))
  let resultados: number[] = [], cursor = 0
  function abrirBusca() { busca.hidden = false; bInput.value = ''; filtrar(); bInput.focus() }
  function fecharBusca() { busca.hidden = true }
  function filtrar() {
    const q = f.semAcento(bInput.value.trim())
    if (!q) resultados = [...mapa.cods.keys()].sort((a, b) => mapa.dom[b] - mapa.dom[a]).slice(0, 8)
    else {
      const ini = indice.filter((d) => d.k.startsWith(q)), meio = indice.filter((d) => !d.k.startsWith(q) && d.k.includes(q))
      resultados = [...ini.sort((a, b) => mapa.dom[b.i] - mapa.dom[a.i]), ...meio.sort((a, b) => mapa.dom[b.i] - mapa.dom[a.i])].slice(0, 8).map((d) => d.i)
    }
    cursor = 0
    desenharBusca()
  }
  function desenharBusca() {
    bLista.innerHTML = resultados.length
      ? resultados.map((i, k) => { const v = valorMun(i); return `<li role="option" data-i="${i}" class="${k === cursor ? 'on' : ''}"><span class="uf">${mapa.ufs[i]}</span><span><span class="n">${f.esc(mapa.nomes[i])}</span><br><span class="s">${f.compacto(mapa.dom[i])} consumidores</span></span><span class="h">${v == null ? '–' : f.horas(v)}</span></li>` }).join('')
      : '<li class="vazio">Nenhum município encontrado</li>'
  }
  function escolher(i: number) { fecharBusca(); selecionar({ tipo: 'mun', i }, true) }
  bInput.addEventListener('input', filtrar)
  bInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { cursor = Math.min(resultados.length - 1, cursor + 1); desenharBusca(); e.preventDefault() }
    else if (e.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); desenharBusca(); e.preventDefault() }
    else if (e.key === 'Enter' && resultados[cursor] != null) escolher(resultados[cursor])
  })
  bLista.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); if (li) escolher(+li.dataset.i!) })
  busca.addEventListener('click', (e) => { if (e.target === busca) fecharBusca() })
  $('#btn-busca').addEventListener('click', abrirBusca)

  // ---------- método ----------
  const metodo = $('#metodo')
  $('#metodo-corpo').innerHTML = `<h2>Como medimos</h2>
    <p>Todos os números vêm do conjunto de dados <a href="https://dadosabertos.aneel.gov.br/dataset/interrupcoes-de-energia-eletrica-nas-redes-de-distribuicao" target="_blank" rel="noopener">Interrupções de Energia Elétrica nas Redes de Distribuição</a>, publicado pela ANEEL, com cada interrupção registrada pelas distribuidoras desde ${f.mesLongo(mapa.meses[0])}. (A base de 2017 está incompleta e ficou de fora.) Dados até ${f.mesLongo(mapa.meses[ultimo])}, processados em ${f.data(meta.gerado)}.</p>
    <h3>Horas sem energia por consumidor</h3>
    <p>Para cada interrupção multiplicamos os consumidores atingidos pela duração. A soma dessas horas é dividida pelo número de consumidores do lugar. É a mesma ideia do DEC, o indicador oficial da ANEEL.</p>
    <h3>Por que o número é maior que o DEC oficial</h3>
    <p>O DEC oficial desconta eventos considerados fora do controle da distribuidora, como situações de emergência e dias críticos (tempestades fortes, por exemplo). Aqui eles entram, porque quem ficou sem energia ficou sem energia. Só tiramos registros que não são falta de energia na rede: ${meta.excluidos.map((x) => x.toLowerCase()).join('; ')}. Durações acima de ${meta.maxHoras / 24} dias são tratadas como erro de registro.</p>
    <h3>Consumidores por município</h3>
    <p>A ANEEL não publica quantos consumidores cada município tem. Estimamos usando os domicílios do Censo 2022 (IBGE), multiplicados por ${String(meta.fatorConsumidorDomicilio).replace('.', ',')}, a proporção entre os ${f.compacto(meta.consumidores)} consumidores ativos informados à ANEEL e os domicílios do país.</p>
    <h3>Antes de 2026</h3>
    <p>Até 2025 a base indicava só o conjunto de consumidores (a área de atendimento), não o município. Distribuímos o tempo sem energia de cada conjunto entre os municípios na mesma proporção observada em 2026. Isso cobre ${meta.coberturaAntigo ? f.int(meta.coberturaAntigo * 100) : '–'}% das horas registradas; o resto entra nos totais do Brasil e das distribuidoras, mas não no mapa. Os arquivos antigos da ANEEL trazem linhas repetidas, que removemos.</p>
    <h3>Limite da ANEEL e compensações</h3>
    <p>Vêm do conjunto <a href="https://dadosabertos.aneel.gov.br/dataset/indicadores-coletivos-de-continuidade-dec-e-fec" target="_blank" rel="noopener">Indicadores Coletivos de Continuidade</a>: o DEC oficial de cada área de atendimento mês a mês, o limite anual fixado pela ANEEL e o valor das compensações pagas. Na camada "Limite ANEEL", somamos o DEC dos últimos 12 meses e comparamos com o limite proporcional a esses meses. Quando a distribuidora ainda não publicou o mês mais recente, repetimos o último disponível (até 2 meses). Para municípios, as áreas são repartidas como no histórico antes de 2026, então valores de município são estimativas. Compensações só a partir de 2022, quando a série mensal fica completa.</p>
    <h3>O que não está aqui</h3>
    <p>Áreas atendidas por cooperativas (permissionárias) não estão na base da ANEEL e aparecem em cinza. Falhas na transmissão só aparecem quando derrubam a rede de distribuição.</p>
    <p class="nota">Código e processamento abertos. Encontrou algo estranho? Os dados brutos e a planilha de cada município podem ser conferidos na fonte.</p>`
  $('#btn-metodo').addEventListener('click', () => (metodo.hidden = false))
  $('#metodo-fechar').addEventListener('click', () => (metodo.hidden = true))
  metodo.addEventListener('click', (e) => { if (e.target === metodo) metodo.hidden = true })

  // ---------- compartilhar ----------
  async function compartilhar() {
    const s = st.sel
    const hero = $('#hero')
    const numEl = hero.querySelector('.num')
    const numero = numEl?.firstChild?.textContent?.trim() ?? ''
    const unidade = numEl?.querySelector('small')?.textContent?.trim() ?? ''
    const frase = hero.querySelector('.frase b')?.textContent?.trim() ?? ''
    const periodo = hero.querySelector('.frase span')?.textContent?.trim() ?? ''
    const destaques = [...hero.querySelectorAll('.kpi')].map((k) => `${k.querySelector('.v')?.textContent?.trim()} ${k.querySelector('.l')?.textContent?.trim()}`)
    let lugar = 'Brasil', sublugar = `${f.compacto(meta.consumidores)} consumidores · ${f.int(N)} municípios`
    let idx: number[] = []
    let contornos = fcUf.features
    let destaque: Feature<Geometry> | null = null
    if (s.tipo === 'br') idx = [...Array(N).keys()]
    else {
      const uf = s.tipo === 'uf' ? s.uf : mapa.ufs[s.i]
      // Fernando de Noronha fica longe da costa e encolhe o mapa de PE; só entra se for o município escolhido
      idx = [...Array(N).keys()].filter((i) => mapa.ufs[i] === uf && (mapa.cods[i] !== 2605459 || (s.tipo === 'mun' && s.i === i)))
      contornos = fcUf.features.filter((ft) => UF_COD[ft.properties.codarea] === uf)
      if (s.tipo === 'uf') { lugar = UF_NOME[uf]; sublugar = `${f.int(idx.length)} municípios` }
      else {
        lugar = mapa.nomes[s.i]; sublugar = UF_NOME[uf]; destaque = muns[s.i]
        const v = valorC(s.i)
        if (v != null && !ehLim()) {
          const vs = idx.map((i) => valorC(i)).filter((x): x is number => x != null).sort((a, b) => b - a)
          destaques.unshift(`${vs.indexOf(v) + 1}º de ${vs.length} em ${UF_NOME[uf]} (1º = mais tempo sem energia)`)
        }
      }
    }
    const leg = $('#legenda')
    let foto: { img: HTMLImageElement; credito: string } | null = null
    if (s.tipo === 'mun') {
      const arq = await arquivoFoto(mapa.cods[s.i])
      if (arq) {
        const [img0, cr] = await Promise.all([carregarImagem(urlFoto(arq, 1280)), creditoFoto(arq)])
        const img = img0 ?? (await carregarImagem(urlOriginal(arq)))
        if (img) foto = { img, credito: `Foto: ${cr.autor}${cr.licenca ? ` · ${cr.licenca}` : ''} · Wikimedia Commons` }
      }
    }
    // na cidade, o mapa do card é um zoom nos arredores (vale também para vizinhos de outro estado)
    if (s.tipo === 'mun') { idx = [...Array(N).keys()]; contornos = fcUf.features }
    const opts: CardOpts = {
      marca: 'minhainfra · energia', icone: 'raio', lugar, sublugar, numero, unidade, frase, periodo, destaques,
      legenda: {
        titulo: leg.querySelector('.tit')?.textContent?.trim() ?? '',
        cores: [...leg.querySelectorAll<HTMLElement>('.esc span')].map((x) => x.style.background),
        rotulos: [...leg.querySelectorAll('.rot span')].slice(1).map((x) => x.textContent ?? ''),
      },
      mapa: { feats: idx.map((i) => muns[i]), cores: idx.map((i) => cor(valorC(i))), destaque, contornos, zoom: s.tipo === 'mun' },
      url: location.host.includes('localhost') ? 'minhainfra.com/energia' : `${location.host}${location.pathname}`.replace(/\/$/, ''),
      fonte: 'Fonte: ANEEL',
    }
    // duas versões quando há foto: com a foto da cidade ou com o mapa
    const versoes = foto
      ? [{ rotulo: 'Com foto', cv: await desenharCard({ ...opts, foto }) }, { rotulo: 'Com mapa', cv: await desenharCard({ ...opts, foto: null }) }]
      : [{ rotulo: 'Com mapa', cv: await desenharCard({ ...opts, foto: null }) }]
    const slug = f.semAcento(lugar).replace(/[^a-z0-9]+/g, '-')
    abrirCompartilhar(versoes, `minhainfra-energia-${slug}.png`, location.href, `${numero}${unidade === '%' ? '%' : ' ' + unidade} ${frase}, ${periodo}.`)
  }
  $('#btn-compartilhar').addEventListener('click', () => { compartilhar().catch((e) => console.error(e)) })

  // ---------- teclado ----------
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); busca.hidden ? abrirBusca() : fecharBusca(); return }
    if (e.key === 'Escape') {
      if (!busca.hidden) return fecharBusca()
      if (!metodo.hidden) { metodo.hidden = true; return }
      if (st.sel.tipo === 'mun') return selecionar({ tipo: 'uf', uf: mapa.ufs[st.sel.i] }, true)
      if (st.sel.tipo === 'uf') return selecionar({ tipo: 'br' }, true)
    }
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
    if (e.key === '/' ) { e.preventDefault(); abrirBusca() }
    if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) { parar(); mudarT(Math.max(+slider.min, st.t - 1)) }
    if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) { parar(); mudarT(Math.min(ultimo, st.t + 1)) }
  })

  // ---------- camada ----------
  async function mudarCamada(c: Camada) {
    if (c === 'limite' && !lim) {
      $('#camada').classList.add('carregando')
      lim = await limP
      $('#camada').classList.remove('carregando')
    }
    st.camada = c
    document.querySelectorAll<HTMLElement>('#camada button').forEach((x) => x.classList.toggle('on', x.dataset.c === c))
    $('#janela').classList.toggle('travado', c === 'limite')
    $('#janela').title = c === 'limite' ? 'O limite da ANEEL é anual: esta camada usa sempre 12 meses' : ''
    document.querySelectorAll<HTMLElement>('#janela button').forEach((x) => x.classList.toggle('on', c === 'limite' ? x.dataset.j === '12' : +x.dataset.j! === st.janela))
    ;($('#mapa') as HTMLCanvasElement).setAttribute('aria-label', c === 'limite' ? 'Mapa do Brasil por horas sem energia em relação ao limite da ANEEL' : 'Mapa do Brasil por horas sem energia')
    prepararRegua(); desenharLegenda(); mudarT(st.t); renderDir(false)
  }
  $('#camada').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (b && b.dataset.c !== st.camada) mudarCamada(b.dataset.c as Camada)
  })
  limP.then((d) => {
    lim = d
    limMin = d.brRazao.findIndex((x) => x != null)
    if (limMin < 0) limMin = 11
    if (st.sel.tipo !== 'br' || st.camada === 'horas') renderDir(false)
  }).catch((e) => console.error('limite.json', e))

  // ---------- janela e tema ----------
  $('#janela').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    st.janela = +b.dataset.j! as 1 | 12
    document.querySelectorAll('#janela button').forEach((x) => x.classList.toggle('on', x === b))
    prepararRegua(); desenharLegenda(); mudarT(st.t); renderDir(false)
  })
  $('#btn-tema').addEventListener('click', () => {
    const escuro = getComputedStyle(document.documentElement).colorScheme.includes('dark')
    const novo = escuro ? 'light' : 'dark'
    document.documentElement.dataset.theme = novo
    try { localStorage.setItem('minhainfra-tema', novo) } catch { /* sem armazenamento */ }
    lerRampa(); lerRampaL(); mapaCv.lerCores(); desenharLegenda(); desenharChips(); renderDir(false); renderEsq()
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { lerRampa(); lerRampaL(); mapaCv.lerCores(); desenharLegenda(); desenharChips() })
  $('#zoom-mais').addEventListener('click', () => mapaCv.zoomPor(1.6))
  $('#zoom-menos').addEventListener('click', () => (mapaCv.ufFoco && st.sel.tipo !== 'br' ? selecionar({ tipo: 'br' }, true) : mapaCv.zoomPor(1 / 1.6)))

  // ---------- URL ----------
  function salvarUrl() {
    const p = new URLSearchParams()
    if (st.sel.tipo === 'uf') p.set('uf', st.sel.uf)
    if (st.sel.tipo === 'mun') p.set('m', String(mapa.cods[st.sel.i]))
    if (st.t !== ultimo) p.set('t', mapa.meses[st.t])
    if (st.janela === 1) p.set('j', '1')
    if (st.camada === 'limite') p.set('c', 'limite')
    const h = p.toString()
    history.replaceState(null, '', h ? `#${h}` : location.pathname)
  }
  function lerUrl() {
    const p = new URLSearchParams(location.hash.slice(1))
    if (p.get('j') === '1') { st.janela = 1; document.querySelectorAll('#janela button').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.j === '1')) }
    const t = p.get('t'); if (t && mapa.meses.includes(t)) st.t = mapa.meses.indexOf(t)
    const m = p.get('m'), uf = p.get('uf')
    if (m && idxCod.has(+m)) st.sel = { tipo: 'mun', i: idxCod.get(+m)! }
    else if (uf && UF_NOME[uf]) st.sel = { tipo: 'uf', uf }
  }

  // ---------- início ----------
  lerUrl()
  const querLimite = new URLSearchParams(location.hash.slice(1)).get('c') === 'limite'
  $('#atualizado').textContent = `Dados até ${f.mesLongo(mapa.meses[ultimo])} · ${f.int(meta.consumidores)} consumidores`
  prepararRegua()
  desenharLegenda()
  app.classList.remove('carregando')
  selecionar(st.sel, st.sel.tipo !== 'br')
  mudarT(st.t)
  if (querLimite) mudarCamada('limite')
}

iniciar().catch((e) => {
  console.error(e)
  $('#hero').innerHTML = `<h1>Não foi possível carregar os dados.</h1><p class="nota">${f.esc(String(e))}</p>`
  app.classList.remove('carregando')
})
