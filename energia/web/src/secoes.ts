/** Abas entre as seções do minhainfra no topo. Ao trocar de seção, leva junto a cidade ou o estado aberto. */
const SECOES = [
  { id: 'energia', nome: 'Energia', cor: '#e8a317', icone: 'M13 2 4 14h7l-1 8 9-12h-7z' },
  { id: 'agua', nome: 'Água', cor: '#2f8fc4', icone: 'M12 2.5S5 10.2 5 14.5a7 7 0 0 0 14 0C19 10.2 12 2.5 12 2.5z' },
  {
    id: 'esgoto', nome: 'Esgoto', cor: '#8a6a2f',
    icone: 'M12 2.5c1 1.1 1.5 2.3 1.2 3.4 1.5.3 2.6 1.3 2.6 2.7l-.1.5c1.6.3 2.8 1.5 2.8 3l-.1.6c1.6.4 2.6 1.6 2.6 3.1 0 2-1.8 3.7-4 3.7H7c-2.2 0-4-1.7-4-3.7 0-1.5 1-2.7 2.6-3.1l-.1-.6c0-1.5 1.2-2.7 2.8-3l-.1-.5c0-1.6 1.5-2.8 3.3-2.8.7-.9.9-2 .5-3.3zM9.6 12.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm4.8 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM9.3 16.1c.7.8 1.6 1.2 2.7 1.2s2-.4 2.7-1.2z',
  },
  { id: 'saude', nome: 'Saúde', cor: '#2e9a5e', icone: 'M10 3h4a1 1 0 0 1 1 1v5h5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-5v5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h5V4a1 1 0 0 1 1-1z' },
]

export function montarSecoes(atual: string) {
  const nav = document.getElementById('secoes')
  if (!nav) return
  nav.innerHTML = SECOES.map((s) => `<a href="../${s.id}/" data-s="${s.id}" class="${s.id === atual ? 'on' : ''}" ${s.id === atual ? 'aria-current="page"' : ''} title="${s.nome}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${s.icone}" fill="${s.cor}" fill-rule="evenodd" /></svg><span>${s.nome}</span></a>`).join('')
  // leva a cidade (m) ou o estado (uf) para a outra seção; ano, mês e camada são de cada seção e ficam para trás
  nav.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-s]')
    if (!a || a.dataset.s === atual) { if (a) e.preventDefault(); return }
    const p = new URLSearchParams(location.hash.slice(1))
    const q = new URLSearchParams()
    if (p.get('m')) q.set('m', p.get('m')!)
    else if (p.get('uf')) q.set('uf', p.get('uf')!)
    a.href = `../${a.dataset.s}/${q.toString() ? '#' + q : ''}`
  })
}
