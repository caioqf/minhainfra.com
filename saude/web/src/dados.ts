export type Camada = 'leitos' | 'leitosSus' | 'uti' | 'medicos' | 'tomografos'
export const CAMADAS_LISTA: Camada[] = ['leitos', 'leitosSus', 'uti', 'medicos', 'tomografos']

export interface Meta {
  anos: number[]
  /** competência do CNES usada em cada ano ("2025-12") */
  comps: string[]
  gerado: string
  fonte: string
  populacao: Record<string, string>
}

export interface MapaDados {
  anos: number[]
  comps: string[]
  cods: number[]
  nomes: string[]
  ufs: string[]
  /** população por município e ano (null = sem população) */
  pop: (number | null)[][]
  /** valor guardado = taxa x escala (ex.: leitos por mil x 100) */
  escala: Record<Camada, number>
  leitos: (number | null)[][]
  leitosSus: (number | null)[][]
  uti: (number | null)[][]
  medicos: (number | null)[][]
  tomografos: (number | null)[][]
}

/** totais de um ano no Brasil ou num estado */
export interface Resumo {
  pop: number
  municipios: number
  leitos: number; leitosSus: number; uti: number; utiSus: number; hospitais: number
  medicos: number; medicosSus: number; vinculos: number
  tomografos: number; ressonancias: number; mamografos: number
  semLeito: number; semUti: number; semMedico: number; semTomografo: number
  leitosTaxa: number | null; leitosSusTaxa: number | null; utiTaxa: number | null; medicosTaxa: number | null; tomografosTaxa: number | null
}
export interface Brasil {
  anos: Record<string, Resumo>
  ufs: Record<string, Record<string, Resumo>>
}

export interface LinhaAno {
  pop: number | null
  leitos: number; leitosSus: number; uti: number; utiSus: number; hospitais: number
  medicos: number; medicosSus: number; vinculos: number
  tomografos: number; ressonancias: number; mamografos: number
}
export interface Ficha { cod: number; nome: string; uf: string; anos: Record<string, LinhaAno> }

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
