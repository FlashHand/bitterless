import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [/rig_dev\/.*\/node_modules/]
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/preload/home/home.preload.ts'),
          sqlite: resolve('src/preload/sqlite/sqlite.preload.ts')
        },
        external: [/rig_dev\/.*\/node_modules/]
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/renderer/home/index.html'),
          sqlite: resolve('src/renderer/sqlite/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [vue()]
  }
})
