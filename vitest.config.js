import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Most specs cover pure logic or THREE scene graphs and run fine under Node.
    // Specs that touch `window`/`document` (ui, input, audio) opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file instead of paying
    // the jsdom cost for every test file.
    environment: 'node',
    include: ['src/**/*.test.js'],
    setupFiles: ['./src/test-utils/setupJsdomCanvas.js'],
  },
});
