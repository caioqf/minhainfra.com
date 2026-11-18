import { defineConfig } from 'vite'

// Build: caminhos relativos. Dev: servido em /esgoto/ (o servidor da energia, porta 5287, repassa /esgoto para cá).
export default defineConfig(({ command }) => ({ base: command === 'serve' ? '/esgoto/' : './' }))
