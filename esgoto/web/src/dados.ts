export interface Meta { anos: number[]; gerado: string; quebra: number; fonte: string }

export interface MapaDados {
  anos: number[]
  cods: number[]
  nomes: string[]
  ufs: string[]
  /** domicílios no Censo 2022 (peso) */
  dom: number[]
  /** % x 10 por município x ano; censo repete o valor de 2022 em todos os anos */
  camadas: Record<'semrede' | 'semtrat' | 'censo', (number | null)[][]>
}

export interface Resumo {
  semrede: number | null; semtrat: number | null; censo: number | null
  semredeMunicipios: number; semtratMunicipios: number; censoMunicipios: number
  semredeSemDado: number | null; semtratSemDado: number | null
}
export interface Brasil {
  anos: Record<string, Resumo>
  ufs: Record<string, Record<string, Resumo>>
}

export interface LinhaAno {
  atend: number | null; tratado: number | null; trat_coletado: number | null; coleta: number | null
  pop_atend: number | null; extrav: number | null; extrav_km: number | null; prest: string
}
export interface Censo {
  total?: number; rede?: number; fossa_rede?: number; fossa_septica?: number; fossa_rudimentar?: number
  vala?: number; rio?: number; outra?: number; sem_banheiro?: number
}
export interface Ficha { cod: number; nome: string; uf: string; anos: Record<string, LinhaAno>; censo: Censo }

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
