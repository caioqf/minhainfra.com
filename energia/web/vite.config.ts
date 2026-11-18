import { defineConfig } from 'vite'

// caminhos relativos: o mesmo build funciona em minhainfra.com/energia/ e em <usuario>.github.io/<repo>/energia/
export default defineConfig({ base: './' })
