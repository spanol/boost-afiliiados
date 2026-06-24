/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// Config dedicada aos testes de firestore.rules contra o emulator do Firestore.
// Roda em ambiente node (não jsdom) e é SEPARADA do `npm test` — só é executada
// por `npm run test:rules`, que sobe o emulator via `firebase emulators:exec`.
// O include aponta para test/rules/** (fora do glob src/** do vitest.config.ts),
// então `npm test` NUNCA tenta rodar estes specs sem o emulator no ar.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/rules/**/*.{test,spec}.{ts,tsx}'],
    // Sem retries: o emulator é determinístico; falha = regra divergiu.
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
