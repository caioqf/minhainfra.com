import { defineConfig } from 'vite'

// Build: caminhos relativos. Dev: servido em /saude/.
export default defineConfig(({ command }) => ({ base: command === 'serve' ? '/saude/' : './' }))
