import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  base: '/3d/',
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
