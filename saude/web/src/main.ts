import './style.css'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { carregar, ficha, UF_COD, UF_NOME, CAMADAS_LISTA, type Brasil, type Camada, type MapaDados, type Meta, type Resumo } from './dados'
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
montarSecoes('saude')
const PEQUENOS = ['RN', 'PB', 'PE', 'AL', 'SE', 'ES', 'RJ', 'DF']
/** cidade grande, para o ranking do painel esquerdo */
const GRANDE = 100_000

/*
 * Cores: 7 tons (--m0 a --m6). Aqui mais é melhor, então a escala é invertida:
 * o tom mais forte (--m6) é "nenhum" (zero registrado) e os tons vão clareando conforme a oferta cresce.
 * Assim, como na água e na energia, o que chama a atenção no mapa é onde falta.
 * `faixas` são os 5 limites entre os 6 tons de quem tem alguma oferta.
 */
const CAMADAS: Record<Camada, {
  faixas: number[]; titulo: string; curto: string; por: string; porCurto: string
  campo: 'leitos' | 'leitosSus' | 'uti' | 'medicos' | 'tomografos'; nenhum: string; sem: string; legenda: string
  unidade: (n: number) => string
}> = {
  leitos: {
    faixas: [1, 1.5, 2, 3, 4.5], titulo: 'Leitos', curto: 'leitos', por: 'por mil habitantes', porCurto: 'por mil hab.',
    campo: 'leitos', nenhum: 'nenhum leito de internação', sem: 'leito de internação', legenda: 'Leitos de internação por mil habitantes',
    unidade: (n) => (n === 1 ? 'leito' : 'leitos'),
  },
  leitosSus: {
    faixas: [1, 1.5, 2, 2.5, 3.5], titulo: 'Leitos SUS', curto: 'leitos SUS', por: 'por mil habitantes', porCurto: 'por mil hab.',
    campo: 'leitosSus', nenhum: 'nenhum leito SUS', sem: 'leito SUS', legenda: 'Leitos de internação do SUS por mil habitantes',
    unidade: (n) => (n === 1 ? 'leito SUS' : 'leitos SUS'),
  },
  uti: {
    faixas: [15, 25, 35, 50, 70], titulo: 'Leitos de UTI', curto: 'leitos de UTI', por: 'por 100 mil habitantes', porCurto: 'por 100 mil hab.',
    campo: 'uti', nenhum: 'nenhum leito de UTI', sem: 'UTI', legenda: 'Leitos de UTI por 100 mil habitantes',
    unidade: (n) => (n === 1 ? 'leito de UTI' : 'leitos de UTI'),
  },
  medicos: {
    faixas: [1, 1.5, 2.5, 3.5, 5], titulo: 'Médicos', curto: 'médicos', por: 'por mil habitantes', porCurto: 'por mil hab.',
    campo: 'medicos', nenhum: 'nenhum médico', sem: 'médico', legenda: 'Médicos por mil habitantes',
    unidade: (n) => (n === 1 ? 'médico' : 'médicos'),
  },
  tomografos: {
    faixas: [3, 4, 5, 7, 10], titulo: 'Tomógrafos', curto: 'tomógrafos', por: 'por 100 mil habitantes', porCurto: 'por 100 mil hab.',
    campo: 'tomografos', nenhum: 'nenhum tomógrafo', sem: 'tomógrafo', legenda: 'Tomógrafos em uso por 100 mil habitantes',
    unidade: (n) => (n === 1 ? 'tomógrafo' : 'tomógrafos'),
  },
}
const SEM_CAMPO = { leitos: 'semLeito', leitosSus: 'semLeito', uti: 'semUti', medicos: 'semMedico', tomografos: 'semTomografo' } as const

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
  /** ano a partir do qual a população vem do Censo 2022 (as estimativas anteriores estavam acima do que o Censo contou) */
  const QUEBRA = 2022

  const st = { t: ultimo, sel: { tipo: 'br' } as Sel, tocando: 0, camada: 'leitos' as Camada }
  const C = () => CAMADAS[st.camada]
  const ano = (t = st.t) => String(anos[t])
  const comp = (t = st.t) => meta.comps[t]
  const quando = (t = st.t) => f.mes(comp(t)) // "dez 2025"

  const valorMunC = (c: Camada, i: number, t = st.t): number | null => {
    const v = mapa[c][i][t]
    return v == null ? null : v / mapa.escala[c]
  }
  const valorMun = (i: number, t = st.t) => valorMunC(st.camada, i, t)
  const pop = (i: number, t = st.t) => mapa.pop[i][t] ?? 0
  const resumo = (s: Sel, t = st.t): Resumo | undefined =>
    s.tipo === 'br' ? brasil.anos[ano(t)] : s.tipo === 'uf' ? brasil.ufs[s.uf]?.[ano(t)] : undefined
  const valorRes = (r: Resumo | undefined, c = st.camada) => (r ? r[`${c}Taxa`] : null)
  const valorUf = (uf: string, t = st.t, c = st.camada) => valorRes(brasil.ufs[uf]?.[ano(t)], c)
  const valorSel = (s: Sel, t = st.t, c = st.camada) => (s.tipo === 'mun' ? valorMunC(c, s.i, t) : valorRes(resumo(s, t), c))

  // cores
  let rampa: string[] = []
  const lerRampa = () => {
    const cs = getComputedStyle(document.documentElement)
    rampa = [0, 1, 2, 3, 4, 5, 6].map((k) => cs.getPropertyValue(`--m${k}`).trim())
    rampa.push(cs.getPropertyValue('--m-sem').trim())
  }
  lerRampa()
  /** 0 = nenhum; 1 a 6 = faixas de quem tem alguma oferta, da menor para a maior */
  const classe = (v: number) => { if (v <= 0) return 0; const fx = C().faixas; let k = 0; while (k < fx.length && v >= fx[k]) k++; return k + 1 }
  const cor = (v: number | null) => (v == null ? rampa[7] : rampa[6 - classe(v)])
  const coresLegenda = () => [0, 1, 2, 3, 4, 5, 6].map((k) => rampa[6 - k])
  const tintaSobre = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16)
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
    return l > 0.55 ? '#171512' : '#fafaf9'
  }
  const fmtV = (v: number | null) => (v == null ? '–' : f.decimal(v))
  /** variação: aqui subir é bom */
  const variacao = (v: number, va: number) => `<span class="var ${v >= va ? 'bom' : 'ruim'}">${f.pct(v / va - 1)}</span>`

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
    pesoMun: (i) => mapa.pop[i][ultimo] ?? 0,
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

  /** quantidade absoluta registrada no município (ex.: 12 leitos), a partir da taxa e da população */
  const qtdMun = (i: number, c = st.camada, t = st.t) => {
    const v = valorMunC(c, i, t), p = mapa.pop[i][t]
    if (v == null || !p) return null
    return Math.round((v * p) / (c === 'uti' || c === 'tomografos' ? 100_000 : 1_000))
  }

  // estado sob o mouse: nome, valor e o convite para clicar
  function mostrarTipUf(uf: string | null, x: number, y: number) {
    if (uf == null) { tip.classList.remove('on'); return }
    const v = valorUf(uf)
    tip.innerHTML = `<div class="t">${UF_NOME[uf]}</div><div class="s">${ano()}</div><div class="v">${fmtV(v)}<small>${C().titulo}</small></div><div class="aviso">Clique para ver as cidades</div>`
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
    const q = qtdMun(i)
    tip.innerHTML = `<div class="t">${f.esc(mapa.nomes[i])}</div><div class="s">${UF_NOME[mapa.ufs[i]]} · ${quando()}</div>` +
      (v == null
        ? '<div class="aviso">Sem população do IBGE para este município neste ano.</div>'
        : v === 0
          ? `<div class="v">0<small>${C().nenhum} registrado no CNES</small></div><div class="r"><span>${f.compacto(pop(i))} habitantes</span><span></span></div>`
          : `<div class="v">${fmtV(v)}<small>${C().curto} ${C().por}</small></div>
           <div class="r"><span>${q != null ? `${f.int(q)} ${C().unidade(q)} · ${f.compacto(pop(i))} hab.` : ''}</span>${va != null && va > 0 ? `<span>${variacao(v, va)} vs ${anos[st.t - 1]}</span>` : ''}</div>`)
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
  // tons da esquerda para a direita: nenhum, pouco ... muito. Rótulos nos limites entre as faixas de quem tem oferta.
  function desenharLegenda() {
    const c = C()
    $('#legenda').innerHTML = `<div class="tit">${c.legenda}</div>
      <div class="esc">${coresLegenda().map((x) => `<span style="background:${x}"></span>`).join('')}</div>
      <div class="rot"><span></span><span></span>${c.faixas.map((v) => `<span>${f.decimal(v)}</span>`).join('')}</div>
      <div class="lados"><span>nenhum</span><span>mais oferta</span></div>`
  }

  // ---------- linha do tempo (um mês por ano) ----------
  const slider = $('#slider') as HTMLInputElement
  function prepararRegua() {
    slider.min = '0'
    slider.max = String(ultimo)
    slider.value = String(st.t)
    // um rótulo a cada 2 anos contando do mais recente; a troca da população (Censo 2022) vira só um traço discreto
    const pos = (j: number) => (j / ultimo) * 100
    const iq = anos.indexOf(QUEBRA)
    $('#anos').innerHTML = anos
      .map((a, j) => ((ultimo - j) % 2 ? '' : `<span style="left:${pos(j)}%">${pequeno() ? String(a).slice(2) : a}</span>`))
      .join('') + (iq > 0 ? `<i class="quebra" style="left:${(pos(iq - 1) + pos(iq)) / 2}%" title="A partir de ${QUEBRA} a população vem do Censo 2022, e as taxas mudam um pouco"></i>` : '')
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
    $('#tempo-rotulo').innerHTML = `${anos[t]}<small>${f.mesCurto(comp(t))}</small>`
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
  /** posição do município no estado: 1º = mais oferta por habitante; empatados dividem a posição */
  function posicaoNaUf(i: number) {
    const v = valorMun(i)
    if (v == null) return null
    let acima = 0, total = 0
    for (let j = 0; j < N; j++) if (mapa.ufs[j] === mapa.ufs[i]) { const x = valorMun(j); if (x != null) { total++; if (x > v) acima++ } }
    return { pos: acima + 1, total }
  }

  // ---------- hero ----------
  function renderHero() {
    const s = st.sel
    const t = st.t
    const v = valorSel(s)
    const va = t > 0 ? valorSel(s, t - 1) : null
    const c = C()
    const kpi = (x: string, l: string) => `<div class="kpi"><div class="v">${x}</div><div class="l">${l}</div></div>`
    const num = v == null ? '–' : fmtV(v)
    const frase = v == null
      ? `<b>${c.titulo}: sem dado ${nomeSel(s)}</b><span>${quando()}</span>`
      : `<b>${c.curto} ${c.por} ${nomeSel(s)}</b><span>${f.mesLongo(comp())} · CNES</span>`
    let kpis = ''
    if (v != null && va != null && va > 0) kpis += kpi(variacao(v, va), `vs ${anos[t - 1]}${anos[t] === QUEBRA ? ' (população do Censo)' : ''}`)
    if (s.tipo === 'mun') {
      const q = qtdMun(s.i)
      if (q != null) kpis += kpi(f.int(q), `${c.unidade(q)} registrados`)
      const p = posicaoNaUf(s.i)
      if (p && v) kpis += kpi(`${p.pos}º`, `de ${p.total} em ${UF_NOME[mapa.ufs[s.i]]} (1º = mais)`)
    } else {
      const r = resumo(s)
      if (r) {
        kpis += kpi(f.compacto(r[c.campo]), `${c.unidade(r[c.campo])}`)
        kpis += kpi(f.int(r[SEM_CAMPO[st.camada]]), `de ${f.int(r.municipios)} municípios sem ${c.sem}`)
      }
    }
    $('#hero').innerHTML = `<div class="num troca">${num}<small></small></div><div class="frase troca">${frase}</div>${kpis ? `<div class="kpis">${kpis}</div>` : ''}`
  }

  // ---------- painel esquerdo ----------
  function renderEsq() {
    const t = st.t
    // estados do que tem menos para o que tem mais
    const ufs = Object.keys(brasil.ufs).map((uf) => ({ uf, v: valorUf(uf) })).filter((d) => d.v != null).sort((a, b) => a.v! - b.v!) as { uf: string; v: number }[]
    const maxUf = Math.max(...ufs.map((d) => d.v), 0.0001)
    const selUf = st.sel.tipo === 'uf' ? st.sel.uf : st.sel.tipo === 'mun' ? mapa.ufs[st.sel.i] : null
    // cidades grandes com menos oferta
    const grandes: { i: number; v: number }[] = []
    for (let i = 0; i < N; i++) { const v = valorMun(i); if (v != null && pop(i) >= GRANDE) grandes.push({ i, v }) }
    grandes.sort((a, b) => a.v - b.v || pop(b.i) - pop(a.i))
    const top = grandes.slice(0, 10)
    const maxG = Math.max(...top.map((d) => d.v), 0.0001)
    $('#painel-esq').innerHTML = `
      <div class="bloco"><h2>Brasil, ano a ano</h2><p class="sub">${C().titulo} ${C().porCurto}</p><div id="g-br"></div></div>
      <div class="bloco"><h3>Estados</h3><p class="sub">Do que tem menos para o que tem mais, ${quando()}</p>
        ${ufs.length ? `<ul class="rank" id="rank-uf">${ufs.map((d) => `<li data-uf="${d.uf}" class="${d.uf === selUf ? 'on' : ''}"><span class="tag">${d.uf}</span><span class="barra"><i style="width:${(d.v / maxUf) * 100}%"></i></span><span class="val">${fmtV(d.v)}</span></li>`).join('')}</ul>` : `<p class="nota">Sem dado em ${ano()}.</p>`}</div>
      <div class="bloco"><h3>Cidades grandes com menos ${C().curto}</h3><p class="sub">Mais de 100 mil habitantes, ${C().porCurto}, ${quando()}</p>
        <ul class="rank dist" id="rank-mun">${top.map((d) => `<li data-i="${d.i}" title="${f.esc(mapa.nomes[d.i])} (${mapa.ufs[d.i]})"><span class="nome">${f.esc(mapa.nomes[d.i])} <span class="uf-mini">${mapa.ufs[d.i]}</span></span><span class="val">${fmtV(d.v)}</span><span class="barra"><i style="width:${(d.v / maxG) * 100}%"></i></span></li>`).join('') || '<li><span class="nome">Sem dado</span></li>'}</ul></div>`
    const serie = anos.map((_, j) => valorRes(brasil.anos[String(anos[j])]) ?? 0)
    barras($('#g-br'), {
      valores: serie, rotulos: meta.comps.map((m) => f.mes(m)), marcas: anos.map((a, j) => ({ i: j, t: String(a).slice(2) })).filter((_, j) => j % 2 === 0),
      ativo: t, altura: 72, fmt: (v) => fmtV(v), onClick: (j) => { parar(); mudarT(j) },
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
      <p><b>De onde vem.</b> Todo hospital, clínica, posto e consultório, público ou privado, precisa manter um cadastro no CNES, do Ministério da Saúde, com seus leitos, equipamentos e profissionais. É esse cadastro que aparece aqui, município por município.</p>
      <p><b>Registrado não é disponível.</b> Um leito no cadastro pode estar ocupado, desativado ou reservado a convênio. E quem mora em cidade pequena costuma ser atendido no polo da região: zero aqui quer dizer que o serviço fica em outra cidade.</p>
      <p><b>Precisa de ajuda?</b> Em emergência, ligue 192 (SAMU). Para reclamar do atendimento do SUS, ligue 136 (Disque Saúde).</p>
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
    const grafico = (idEl: string, cam: Camada) => {
      const sr = serieDe(cam)
      return sr.some((x) => x != null) ? `<div class="bloco"><h3>${CAMADAS[cam].titulo} ${CAMADAS[cam].porCurto}</h3><div id="${idEl}"></div></div>` : ''
    }
    if (s.tipo === 'br' || s.tipo === 'uf') {
      const r = resumo(s)
      const v = valorSel(s)
      const nomeT = s.tipo === 'br' ? 'Brasil' : UF_NOME[s.uf]
      const zerados: number[] = []
      const comAlgum: { i: number; v: number }[] = []
      let popZero = 0, popTot = 0
      for (let i = 0; i < N; i++) {
        if (s.tipo === 'uf' && mapa.ufs[i] !== s.uf) continue
        const x = valorMun(i)
        if (x == null) continue
        popTot += pop(i)
        if (x === 0) { zerados.push(i); popZero += pop(i) } else if (pop(i) >= 50_000) comAlgum.push({ i, v: x })
      }
      zerados.sort((a, b) => pop(b) - pop(a))
      comAlgum.sort((a, b) => a.v - b.v)
      const ordemAlfa = Object.keys(UF_NOME).sort((a, b) => UF_NOME[a].localeCompare(UF_NOME[b]))
      html = `<div class="titulo-sel"><div><h2>${nomeT}</h2><div class="trilha-sel">${r ? `${f.int(r.municipios)} municípios · ${f.compacto(r.pop)} habitantes · ${quando()}` : `sem dado em ${ano()}`}</div></div>
          ${s.tipo === 'uf' ? `<div class="nav"><button data-uf="${ordemAlfa[(ordemAlfa.indexOf(s.uf) + 26) % 27]}" aria-label="Estado anterior">‹</button><button data-uf="${ordemAlfa[(ordemAlfa.indexOf(s.uf) + 1) % 27]}" aria-label="Próximo estado">›</button></div>` : ''}</div>
        <div class="big">${v == null ? '–' : fmtV(v)}<small>${c.curto} ${c.por}, ${quando()}</small></div>
        ${r ? `<p class="nota">${f.int(r[c.campo])} ${c.unidade(r[c.campo])} registrados no CNES${st.camada === 'medicos' ? ' (cada pessoa contada uma vez)' : ''}.</p>` : ''}
        ${grafico('g-1', st.camada)}
        ${zerados.length ? `<div class="bloco"><h3>Sem ${c.sem}: ${f.int(zerados.length)} municípios</h3><p class="sub">${f.compacto(popZero)} habitantes (${f.decimal((popZero / (popTot || 1)) * 100)}%) moram onde o CNES não registra ${c.nenhum}. Os maiores:</p>${listaMuns(zerados.slice(0, 8).map((i) => ({ i, v: 0 })), true)}</div>` : ''}
        ${comAlgum.length ? `<div class="bloco"><h3>Menor oferta entre as cidades maiores</h3><p class="sub">Mais de 50 mil habitantes, ${c.porCurto}</p>${listaMuns(comAlgum.slice(0, 8), false)}</div>` : ''}
        <div class="bloco">${EXPLICA}</div>`
      el.innerHTML = html
    } else {
      const i = s.i
      el.innerHTML = `<div class="titulo-sel"><div><h2>${f.esc(mapa.nomes[i])}</h2><div class="trilha-sel">${UF_NOME[mapa.ufs[i]]} · carregando…</div></div></div>`
      const fc = await ficha(mapa.cods[i])
      if (id !== renderId) return
      const v = valorMun(i)
      const vUf = valorUf(fc.uf), vBr = valorRes(brasil.anos[ano()])
      const L = fc.anos[ano()]
      const linha = (rot: string, val: string | null) => (val == null ? '' : `<li><span class="q">${rot}</span><span class="h">${val}</span></li>`)
      const n = (x: number | null | undefined) => (x == null ? null : f.int(x))
      const comparacao = v == null
        ? 'Sem população do IBGE para este ano.'
        : v === 0
          ? `O CNES não registra ${c.nenhum} aqui em ${quando()}. Quem mora em ${f.esc(fc.nome)} é atendido em outra cidade, em geral o polo da região de saúde.`
          : `${UF_NOME[fc.uf]}: ${fmtV(vUf)} · Brasil: ${fmtV(vBr)} ${c.porCurto}`
      html = `<figure class="foto"></figure><div class="titulo-sel"><div><h2>${f.esc(fc.nome)}</h2><div class="trilha-sel">${UF_NOME[fc.uf]}${L?.pop ? ` · ${f.int(L.pop)} habitantes` : ''}</div></div></div>
        <div class="big">${v == null ? '–' : fmtV(v)}<small>${c.curto} ${c.por}, ${quando()}</small></div>
        <p class="nota">${comparacao}</p>
        ${CAMADAS_LISTA.map((cam, k) => grafico(`g-${k + 1}`, cam)).join('')}
        ${L ? `<div class="bloco"><h3>O que o CNES registra em ${quando()}</h3>
          <ul class="eventos">
            ${linha('Estabelecimentos com leito de internação', n(L.hospitais))}
            ${linha('Leitos de internação', n(L.leitos))}
            ${linha('dos quais SUS', n(L.leitosSus))}
            ${linha('Leitos de UTI', n(L.uti))}
            ${linha('dos quais SUS', n(L.utiSus))}
            ${linha('Médicos (pessoas)', n(L.medicos))}
            ${linha('que atendem SUS', n(L.medicosSus))}
            ${linha('Vínculos de médicos', n(L.vinculos))}
            ${linha('Tomógrafos em uso', n(L.tomografos))}
            ${linha('Ressonâncias em uso', n(L.ressonancias))}
            ${linha('Mamógrafos em uso', n(L.mamografos))}
            ${linha('População (IBGE)', n(L.pop))}
          </ul></div>` : ''}
        <div class="bloco">${EXPLICA}</div>`
      el.innerHTML = html
      preencherFoto(el.querySelector('figure.foto'), fc.cod, fc.nome)
    }
    if (anima) { el.scrollTop = 0; el.classList.remove('troca'); void el.offsetWidth; el.classList.add('troca') }
    const marcas = anos.map((a, j) => ({ i: j, t: String(a).slice(2) })).filter((_, j) => j % 2 === 0)
    const graficos: [string, Camada][] = s.tipo === 'mun' ? CAMADAS_LISTA.map((cam, k) => [`g-${k + 1}`, cam]) : [['g-1', st.camada]]
    graficos.forEach(([idEl, cam]) => {
      const g = el.querySelector<HTMLElement>('#' + idEl)
      if (!g) return
      barras(g, {
        valores: serieDe(cam).map((x) => x ?? 0), rotulos: meta.comps.map((m) => f.mes(m)), marcas, ativo: t, altura: s.tipo === 'mun' ? 64 : 90,
        fmt: (x) => fmtV(x), onClick: (j) => { parar(); mudarT(j) },
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
  function listaMuns(xs: { i: number; v: number }[], comPop: boolean) {
    return `<ul class="eventos">${xs.map((d) => `<li class="clicavel" data-i="${d.i}"><span class="q">${f.esc(mapa.nomes[d.i])} <span class="uf-mini">${mapa.ufs[d.i]}</span></span><span class="h">${comPop ? `${f.compacto(pop(d.i))} hab.` : fmtV(d.v)}</span></li>`).join('')}</ul>`
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
  const peso = (i: number) => mapa.pop[i][ultimo] ?? 0
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
      ? resultados.map((i, k) => { const v = valorMun(i); return `<li role="option" data-i="${i}" class="${k === cursor ? 'on' : ''}"><span class="uf">${mapa.ufs[i]}</span><span><span class="n">${f.esc(mapa.nomes[i])}</span><br><span class="s">${peso(i) ? f.compacto(peso(i)) + ' habitantes' : 'sem população'}</span></span><span class="h">${fmtV(v)}</span></li>` }).join('')
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
  const brU = brasil.anos[ano(ultimo)]
  $('#metodo-corpo').innerHTML = `<h2>Como medimos</h2>
    <p>Os números vêm do <a href="https://cnes.datasus.gov.br/" target="_blank" rel="noopener">Cadastro Nacional de Estabelecimentos de Saúde (CNES)</a>, do Ministério da Saúde, baixado dos arquivos públicos do <a href="https://datasus.saude.gov.br/transferencia-de-arquivos/" target="_blank" rel="noopener">DATASUS</a> (leitos, equipamentos e profissionais, por estado e mês). A população é do <a href="https://sidra.ibge.gov.br/" target="_blank" rel="noopener">IBGE</a>. Processados em ${f.data(meta.gerado)}.</p>
    <h3>Um retrato por ano</h3>
    <p>O CNES é atualizado todo mês. Usamos a competência de dezembro de cada ano, de ${anos[0]} a ${anos[ultimo - 1]}, e a mais recente publicada (${f.mesLongo(meta.comps[ultimo])}). Dezembro fecha o ano e evita misturar meses diferentes na comparação.</p>
    <h3>Leitos por mil habitantes</h3>
    <p>Soma dos leitos de internação existentes (cirúrgicos, clínicos, obstétricos, pediátricos, outras especialidades e hospital-dia) dos estabelecimentos do município, dividida pela população e multiplicada por mil. Leitos complementares (UTI, unidade intermediária, isolamento) ficam fora desse total, como no TabNet do DATASUS. <b>Leitos SUS</b> são os que o estabelecimento declara disponíveis para o SUS.</p>
    <h3>Leitos de UTI por 100 mil habitantes</h3>
    <p>Leitos de UTI adulto, pediátrica, neonatal, de queimados e coronariana, de todos os tipos, inclusive os de UTI para covid abertos em 2020 e 2021.</p>
    <h3>Médicos por mil habitantes</h3>
    <p>Profissionais com ocupação de médico (CBO 225 e os códigos antigos 2231). Contamos <b>pessoas</b>, não vínculos: quem trabalha em três hospitais da mesma cidade conta uma vez. O CPF vem embaralhado no arquivo público, mas sempre do mesmo jeito, o que permite contar pessoas sem saber quem são. Quem atende em duas cidades conta nas duas; no total do estado e do Brasil, conta uma vez só. Em ${anos[ultimo]} são ${brU ? f.int(brU.medicos) : '–'} médicos no Brasil para ${brU ? f.int(brU.vinculos) : '–'} vínculos.</p>
    <h3>Tomógrafos por 100 mil habitantes</h3>
    <p>Tomógrafos computadorizados declarados em uso (sem o simulador de radioterapia). A ficha da cidade também mostra ressonâncias e mamógrafos em uso.</p>
    <h3>Cores do mapa</h3>
    <p>Aqui mais é melhor. Por isso o tom mais forte marca <b>nenhum</b> (zero registrado) e os tons clareiam conforme a oferta por habitante cresce. Os rankings vão do que tem menos para o que tem mais.</p>
    <h3>População</h3>
    <p>Censo 2010, estimativas anuais do IBGE de 2011 a 2021 e de 2024 em diante, Censo 2022. Para 2023, sem estimativa oficial, usamos a média entre o Censo 2022 e a estimativa de 2024. As estimativas anteriores ao Censo 2022 ficaram acima do que o Censo contou; por isso as taxas sobem um pouco em 2022 sem que a oferta tenha mudado.</p>
    <h3>Cuidados</h3>
    <p><b>Registrado não é disponível:</b> o CNES mostra o que cada estabelecimento declarou, sem conferir se o leito está ocupado, desativado ou se o médico cumpre a carga horária. <b>Cidade pequena depende do polo:</b> mais de metade dos municípios não tem leito de internação, e quem mora lá é atendido na cidade-polo da região; a taxa da cidade-polo fica alta porque atende gente de fora. <b>Privado conta junto:</b> os totais incluem planos de saúde e particulares; use "Leitos SUS" para ver só a rede pública e conveniada. Médicos residentes e em formação também contam.</p>`
  $('#btn-metodo').addEventListener('click', () => (metodo.hidden = false))
  $('#metodo-fechar').addEventListener('click', () => (metodo.hidden = true))
  metodo.addEventListener('click', (e) => { if (e.target === metodo) metodo.hidden = true })

  // ---------- compartilhar ----------
  async function compartilhar() {
    const s = st.sel
    const c = C()
    const hero = $('#hero')
    const numero = hero.querySelector('.num')?.firstChild?.textContent?.trim() ?? ''
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
      else { lugar = mapa.nomes[s.i]; sublugar = UF_NOME[uf]; destaque = muns[s.i] }
    }
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
      marca: 'minhainfra · saúde', icone: 'cruz', lugar, sublugar, numero, unidade: '', frase, periodo, destaques,
      // card: primeiro tom = nenhum; rótulos nos limites entre as faixas seguintes
      legenda: { titulo: `${c.legenda} (o primeiro tom é zero)`, cores: coresLegenda(), rotulos: ['', ...c.faixas.map((v) => f.decimal(v))] },
      mapa: { feats: idx.map((i) => muns[i]), cores: idx.map((i) => cor(valorMun(i))), destaque, contornos, zoom: s.tipo === 'mun' },
      url: location.host.includes('localhost') ? 'minhainfra.com/saude' : `${location.host}${location.pathname}`.replace(/\/$/, ''),
      fonte: 'Fonte: DATASUS (CNES)',
    }
    // duas versões quando há foto: com a foto da cidade ou com o mapa
    const versoes = foto
      ? [{ rotulo: 'Com foto', cv: await desenharCard({ ...opts, foto }) }, { rotulo: 'Com mapa', cv: await desenharCard({ ...opts, foto: null }) }]
      : [{ rotulo: 'Com mapa', cv: await desenharCard({ ...opts, foto: null }) }]
    const slug = f.semAcento(lugar).replace(/[^a-z0-9]+/g, '-')
    abrirCompartilhar(versoes, `minhainfra-saude-${slug}.png`, location.href, `${numero} ${frase}, ${periodo}.`)
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
    if (st.camada !== 'leitos') p.set('c', st.camada)
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
  $('#atualizado').textContent = `Dados de ${anos[0]} a ${f.mes(meta.comps[ultimo])} · CNES e IBGE`
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
