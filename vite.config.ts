import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
  const withElectron = command === 'build' || mode === 'electron'

  return {
    plugins: [
      react(),
      ...(withElectron
        ? await electron({
            main: {
              entry: 'electron/main.ts',
              vite: {
                build: {
                  lib: {
                    entry: 'electron/main.ts',
                    formats: ['cjs'],
                    fileName: () => 'main.cjs',
                  },
                },
              },
            },
            preload: {
              input: 'electron/preload.ts',
              vite: {
                build: {
                  rolldownOptions: {
                    output: {
                      entryFileNames: 'preload.cjs',
                      chunkFileNames: '[name].cjs',
                    },
                  },
                },
              },
            },
          })
        : []),
    ],
  }
})
