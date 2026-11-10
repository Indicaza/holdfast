import { defineConfig, devices } from '@playwright/test'

// Two copies of the app run side by side in CI:
//   solo   (E2E_BASE_URL)        guild features off, as production runs today
//   guilds (E2E_GUILD_BASE_URL)  GUILDWEAVER_GUILD_FEATURES=true, so the
//                                guild site keeps its journeys until it returns
// Solo journeys are the *.solo.spec.js files; everything else is a guild
// journey. Sessions are cookies on 127.0.0.1, so they reach both copies.
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173'
const guildBaseURL = process.env.E2E_GUILD_BASE_URL || 'http://127.0.0.1:4174'
const SOLO = /\.solo\.spec\.js$/

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  reporter: process.env.CI
    ? [
        ['line'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
      ]
    : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'solo',
      testMatch: SOLO,
      use: { ...devices['Desktop Chrome'], baseURL },
    },
    {
      name: 'guilds',
      testIgnore: SOLO,
      use: { ...devices['Desktop Chrome'], baseURL: guildBaseURL },
    },
  ],
})
