export interface Meta {
  meses: string[]
  anos: string[]
  gerado: string
  corteMunicipio: string
  coberturaAntigo: number | null
  fonte: string
  excluidos: string[]
  maxHoras: number
  consumidores: number
  fatorConsumidorDomicilio: number
}

export interface MapaDados {
  meses: string[]
  cods: number[]
  nomes: string[]
  ufs: string[]
  dom: number[]
  horas10: number[][]
  quedas: number[][]
}

export interface Causa { causa: string; detalhe: string; chi: number; n: number }
export interface Distribuidora { sig: string; nome: string; chi: number; n: number; consumidores: number | null; dec: number | null }
export interface Evento { ini: string; h: number; af: number; chi: number; cod: number | null; conj: string; causa: string | null; detalhe: string | null; sig: string }
export interface Ano {
  h: number; chi: number; n: number; af: number; meses: number
  causas: Causa[]; tipos: { tipo: string; chi: number }[]
  distribuidoras: Distribuidora[]; ufs: { uf: string; chi: number; h: number }[]; maiores: Evento[]
}
export interface Brasil {
  serie: { m: string; h: number; n: number; af: number }[]
  ufMes: Record<string, number[]>
  anos: Record<string, Ano>
  domTotal: number
}
export interface Ficha {
  cod: number; nome: string; uf: string; dom: number
  anos: Record<string, { chi: number; n: number }>
  causas: Causa[]
  piores: { ini: string; h: number; af: number; causa: string | null; detalhe: string | null; local: string | null; sig: string }[]
  dist: { sig: string; nome: string }[]
}

/** DEC apurado x limite da ANEEL e compensações pagas (limite.json) */
export interface Limite {
  fonte: string
  inicioComp: number
  anoConj: number
  /** DEC em 12 meses ÷ limite, em %, por município x mês (null = sem dado) */
  razao: (number | null)[][]
  ufRazao: Record<string, (number | null)[]>
  brRazao: (number | null)[]
  brConsAcima: (number | null)[]
  brAno: Record<string, { meses: number; dec: number; lim: number; consAcima: number; conjs: number; conjsAcima: number; reais: number | null; qtd: number | null }>
  distAno: Record<string, { sig: string; n: number; dec: number; lim: number; consAcima: number; reais: number | null; qtd: number | null }[]>
  /** uf -> ano -> [dec, limite, R$, qtd] */
  ufAno: Record<string, Record<string, [number, number, number | null, number | null]>>
  /** por município: [ano, dec, limite, R$, qtd] */
  munAno: [number, number, number, number | null, number | null][][]
  /** por município: [nome da área, distribuidora, fração dos consumidores, dec, limite] no ano anoConj */
  munConj: [string, string, number, number, number | null][][]
}

const base = import.meta.env.BASE_URL
export const carregar = <T,>(p: string): Promise<T> =>
  fetch(base + p).then((r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`)
    return r.json() as Promise<T>
  })

const cacheFicha = new Map<number, Promise<Ficha>>()
export const ficha = (cod: number) => {
  if (!cacheFicha.has(cod)) cacheFicha.set(cod, carregar<Ficha>(`data/mun/${cod}.json`))
  return cacheFicha.get(cod)!
}

export const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
}
export const UF_COD: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN',
  '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC',
  '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}
