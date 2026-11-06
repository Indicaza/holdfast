import { useEffect, useState } from 'react'
import { apiJson } from '../../Api/apiClient.js'
import { useLiveRefresh } from '../../Live/liveUpdatesContext.js'
import { farmingDuration, farmingRunLabel, farmingHourlyYield, farmingCoverageLabel } from './farmingSessionModel.js'

export default function FarmingSessions() {
  const [refresh, setRefresh] = useState(0)
  useLiveRefresh(['farming'], () => setRefresh((version) => version + 1), { debounceMs: 1000 })
  const [state, setState] = useState({ status: 'loading', sessions: [] })
  const [mode, setMode] = useState('')
  const [realm, setRealm] = useState('')
  const [build, setBuild] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (mode) params.set('mode', mode)
    if (realm.trim()) params.set('realm', realm.trim())
    if (build.trim()) params.set('build', build.trim())
    setState((current) => ({ ...current, status: 'loading' }))
    apiJson(`/api/intelligence/farming/sessions?${params}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ status: 'ready', sessions: data.sessions || [] }) })
      .catch(() => { if (!controller.signal.aborted) setState({ status: 'error', sessions: [] }) })
    return () => controller.abort()
  }, [refresh, mode, realm, build])

  useEffect(() => {
    if (state.status !== 'ready' || !state.sessions.some((session) => session.quality === 'awaiting_observations')) return undefined
    const timer = window.setInterval(() => setRefresh((version) => version + 1), 60000)
    return () => window.clearInterval(timer)
  }, [state.status, state.sessions])

  return (
    <details className="farm-sessions">
      <summary>Farming runs · materials per hour</summary>
      <p>Timed runs include travel and waiting. Automatic runs estimate the window between harvests; gaps over 10 minutes start another run. Rates need a completed run, at least 20 minutes and 10 harvests, with at least 90% of declared harvests synced. Missing harvests get a 15-minute sync window.</p>
      <div className="farm-sessions__filters">
        <label>Timing<select aria-label="Timing" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="">All runs</option><option value="manual">Measured</option><option value="automatic">Estimated</option>
        </select></label>
        <label>Realm<input value={realm} onChange={(event) => setRealm(event.target.value)} placeholder="Exact realm name" /></label>
        <label>Build<input value={build} onChange={(event) => setBuild(event.target.value)} placeholder="Build number" /></label>
      </div>
      <p>Use Start farming in Guildweaver, or type /gw farm start and /gw farm stop. Runs end on logout or reload. Use /gw sync to send a saved run now.</p>
      {state.status === 'loading' ? <p>Reading farming runs…</p> : null}
      {state.status === 'error' ? <p role="status">Farming runs are unavailable right now.</p> : null}
      {state.status === 'ready' && !state.sessions.length ? <p>No farming runs match yet.</p> : null}
      <ul className="farm-sessions__list">
        {state.sessions.map((session) => (
          <li key={session.id}>
            <header><strong>{farmingRunLabel(session)}</strong><span>{farmingDuration(session.durationSeconds)} · {session.observedGathers} harvests</span></header>
            <p>{session.zone || 'Zone unknown'} · {session.realm || 'Realm unknown'} · build {session.build || 'unknown'}{session.classToken ? ` · ${session.classToken}` : ''}</p>
            <p>{session.timing === 'measured' ? 'Measured elapsed time' : 'Estimated observed window'}{session.afkSeconds === null ? ' · AFK time unavailable' : ` · ${farmingDuration(session.afkSeconds)} AFK`}</p>
            {session.partial ? <p>{farmingCoverageLabel(session)}{session.quality === 'sustained' ? ' · Rates use observed materials only; missing harvests may lower the estimate.' : ''}</p> : null}
            <ul>{session.outputs.map((output) => (
              <li key={output.itemKey}>{output.name || output.itemKey}: {output.quantity} · <strong>{farmingHourlyYield(output)}</strong>
                {output.perNonAfkHour !== null ? ` · ${output.perNonAfkHour.toFixed(1)}/hour excluding AFK` : ''}
              </li>
            ))}</ul>
          </li>
        ))}
      </ul>
      <p>Materials are observed loot-window yields. They may include items left behind. Rates describe each whole run; realms and builds stay visible for comparison.</p>
    </details>
  )
}
