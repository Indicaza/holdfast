export const ANALYTICS_SETTINGS_EVENT = 'holdfast:analytics-settings'
export const ANALYTICS_MEASUREMENT_ID = String(
  import.meta.env.VITE_GA_MEASUREMENT_ID || '',
).trim()
export const ANALYTICS_ENABLED = /^G-[A-Z0-9]+$/i.test(
  ANALYTICS_MEASUREMENT_ID,
)

export function openAnalyticsSettings() {
  window.dispatchEvent(new Event(ANALYTICS_SETTINGS_EVENT))
}
