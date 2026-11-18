import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Build: caminhos relativos (funciona em minhainfra.com/energia/ e em <usuario>.github.io/<repo>/energia/).
// Dev: imita o site publicado num só endereço: / = página inicial, /energia/ = este app, /agua/, /saude/ e /esgoto/ = servidores das outras seções (portas 5288, 5289 e 5290).
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/energia/' : './',
  server: {
    proxy: {
      '/agua': { target: 'http://localhost:5288', ws: true },
      '/saude': { target: 'http://localhost:5289', ws: true },
      '/esgoto': { target: 'http://localhost:5290', ws: true },
    },
  },
  plugins: [{
    name: 'pagina-inicial',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(readFileSync(resolve(__dirname, '../../site/index.html')))
          return
        }
        next()
      })
    },
  }],
}))
