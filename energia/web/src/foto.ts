import { carregar } from './dados'

/** Foto principal do município no Wikimedia Commons (só o nome do arquivo fica no site; imagem e crédito vêm da Wikimedia). */
let mapa: Promise<Record<string, string>> | null = null
const fotos = () => (mapa ??= carregar<Record<string, string>>('data/fotos.json').catch((): Record<string, string> => ({})))

// arq = "a/ab/Nome_do_arquivo.jpg" (caminho no upload.wikimedia.org, que libera CORS para o canvas)
const nomeArq = (arq: string) => arq.split('/').slice(2).join('/')
/** miniatura na largura pedida (960 ou 1280, tamanhos padrão da Wikimedia) */
export const urlFoto = (arq: string, largura: number) => {
  const [a, ab] = arq.split('/'), n = encodeURIComponent(nomeArq(arq))
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${n}/${largura}px-${n}`
}
/** arquivo original (para fotos menores que a miniatura pedida) */
export const urlOriginal = (arq: string) => `https://upload.wikimedia.org/wikipedia/commons/${arq.split('/').slice(0, 2).join('/')}/${encodeURIComponent(nomeArq(arq))}`
export const paginaFoto = (arq: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(nomeArq(arq))}`

export async function arquivoFoto(cod: number): Promise<string | null> {
  return (await fotos())[String(cod)] ?? null
}

export interface Credito { autor: string; licenca: string; pagina: string }
const cacheCredito = new Map<string, Promise<Credito>>()
export function creditoFoto(arq: string): Promise<Credito> {
  if (!cacheCredito.has(arq)) {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent('File:' + nomeArq(arq))}`
    cacheCredito.set(arq, fetch(u).then((r) => r.json()).then((j) => {
      const pg = Object.values(j?.query?.pages ?? {})[0] as { imageinfo?: { extmetadata?: Record<string, { value: string }> }[] } | undefined
      const md = pg?.imageinfo?.[0]?.extmetadata ?? {}
      const limpa = (h?: string) => (h ? new DOMParser().parseFromString(h, 'text/html').body.textContent?.trim().replace(/\s+/g, ' ') ?? '' : '')
      return { autor: limpa(md.Artist?.value) || 'autor desconhecido', licenca: limpa(md.LicenseShortName?.value) || 'licença livre', pagina: paginaFoto(arq) }
    }).catch(() => ({ autor: 'Wikimedia Commons', licenca: '', pagina: paginaFoto(arq) })))
  }
  return cacheCredito.get(arq)!
}

/** imagem com CORS liberado (pode ser desenhada no canvas do card); null se não carregar em alguns segundos */
export function carregarImagem(url: string, ms = 6000): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const t = setTimeout(() => ok(null), ms)
    img.onload = () => { clearTimeout(t); ok(img) }
    img.onerror = () => { clearTimeout(t); ok(null) }
    img.src = url
  })
}

/** preenche <figure class="foto" data-cod> no painel do município; some se não houver foto */
export async function preencherFoto(fig: HTMLElement | null, cod: number, nome: string) {
  if (!fig) return
  const arq = await arquivoFoto(cod)
  if (!arq) { fig.remove(); return }
  fig.innerHTML = `<img src="${urlFoto(arq, 960)}" alt="Foto de ${nome.replace(/"/g, '')}" loading="lazy" referrerpolicy="no-referrer" /><figcaption></figcaption>`
  const img = fig.querySelector('img')!
  // foto menor que a miniatura: tenta o original; se também falhar, some
  img.addEventListener('error', () => { if (img.src !== urlOriginal(arq)) img.src = urlOriginal(arq); else fig.remove() })
  const c = await creditoFoto(arq)
  const cap = fig.querySelector('figcaption')
  if (cap) {
    cap.textContent = ''
    const a = document.createElement('a')
    a.href = c.pagina
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = `Foto: ${c.autor}${c.licenca ? ` · ${c.licenca}` : ''} · Wikimedia Commons`
    cap.appendChild(a)
  }
}
