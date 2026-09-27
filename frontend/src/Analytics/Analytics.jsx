import { useCallback, useEffect, useState } from 'react'
import {
  ANALYTICS_ENABLED,
  ANALYTICS_MEASUREMENT_ID,
  ANALYTICS_SETTINGS_EVENT,
} from './analyticsSettings.js'
import './Analytics.css'

const CONSENT_KEY = 'holdfast.analytics.consent'

function savedConsent() {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : 'unknown'
  } catch {
    return 'unknown'
  }
}

function saveConsent(value) {
  try {
    window.localStorage.setItem(CONSENT_KEY, value)
  } catch {
    return
  }
}

function initializeAnalytics() {
  if (window.gtag) {
    return
  }

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    window.dataLayer.push(arguments)
  }

  window.gtag('js', new Date())
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
  })
  window.gtag('config', ANALYTICS_MEASUREMENT_ID, {
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
    send_page_view: false,
  })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS_MEASUREMENT_ID)}`
  script.dataset.holdfastAnalytics = 'true'
  document.head.appendChild(script)
}

function recordPageView() {
  window.gtag?.('event', 'page_view', {
    page_location: window.location.href,
    page_path: `${window.location.pathname}${window.location.search}`,
    page_title: document.title,
  })
}

function Analytics() {
  const [consent, setConsent] = useState(savedConsent)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const choose = useCallback((value) => {
    saveConsent(value)
    setConsent(value)
    setSettingsOpen(false)
  }, [])

  useEffect(() => {
    if (!ANALYTICS_ENABLED) {
      return
    }

    if (consent === 'granted') {
      window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = false
      initializeAnalytics()
      window.gtag?.('consent', 'update', { analytics_storage: 'granted' })
      recordPageView()
      return
    }

    if (consent === 'denied' && window.gtag) {
      window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = true
      window.gtag('consent', 'update', { analytics_storage: 'denied' })
    }
  }, [consent])

  useEffect(() => {
    function openSettings() {
      setSettingsOpen(true)
    }

    window.addEventListener(ANALYTICS_SETTINGS_EVENT, openSettings)
    return () =>
      window.removeEventListener(ANALYTICS_SETTINGS_EVENT, openSettings)
  }, [])

  if (!ANALYTICS_ENABLED || (consent !== 'unknown' && !settingsOpen)) {
    return null
  }

  return (
    <aside className="analytics-consent" aria-label="Analytics preferences">
      <div className="analytics-consent__copy">
        <strong>Help us improve Holdfast.</strong>
        <p>
          Allow anonymous Google Analytics so we can see which public pages are
          useful. Guild profiles and Discord identity are not sent.
        </p>
      </div>

      <div className="analytics-consent__actions">
        <button type="button" onClick={() => choose('denied')}>
          No thanks
        </button>
        <button
          className="analytics-consent__accept"
          type="button"
          onClick={() => choose('granted')}
        >
          Allow analytics
        </button>
      </div>
    </aside>
  )
}

export default Analytics
