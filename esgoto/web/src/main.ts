import './style.css'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { carregar, ficha, UF_COD, UF_NOME, type Brasil, type MapaDados, type Meta, type Resumo } from './dados'
import { Mapa } from './mapa'
import { barras } from './graficos'
import { desenharCard, abrirCompartilhar, type CardOpts } from './card'
import { arquivoFoto, carregarImagem, creditoFoto, preencherFoto, urlFoto, urlOriginal } from './foto'
import * as f from './fmt'
import { montarSecoes } from './secoes'

type Sel = { tipo: 'br' } | { tipo: 'uf'; uf: string } | { tipo: 'mun'; i: number }
type Props = { codarea: string }
type Camada = 'semrede' | 'semtrat' | 'censo'

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
const app = $('#app')
montarSecoes('esgoto')
const PEQUENOS = ['RN', 'PB', 'PE', 'AL', 'SE', 'ES', 'RJ', 'DF']

// faixas de cor (7 cores, --m0 a --m6), em % (quanto mais, pior), e textos de cada camada
const CAMADAS: Record<Camada, {
  faixas: number[]; curto: string; titulo: string; un: string
  fmt: (v: number) => string; frase: (onde: string) => string; legenda: string; fonte: (ano: string, sinisa: boolean) => string
}> = {
  semrede: {
    faixas: [5, 15, 30, 50, 70, 90], curto: 'sem rede de esgoto', titulo: 'Sem rede de esgoto', un: '%',
    fmt: (v) => `${f.int(v)}%`, frase: (onde) => `da população sem rede de esgoto ${onde}`,
    legenda: '% da população sem rede coletora de esgoto',
    fonte: (ano, sinisa) => `em ${ano} · ${sinisa ? 'SINISA' : 'SNIS'}`,
  },
  semtrat: {
    faixas: [5, 15, 30, 50, 70, 90], curto: 'do esgoto sem tratamento', titulo: 'Esgoto sem tratamento', un: '%',
    fmt: (v) => `${f.int(v)}%`, frase: (onde) => `do esgoto sem tratamento ${onde}`,
    legenda: '% do esgoto gerado que não é tratado (referido à água consumida)',
    fonte: (ano, sinisa) => `em ${ano} · ${sinisa ? 'SINISA' : 'SNIS'}`,
  },
  censo: {
    faixas: [5, 15, 30, 50, 70, 90], curto: 'dos domicílios sem rede', titulo: 'Censo 2022', un: '%',
    fmt: (v) => `${f.int(v)}%`, frase: (onde) => `dos domicílios sem ligação à rede de esgoto ${onde}`,
    legenda: '% dos domicílios sem ligação à rede de esgoto (Censo 2022)',
    fonte: () => 'Censo 2022 · IBGE',
  },
}

async function iniciar() {
  const [meta, brasil, mapa, topoMun, topoUf] = await Promise.all([
    carregar<Meta>('data/meta.json'),
    carregar<Brasil>('data/brasil.json'),
    carregar<MapaDados>('data/mapa.json'),
    carregar<Topology<{ BRMU: GeometryCollection<Props> }>>('geo/municipios.topo.json'),
    carregar<Topology<{ BRUF: GeometryCollection<Props> }>>('geo/ufs.topo.json'),
  ])
  const N = mapa.cods.length
  const anos = mapa.anos
  const ultimo = anos.length - 1
  const idxCod = new Map(mapa.cods.map((c, i) => [c, i]))

  const st = { t: ultimo, sel: { tipo: 'br' } as Sel, tocando: 0, camada: 'semrede' as Camada }
  const C = () => CAMADAS[st.camada]
  const ano = (t = st.t) => String(anos[t])
  const ehSinisa = (t = st.t) => anos[t] >= meta.quebra

  const valorMunC = (c: Camada, i: number, t = st.t): number | null => {
    const v = mapa.camadas[c][i][t]
    return v == null ? null : v / 10
  }
  const valorMun = (i: number, t = st.t) => valorMunC(st.camada, i, t)
  const resumo = (s: Sel, t = st.t): Resumo | undefined =>
    s.tipo === 'br' ? brasil.anos[ano(t)] : s.tipo === 'uf' ? brasil.ufs[s.uf]?.[ano(t)] : undefined
  const valorRes = (r: Resumo | undefined, c = st.camada) => (r ? r[c] : null)
  const valorUf = (uf: string, t = st.t) => valorRes(brasil.ufs[uf]?.[ano(t)])
  const valorSel = (s: Sel, t = st.t, c = st.camada) => (s.tipo === 'mun' ? valorMunC(c, s.i, t) : valorRes(resumo(s, t), c))

  // cores
  let rampa: string[] = []
  const lerRampa = () => {
    const cs = getComputedStyle(document.documentElement)
    rampa = [0, 1, 2, 3, 4, 5, 6].map((k) => cs.getPropertyValue(`--m${k}`).trim())
    rampa.push(cs.getPropertyValue('--m-sem').trim())
  }
  lerRampa()
  const faixa = (v: number) => { const fx = C().faixas; let k = 0; while (k < fx.length && v >= fx[k]) k++; return k }
  const cor = (v: number | null) => (v == null ? rampa[7] : rampa[faixa(v)])
  const tintaSobre = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16)
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
    return l > 0.55 ? '#171512' : '#fafaf9'
  }
  const fmtV = (v: number | null) => (v == null ? '–' : C().fmt(v))

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
    valor: (i) => valorMun(i),
    cor,
    rotuloUf: (uf) => { const v = valorUf(uf); return v == null ? null : fmtV(v) },
    onHover: (i, x, y) => mostrarTip(i, x, y),
    onHoverUf: (uf, x, y) => mostrarTipUf(uf, x, y),
    onClickUf: (uf) => selecionar({ tipo: 'uf', uf }, true),
    onClick: (i) => { if (i != null) selecionar({ tipo: 'mun', i }, true) },
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

  function motivoSemDado(_i: number) {
    if (st.camada === 'censo') return 'Sem dado do Censo 2022 para este município.'
    return `O município não informou ${st.camada === 'semrede' ? 'rede de esgoto' : 'tratamento de esgoto'} ao ${ehSinisa() ? 'SINISA' : 'SNIS'} em ${ano()}. Em geral isso indica que não há rede pública. Veja a camada Censo 2022.`
  }

  // estado sob o mouse: nome, valor e o convite para clicar
  function mostrarTipUf(uf: string | null, x: number, y: number) {
    if (uf == null) { tip.classList.remove('on'); return }
    const v = valorUf(uf)
    const per = st.camada === 'censo' ? 'Censo 2022' : ano()
    const num = v == null ? '–' : fmtV(v)
    const rot = C().curto
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
    const v = valorMun(i)
    const va = st.t > 0 ? valorMun(i, st.t - 1) : null
    tip.innerHTML = `<div class="t">${f.esc(mapa.nomes[i])}</div><div class="s">${UF_NOME[mapa.ufs[i]]} · ${ano()}</div>` +
      (v == null
        ? `<div class="aviso">${motivoSemDado(i)}</div>`
        : `<div class="v">${f.int(v)}%<small>${C().curto}</small></div>
           <div class="r">${st.camada !== 'censo' && valorMunC('censo', i) != null ? `<span>Censo 2022: ${f.int(valorMunC('censo', i)!)}% dos domicílios sem rede</span>` : '<span></span>'}${st.camada !== 'censo' && va != null ? `<span class="var ${v > va ? 'up' : 'down'}">${v - va > 0 ? '+' : ''}${f.decimal(v - va)} p.p. vs ${anos[st.t - 1]}</span>` : ''}</div>`)
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
    const xs = mapaCv.largura - 84
    const itens = PEQUENOS.map((uf) => ({ uf, c: mapaCv.centroUf(uf) })).filter((d) => d.c) as { uf: string; c: [number, number] }[]
    itens.sort((a, b) => a.c[1] - b.c[1])
    let ult = -Infinity
    const ys = itens.map((d) => { const y = Math.max(d.c[1] - 12, ult + 28); ult = y; return y })
    let svg = '<svg>', html = ''
    itens.forEach((d, k) => {
      const v = valorUf(d.uf)
      const bg = cor(v)
      svg += `<line x1="${d.c[0]}" y1="${d.c[1]}" x2="${xs}" y2="${ys[k] + 12}"/><circle cx="${d.c[0]}" cy="${d.c[1]}" r="2" fill="currentColor" opacity=".6"/>`
      html += `<button class="chip" data-uf="${d.uf}" style="left:${xs}px;top:${ys[k]}px;background:${bg};color:${tintaSobre(bg)}">${d.uf}<b>${fmtV(v)}</b></button>`
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
    const c = C()
    $('#legenda').innerHTML = `<div class="tit">${c.legenda}</div>
      <div class="esc">${rampa.slice(0, 7).map((x) => `<span style="background:${x}"></span>`).join('')}</div>
      <div class="rot"><span></span>${c.faixas.map((v) => `<span>${f.decimal(v)}</span>`).join('')}</div>
      <div class="lados"><span>tem rede</span><span>${st.camada === 'censo' ? 'sem rede' : 'cinza: não informou'}</span></div>`
  }

  // ---------- linha do tempo (anual) ----------
  const slider = $('#slider') as HTMLInputElement
  function prepararRegua() {
    slider.min = '0'
    slider.max = String(ultimo)
    slider.value = String(st.t)
    // um rótulo a cada 2 anos (15 anos lado a lado ficam colados); a troca SNIS → SINISA vira só um traço discreto
    const pos = (j: number) => (j / ultimo) * 100
    const iq = anos.indexOf(meta.quebra)
    $('#anos').innerHTML = anos
      .map((a, j) => ((ultimo - j) % 2 ? '' : `<span style="left:${pos(j)}%">${pequeno() ? String(a).slice(2) : a}</span>`))
      .join('') + (iq > 0 ? `<i class="quebra" style="left:${(pos(iq - 1) + pos(iq)) / 2}%" title="Até ${meta.quebra - 1} os dados vêm do SNIS; a partir de ${meta.quebra}, do SINISA, com outro questionário"></i>` : '')
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
    if (st.t >= ultimo) mudarT(0)
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
    st.tocando = window.setInterval(() => { if (st.t >= ultimo) parar(); else mudarT(st.t + 1) }, 700)
  })

  function mudarT(t: number) {
    st.t = t
    slider.value = String(t)
    $('#tempo-rotulo').innerHTML = st.camada === 'censo' ? `2022<small>Censo IBGE</small>` : `${anos[t]}<small>${anos[t] >= meta.quebra ? 'SINISA' : 'SNIS'}</small>`
    $('#btn-ultimo').classList.toggle('on', t === ultimo)
    mapaCv.desenhar()
    desenharChips()
    desenharLegenda()
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

  const nomeSel = (s: Sel) => (s.tipo === 'br' ? 'no Brasil' : s.tipo === 'uf' ? `em ${UF_NOME[s.uf]}` : `em ${mapa.nomes[s.i]} (${mapa.ufs[s.i]})`)

  // ---------- hero ----------
  function renderHero() {
    const s = st.sel
    const t = st.t
    const v = valorSel(s)
    const va = t > 0 ? valorSel(s, t - 1) : null
    const c = C()
    const kpi = (x: string, l: string) => `<div class="kpi"><div class="v">${x}</div><div class="l">${l}</div></div>`
    let num = '–', un = ''
    if (v != null) [num, un] = [f.int(v), '%']
    const frase = v == null
      ? `<b>${c.titulo}: sem dado ${nomeSel(s)}</b><span>${s.tipo === 'mun' ? motivoSemDado(s.i) : ano()}</span>`
      : `<b>${c.frase(nomeSel(s))}</b><span>${c.fonte(ano(), ehSinisa())}${s.tipo !== 'mun' && st.camada !== 'censo' ? ' · quem não informou conta como sem rede' : ''}</span>`
    let kpis = ''
    if (st.camada !== 'censo' && v != null && va != null) kpis += kpi(`<span class="var ${v > va ? 'up' : 'down'}">${v - va > 0 ? '+' : ''}${f.decimal(v - va)} p.p.</span>`, `vs ${anos[t - 1]}${anos[t] === meta.quebra ? ' (mudou a fonte)' : ''}`)
    if (st.camada !== 'censo') {
      const vc = valorSel(s, t, 'censo')
      if (vc != null) kpis += kpi(`${f.int(vc)}%`, 'domicílios sem rede no Censo 2022')
    }
    if (s.tipo !== 'mun') {
      const r = resumo(s)
      if (r && st.camada !== 'censo') kpis += kpi(f.int(r[`${st.camada}Municipios` as const]), 'municípios informaram')
    }
    $('#hero').innerHTML = `<div class="num troca">${num}<small>${un}</small></div><div class="frase troca">${frase}</div>${kpis ? `<div class="kpis">${kpis}</div>` : ''}`
  }

  // ---------- painel esquerdo ----------
  function renderEsq() {
    const t = st.t
    const ufs = Object.keys(brasil.ufs).map((uf) => ({ uf, v: valorUf(uf) })).filter((d) => d.v != null).sort((a, b) => b.v! - a.v!) as { uf: string; v: number }[]
    const maxUf = ufs[0]?.v || 1
    const selUf = st.sel.tipo === 'uf' ? st.sel.uf : st.sel.tipo === 'mun' ? mapa.ufs[st.sel.i] : null
    // municípios grandes (mais de 50 mil ligações) com mais falta de água no ano
    const grandes: { i: number; v: number }[] = []
    for (let i = 0; i < N; i++) { const v = valorMun(i); if (v != null && mapa.dom[i] >= 50000) grandes.push({ i, v }) }
    grandes.sort((a, b) => b.v - a.v)
    const top = grandes.slice(0, 10)
    const maxG = top[0]?.v || 1
    $('#painel-esq').innerHTML = `
      ${st.camada === 'censo'
        ? `<div class="bloco"><h2>Brasil, Censo 2022</h2><p class="sub">${f.int(brasil.anos[ano()]?.censo ?? 0)}% dos domicílios sem ligação à rede de esgoto. Retrato de um ano só.</p></div>`
        : `<div class="bloco"><h2>Brasil, ano a ano</h2><p class="sub">${C().titulo}, % (quem não informou conta como sem)</p><div id="g-br"></div></div>`}
      <div class="bloco"><h3>Estados</h3><p class="sub">${st.camada === 'censo' ? '% dos domicílios sem rede, Censo 2022' : `${C().titulo}, ${ano()}`}</p>
        ${ufs.length ? `<ul class="rank" id="rank-uf">${ufs.map((d) => `<li data-uf="${d.uf}" class="${d.uf === selUf ? 'on' : ''}"><span class="tag">${d.uf}</span><span class="barra"><i style="width:${(d.v / maxUf) * 100}%"></i></span><span class="val">${fmtV(d.v)}</span></li>`).join('')}</ul>` : `<p class="nota">Sem dado em ${ano()}.</p>`}</div>
      <div class="bloco"><h3>Cidades grandes</h3><p class="sub">Mais de 50 mil domicílios, ${st.camada === 'censo' ? 'Censo 2022' : 'em ' + ano()}</p>
        <ul class="rank dist" id="rank-mun">${top.map((d) => `<li data-i="${d.i}" title="${f.esc(mapa.nomes[d.i])} (${mapa.ufs[d.i]})"><span class="nome">${f.esc(mapa.nomes[d.i])} <span class="uf-mini">${mapa.ufs[d.i]}</span></span><span class="val">${fmtV(d.v)}</span><span class="barra"><i style="width:${(d.v / maxG) * 100}%"></i></span></li>`).join('') || '<li><span class="nome">Sem dado</span></li>'}</ul></div>`
    const serie = anos.map((_, j) => valorRes(brasil.anos[String(anos[j])]) ?? 0)
    if (document.querySelector('#g-br')) barras($('#g-br'), {
      valores: serie, rotulos: anos.map(String), marcas: anos.map((a, j) => ({ i: j, t: String(a).slice(2) })).filter((_, j) => j % 2 === 0),
      ativo: t, altura: 72, fmt: (v) => fmtV(v).replace(',0 ', ' '), onClick: (j) => { parar(); mudarT(j) },
    })
    $('#rank-uf')?.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li')
      if (li) selecionar({ tipo: 'uf', uf: li.dataset.uf! }, true)
    })
    $('#rank-mun').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
      if (li) selecionar({ tipo: 'mun', i: +li.dataset.i! }, true)
    })
  }

  // ---------- painel direito ----------
  const EXPLICA = `<div class="explica">
      <p><b>De onde vem.</b> A série anual vem do SNIS e do SINISA, informados pelo prestador do serviço (empresa estadual, autarquia ou prefeitura), sem auditoria. O Censo 2022 do IBGE pergunta a cada domicílio para onde vai o esgoto do banheiro e cobre todos os municípios.</p>
      <p><b>Fossa não é rede.</b> Fossa rudimentar, vala ou despejo em rio contaminam o solo e a água. Fossa séptica bem feita é uma solução aceita onde não há rede.</p>
    </div>`

  let renderId = 0
  async function renderDir(anima: boolean) {
    const id = ++renderId
    const s = st.sel
    const el = $('#painel-dir')
    const t = st.t
    const c = C()
    let html = ''
    const serieDe = (cam: Camada) => anos.map((_, j) => valorSel(s, j, cam))
    const grafico = (idEl: string, cam: Camada, tit: string) => {
      const sr = serieDe(cam)
      return sr.some((x) => x != null) ? `<div class="bloco"><h3>${tit}</h3><div id="${idEl}"></div></div>` : ''
    }
    if (s.tipo === 'br' || s.tipo === 'uf') {
      const r = resumo(s)
      const v = valorSel(s)
      const nomeT = s.tipo === 'br' ? 'Brasil' : UF_NOME[s.uf]
      const munsL: { i: number; v: number }[] = []
      for (let i = 0; i < N; i++) if (s.tipo === 'br' || mapa.ufs[i] === s.uf) { const x = valorMun(i); if (x != null) munsL.push({ i, v: x }) }
      munsL.sort((a, b) => b.v - a.v)
      const ordemAlfa = Object.keys(UF_NOME).sort((a, b) => UF_NOME[a].localeCompare(UF_NOME[b]))
      html = `<div class="titulo-sel"><div><h2>${nomeT}</h2><div class="trilha-sel">${r ? `${f.int(r[`${st.camada}Municipios` as const])} municípios com dado${st.camada === 'censo' ? ' no Censo 2022' : ` em ${ano()}`}` : `sem dado em ${ano()}`}</div></div>
          ${s.tipo === 'uf' ? `<div class="nav"><button data-uf="${ordemAlfa[(ordemAlfa.indexOf(s.uf) + 26) % 27]}" aria-label="Estado anterior">‹</button><button data-uf="${ordemAlfa[(ordemAlfa.indexOf(s.uf) + 1) % 27]}" aria-label="Próximo estado">›</button></div>` : ''}</div>
        <div class="big">${v == null ? '–' : fmtV(v)}<small>${c.curto}, ${c.fonte(ano(), ehSinisa())} (média pelos domicílios)</small></div>
        ${r && st.camada !== 'censo' ? `<p class="nota">${f.int(((r[`${st.camada}SemDado` as const] ?? 0) as number) * 100)}% dos domicílios estão em municípios que não informaram ${st.camada === 'semrede' ? 'rede' : 'tratamento'} e contam como sem atendimento, como na conta oficial.</p>` : ''}
        ${st.camada === 'censo' ? '' : grafico('g-1', st.camada, `${c.titulo}, ano a ano`)}
        <div class="bloco"><h3>Onde mais falta esgoto</h3><p class="sub">Municípios, ${st.camada === 'censo' ? 'Censo 2022' : ano()}</p>${listaMuns(munsL.slice(0, 10))}</div>
        ${munsL.length > 10 ? `<div class="bloco"><h3>Onde há mais rede</h3>${listaMuns(munsL.slice(-5).reverse())}</div>` : ''}
        <div class="bloco">${EXPLICA}</div>`
      el.innerHTML = html
    } else {
      const i = s.i
      el.innerHTML = `<div class="titulo-sel"><div><h2>${f.esc(mapa.nomes[i])}</h2><div class="trilha-sel">${UF_NOME[mapa.ufs[i]]} · carregando…</div></div></div>`
      const fc = await ficha(mapa.cods[i])
      if (id !== renderId) return
      const v = valorMun(i)
      const naUf: number[] = []
      for (let j = 0; j < N; j++) if (mapa.ufs[j] === mapa.ufs[i]) { const x = valorMun(j); if (x != null) naUf.push(x) }
      naUf.sort((a, b) => b - a)
      const pos = v != null ? naUf.indexOf(v) + 1 : 0
      const L = fc.anos[ano()]
      const prest = (L?.prest || Object.values(fc.anos).reverse().find((x) => x.prest)?.prest || '').split('|').map((x) => x.replace(/\[\d+\]/, '').trim()).filter(Boolean)
      const linha = (rot: string, val: string | null) => (val == null ? '' : `<li><span class="q">${rot}</span><span class="h">${val}</span></li>`)
      const n = (x: number | null | undefined, fn: (y: number) => string) => (x == null ? null : fn(x))
      const pc = (x: number) => `${f.decimal(x)}%`
      const ce = fc.censo
      const CAT: [keyof typeof ce, string][] = [['rede', 'Rede geral ou pluvial'], ['fossa_rede', 'Fossa ligada à rede'], ['fossa_septica', 'Fossa séptica (não ligada)'], ['fossa_rudimentar', 'Fossa rudimentar ou buraco'], ['vala', 'Vala'], ['rio', 'Rio, lago ou mar'], ['outra', 'Outra forma'], ['sem_banheiro', 'Sem banheiro']]
      const censoHtml = ce?.total ? `<div class="bloco"><h3>Para onde vai o esgoto (Censo 2022)</h3><p class="sub">${f.int(ce.total)} domicílios, pela resposta de cada um ao IBGE</p>
        <ul class="causas">${CAT.filter(([k]) => (ce[k] ?? 0) > 0).map(([k, rot]) => { const p = (ce[k] ?? 0) / (ce.total ?? 1); return `<li><span class="n">${rot}</span><span class="p">${f.decimal(p * 100)}%</span><span class="trilho"><i style="width:${p * 100}%"></i></span></li>` }).join('')}</ul></div>` : ''
      html = `<figure class="foto"></figure><div class="titulo-sel"><div><h2>${f.esc(fc.nome)}</h2><div class="trilha-sel">${UF_NOME[fc.uf]}${prest.length ? ' · ' + prest.map(f.esc).join(', ') : ''}</div></div></div>
        <div class="big">${v == null ? '–' : fmtV(v)}<small>${c.curto}, ${c.fonte(ano(), ehSinisa())}</small></div>
        <p class="nota">${v != null ? `${pos}º de ${naUf.length} em ${UF_NOME[fc.uf]} (1º = menos esgoto).` : motivoSemDado(i)}</p>
        ${censoHtml}
        ${grafico('g-1', 'semrede', 'Sem rede de esgoto, ano a ano')}
        ${grafico('g-2', 'semtrat', 'Esgoto sem tratamento, ano a ano')}
        ${L ? `<div class="bloco"><h3>O que o prestador informou em ${ano()}</h3>
          <ul class="eventos">
            ${linha('População atendida com rede', n(L.atend, pc))}
            ${linha('Esgoto tratado (sobre a água consumida)', n(L.tratado, pc))}
            ${linha('Esgoto coletado que é tratado', n(L.trat_coletado, pc))}
            ${linha('Pessoas atendidas', n(L.pop_atend, f.int))}
            ${linha('Extravasamentos de esgoto', n(L.extrav, f.int))}
            ${linha('Extravasamentos por km de rede', n(L.extrav_km, f.decimal))}
          </ul></div>` : ''}
        <div class="bloco">${EXPLICA}</div>`
      el.innerHTML = html
      preencherFoto(el.querySelector('figure.foto'), fc.cod, fc.nome)
    }
    if (anima) { el.scrollTop = 0; el.classList.remove('troca'); void el.offsetWidth; el.classList.add('troca') }
    const marcas = anos.map((a, j) => ({ i: j, t: String(a).slice(2) })).filter((_, j) => j % 2 === 0)
    ;([['g-1', s.tipo === 'mun' ? 'semrede' : st.camada], ['g-2', 'semtrat']] as [string, Camada][]).forEach(([idEl, cam]) => {
      const g = el.querySelector<HTMLElement>('#' + idEl)
      if (!g) return
      barras(g, {
        valores: serieDe(cam).map((x) => x ?? 0), rotulos: anos.map(String), marcas, ativo: t, altura: 90,
        fmt: (x) => CAMADAS[cam].fmt(x), onClick: (j) => { parar(); mudarT(j) },
      })
    })
  }
  $('#painel-dir').addEventListener('click', (e) => {
    const alvo = e.target as HTMLElement
    const li = alvo.closest<HTMLElement>('[data-i]')
    if (li) return selecionar({ tipo: 'mun', i: +li.dataset.i! }, true)
    const nav = alvo.closest<HTMLElement>('[data-uf]')
    if (nav) selecionar({ tipo: 'uf', uf: nav.dataset.uf! }, true)
  })
  function listaMuns(xs: { i: number; v: number }[]) {
    return `<ul class="eventos">${xs.map((d) => `<li class="clicavel" data-i="${d.i}"><span class="q">${f.esc(mapa.nomes[d.i])} <span class="uf-mini">${mapa.ufs[d.i]}</span></span><span class="h">${fmtV(d.v)}</span></li>`).join('')}</ul>`
  }

  // ---------- camada ----------
  function mudarCamada(c: Camada) {
    st.camada = c
    document.querySelectorAll<HTMLElement>('#camada button').forEach((x) => x.classList.toggle('on', x.dataset.c === c))
    mudarT(st.t)
    renderDir(false)
  }
  $('#camada').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (b && b.dataset.c !== st.camada) mudarCamada(b.dataset.c as Camada)
  })

  // ---------- busca ----------
  const busca = $('#busca'), bInput = $('#busca-input') as HTMLInputElement, bLista = $('#busca-lista')
  const indice = mapa.nomes.map((n, i) => ({ i, k: f.semAcento(n) }))
  const peso = (i: number) => mapa.dom[i]
  let resultados: number[] = [], cursor = 0
  function abrirBusca() { busca.hidden = false; bInput.value = ''; filtrar(); bInput.focus() }
  function fecharBusca() { busca.hidden = true }
  function filtrar() {
    const q = f.semAcento(bInput.value.trim())
    if (!q) resultados = [...mapa.cods.keys()].sort((a, b) => peso(b) - peso(a)).slice(0, 8)
    else {
      const ini = indice.filter((d) => d.k.startsWith(q)), meio = indice.filter((d) => !d.k.startsWith(q) && d.k.includes(q))
      resultados = [...ini.sort((a, b) => peso(b.i) - peso(a.i)), ...meio.sort((a, b) => peso(b.i) - peso(a.i))].slice(0, 8).map((d) => d.i)
    }
    cursor = 0
    desenharBusca()
  }
  function desenharBusca() {
    bLista.innerHTML = resultados.length
      ? resultados.map((i, k) => { const v = valorMun(i); return `<li role="option" data-i="${i}" class="${k === cursor ? 'on' : ''}"><span class="uf">${mapa.ufs[i]}</span><span><span class="n">${f.esc(mapa.nomes[i])}</span><br><span class="s">${f.compacto(peso(i))} domicílios</span></span><span class="h">${fmtV(v)}</span></li>` }).join('')
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
    <p>Três fontes oficiais: o <a href="https://app4.cidades.gov.br/serieHistorica/" target="_blank" rel="noopener">SNIS</a> (série histórica, ${anos[0]} a ${meta.quebra - 1}) e o <a href="https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/sinisa" target="_blank" rel="noopener">SINISA</a> (${meta.quebra} em diante), do Ministério das Cidades, informados pelos prestadores de esgoto; e o <a href="https://sidra.ibge.gov.br/tabela/6805" target="_blank" rel="noopener">Censo Demográfico 2022</a> do IBGE (tabela 6805), respondido por cada domicílio. Processados em ${f.data(meta.gerado)}.</p>
    <h3>Sem rede de esgoto</h3>
    <p>100% menos o índice de atendimento total de esgoto (IN056 no SNIS, IES0001 no SINISA): a parte da população do município que não é atendida pela rede coletora.</p>
    <h3>Esgoto sem tratamento</h3>
    <p>100% menos o índice de esgoto tratado referido à água consumida (IN046 no SNIS, IES2003 no SINISA). Mede quanto do esgoto que a cidade gera não passa por tratamento.</p>
    <h3>Censo 2022</h3>
    <p>Parte dos domicílios cujo esgoto não vai para a rede geral ou pluvial (nem para fossa ligada à rede). Cobre todos os municípios, inclusive os que não informam ao SNIS. É um retrato de 2022, não muda com a linha do tempo.</p>
    <h3>Municípios que não informaram</h3>
    <p>No mapa, aparecem em cinza. Nas médias de estados e do Brasil, contam como sem atendimento, como na conta oficial do SNIS, porque em geral não há rede. As médias são ponderadas pelos domicílios do Censo 2022.</p>
    <h3>Cuidados</h3>
    <p>Os dados do SNIS e do SINISA são autodeclarados e não auditados. Em ${meta.quebra} o sistema mudou de SNIS para SINISA, com outro questionário: compare ${meta.quebra - 1} com ${meta.quebra} com cautela. O Censo mede outra coisa (a resposta do morador) e pode diferir do que o prestador informa.</p>`
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
    let lugar = 'Brasil', sublugar = `${f.int(N)} municípios`
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
        const v = valorMun(s.i)
        if (v != null) {
          const vs = idx.map((i) => valorMun(i)).filter((x): x is number => x != null).sort((a, b) => b - a)
          destaques.unshift(`${vs.indexOf(v) + 1}º de ${vs.length} em ${UF_NOME[uf]} (1º = menos esgoto)`)
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
      marca: 'minhainfra · esgoto', icone: 'coco', lugar, sublugar, numero, unidade, frase, periodo, destaques,
      legenda: {
        titulo: leg.querySelector('.tit')?.textContent?.trim() ?? '',
        cores: [...leg.querySelectorAll<HTMLElement>('.esc span')].map((x) => x.style.background),
        rotulos: [...leg.querySelectorAll('.rot span')].slice(1).map((x) => x.textContent ?? ''),
      },
      mapa: { feats: idx.map((i) => muns[i]), cores: idx.map((i) => cor(valorMun(i))), destaque, contornos, zoom: s.tipo === 'mun' },
      url: location.host.includes('localhost') ? 'minhainfra.com/esgoto' : `${location.host}${location.pathname}`.replace(/\/$/, ''),
      fonte: st.camada === 'censo' ? 'Fonte: IBGE, Censo 2022' : 'Fonte: SNIS e SINISA',
    }
    // duas versões quando há foto: com a foto da cidade ou com o mapa
    const versoes = foto
      ? [{ rotulo: 'Com foto', cv: await desenharCard({ ...opts, foto }) }, { rotulo: 'Com mapa', cv: await desenharCard({ ...opts, foto: null }) }]
      : [{ rotulo: 'Com mapa', cv: await desenharCard({ ...opts, foto: null }) }]
    const slug = f.semAcento(lugar).replace(/[^a-z0-9]+/g, '-')
    abrirCompartilhar(versoes, `minhainfra-esgoto-${slug}.png`, location.href, `${numero}% ${frase}, ${periodo}.`)
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
    if (e.key === '/') { e.preventDefault(); abrirBusca() }
    if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) { parar(); mudarT(Math.max(0, st.t - 1)) }
    if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) { parar(); mudarT(Math.min(ultimo, st.t + 1)) }
  })

  // ---------- tema ----------
  $('#btn-tema').addEventListener('click', () => {
    const escuro = getComputedStyle(document.documentElement).colorScheme.includes('dark')
    const novo = escuro ? 'light' : 'dark'
    document.documentElement.dataset.theme = novo
    try { localStorage.setItem('minhainfra-tema', novo) } catch { /* sem armazenamento */ }
    lerRampa(); mapaCv.lerCores(); desenharLegenda(); desenharChips(); renderDir(false); renderEsq()
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { lerRampa(); mapaCv.lerCores(); desenharLegenda(); desenharChips() })
  $('#zoom-mais').addEventListener('click', () => mapaCv.zoomPor(1.6))
  $('#zoom-menos').addEventListener('click', () => (mapaCv.ufFoco && st.sel.tipo !== 'br' ? selecionar({ tipo: 'br' }, true) : mapaCv.zoomPor(1 / 1.6)))

  // ---------- URL ----------
  function salvarUrl() {
    const p = new URLSearchParams()
    if (st.sel.tipo === 'uf') p.set('uf', st.sel.uf)
    if (st.sel.tipo === 'mun') p.set('m', String(mapa.cods[st.sel.i]))
    if (st.t !== ultimo) p.set('a', String(anos[st.t]))
    if (st.camada !== 'semrede') p.set('c', st.camada)
    const h = p.toString()
    history.replaceState(null, '', h ? `#${h}` : location.pathname)
  }
  function lerUrl() {
    const p = new URLSearchParams(location.hash.slice(1))
    const a = p.get('a'); if (a && anos.includes(+a)) st.t = anos.indexOf(+a)
    const c = p.get('c') as Camada | null
    if (c && c in CAMADAS) { st.camada = c; document.querySelectorAll<HTMLElement>('#camada button').forEach((x) => x.classList.toggle('on', x.dataset.c === c)) }
    const m = p.get('m'), uf = p.get('uf')
    if (m && idxCod.has(+m)) st.sel = { tipo: 'mun', i: idxCod.get(+m)! }
    else if (uf && UF_NOME[uf]) st.sel = { tipo: 'uf', uf }
  }

  // ---------- início ----------
  lerUrl()
  $('#atualizado').textContent = `Dados de ${anos[0]} a ${anos[ultimo]} · SNIS, SINISA e Censo 2022`
  prepararRegua()
  desenharLegenda()
  app.classList.remove('carregando')
  selecionar(st.sel, st.sel.tipo !== 'br')
  mudarT(st.t)
}

iniciar().catch((e) => {
  console.error(e)
  $('#hero').innerHTML = `<div class="frase"><b>Não foi possível carregar os dados.</b><span>${f.esc(String(e))}</span></div>`
  app.classList.remove('carregando')
})
