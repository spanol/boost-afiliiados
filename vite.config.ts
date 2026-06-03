import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // SECURITY (MEDIUM-3): NÃO inlinar GEMINI_API_KEY (nem qualquer segredo) no
    // bundle via `define` — o Vite substituiria `process.env.GEMINI_API_KEY` pelo
    // valor real, vazando a chave a todos os navegadores assim que houvesse uma
    // referência. Qualquer chamada ao Gemini deve viver no backend (server.ts),
    // lendo process.env em runtime e exposta via endpoint autenticado.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        // Reference PDFs (design assets) can be locked open in a viewer; a locked
        // file makes the FS watcher throw EBUSY and crash the dev server. They are
        // never imported, so exclude them from watching entirely.
        ignored: ['**/*.pdf'],
      },
    },
  };
});
