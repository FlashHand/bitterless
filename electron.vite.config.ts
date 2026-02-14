import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { config as dotenvConfig } from 'dotenv'

dotenvConfig({ path: resolve('.env.rig') })

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
          sqlite: resolve('src/preload/sqlite/sqlite.preload.ts'),
          wechaty: resolve('src/preload/wechaty/wechaty.preload.ts')
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
          sqlite: resolve('src/renderer/sqlite/index.html'),
          wechaty: resolve('src/renderer/wechaty/index.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@': resolve('src/renderer/home/src')
      }
    },
    plugins: [vue()]
  }
})
