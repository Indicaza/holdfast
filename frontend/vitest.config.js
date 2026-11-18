import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Component tests (*.test.jsx, jsdom). Model tests stay on node --test
// (test/*.test.js); `npm test` runs both.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.jsx'],
  },
})
