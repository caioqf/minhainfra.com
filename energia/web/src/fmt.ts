const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const horas = (h: number) => {
  if (!isFinite(h)) return '–'
  if (h < 1) return `${nf0.format(Math.round(h * 60))} min`
  return h >= 100 ? `${nf0.format(h)} h` : `${nf1.format(h)} h`
}
export const horasNum = (h: number) => (h >= 100 ? nf0.format(h) : nf1.format(h))
export const int = (n: number) => nf0.format(n)
export const compacto = (n: number) => {
  if (n >= 1e9) return `${nf1.format(n / 1e9)} bi`
  if (n >= 1e6) return `${nf1.format(n / 1e6)} mi`
  if (n >= 1e4) return `${nf0.format(n / 1e3)} mil`
  return nf0.format(n)
}
export const mes = (m: string) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`
export const mesLongo = (m: string) => `${MESES_LONGO[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`
export const mesCurto = (m: string) => MESES[+m.slice(5, 7) - 1]
export const data = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00` : iso.replace(' ', 'T'))
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')
}
export const dataHora = (iso: string) => {
  const d = new Date(iso.replace(' ', 'T'))
  return `${data(iso)}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}
export const pct = (x: number) => `${x > 0 ? '+' : ''}${nf0.format(x * 100)}%`
export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
export const reais = (n: number) => {
  if (n >= 1e9) return `R$ ${nf1.format(n / 1e9)} bi`
  if (n >= 1e6) return `R$ ${nf1.format(n / 1e6)} mi`
  if (n >= 1e4) return `R$ ${nf0.format(n / 1e3)} mil`
  return `R$ ${nf0.format(n)}`
}
export const reaisCent = (n: number) => `R$ ${nf2.format(n)}`
