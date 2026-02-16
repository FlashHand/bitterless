import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { config as dotenvConfig } from 'dotenv'

dotenvConfig({ path: resolve('.env.rig') })

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: [/rig_dev\/.*\/node_modules/, 'node-llama-cpp']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/preload/home/home.preload.ts'),
          sqlite: resolve('src/preload/sqlite/sqlite.preload.ts'),
          rigchat: resolve('src/preload/rigchat/rigchat.preload.ts'),
          llama: resolve('src/preload/llama/llama.preload.ts')
        },
        external: [/rig_dev\/.*\/node_modules/, 'node-llama-cpp']
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          home: resolve('src/renderer/home/index.html'),
          sqlite: resolve('src/renderer/sqlite/index.html'),
          rigchat: resolve('src/renderer/rigchat/index.html'),
          llama: resolve('src/renderer/llama/index.html')
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
