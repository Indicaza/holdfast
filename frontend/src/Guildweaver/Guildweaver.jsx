import { useEffect } from 'react'

import Home from '../Home/Home.jsx'
import GuildweaverModal from './GuildweaverModal.jsx'
import { useGuildweaverStatus } from './useGuildweaverStatus.js'

function onboardingDismissLabel(returnTo, welcome) {
  if (!welcome) return ''

  try {
    const url = new URL(returnTo, 'https://holdfast.invalid')
    if (url.searchParams.has('signupQuest') && url.searchParams.has('signupObjective')) {
      return 'Continue to objective'
    }
  } catch {
    return 'Not now'
  }

  return 'Not now'
}

export default function Guildweaver({
  welcome = false,
  autoOnly = false,
  returnTo = '/',
}) {
  const status = useGuildweaverStatus()
  const statusReady = status.status === 'ready'
  const connected = statusReady && status.connected
  const shouldShow =
    !autoOnly || status.status === 'error' || (statusReady && !connected)

  useEffect(() => {
    if (autoOnly && connected) {
      window.location.replace(returnTo)
    }
  }, [autoOnly, connected, returnTo])

  function close() {
    window.location.assign(returnTo)
  }

  return (
    <Home
      overlay={
        shouldShow ? (
          <GuildweaverModal
            welcome={welcome}
            dismissLabel={onboardingDismissLabel(returnTo, welcome)}
            onClose={close}
          />
        ) : null
      }
    />
  )
}
