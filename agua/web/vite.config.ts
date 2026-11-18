import { defineConfig } from 'vite'

// Build: caminhos relativos. Dev: servido em /agua/ (o servidor da energia, porta 5287, repassa /agua para cá).
export default defineConfig(({ command }) => ({ base: command === 'serve' ? '/agua/' : './' }))
