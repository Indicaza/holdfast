import { useState } from 'react'

import { SOURCE_LABELS, formatAge, formatDateTime } from './marketFormat.js'
import { marketWrite, useMarketResource } from './useMarket.js'

function ago(seconds, now) {
  return seconds ? formatAge(Math.max(0, now - seconds)) : 'never'
}

function bytes(value) {
  if (!Number.isFinite(value)) return '—'
  if (value > 1e9) return `${(value / 1e9).toFixed(2)} GB`
  if (value > 1e6) return `${(value / 1e6).toFixed(1)} MB`
  return `${Math.round(value / 1e3)} kB`
}

// Links an in-game market to an API house, after an administrator checked
// in the game that they are the same auction house.
function LinkControl({ entry, apiHouses, onDone }) {
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState('')
  const candidates = apiHouses.filter((house) => house.region === entry.market.region && house.faction === entry.market.faction)
  async function link(shared = false) {
    setMessage('')
    try {
      await marketWrite('/api/market/admin/links', { method: 'POST', body: { marketKey: entry.marketKey, linkedMarketKey: target, shared } })
      onDone()
    } catch (error) {
      if (error?.body?.reason === 'house_linked_to_other_realm' && window.confirm(`That house is already linked to ${error.body.realms.join(', ')}. Link this realm too? Only do this if you checked in game that both realms share the auction house.`)) {
        await link(true)
        return
      }
      setMessage(error?.body?.reason || 'Could not link')
    }
  }
  return (
    <div className="gw-diag__link">
      <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label={`API house for ${entry.marketKey}`}>
        <option value="">Choose the matching API house…</option>
        {candidates.map((house) => <option key={house.marketKey} value={house.marketKey}>{house.name}</option>)}
      </select>
      <button type="button" className="gw-btn gw-btn--xs" disabled={!target} onClick={() => link(false)}>Link</button>
      {message ? <span className="gw-fresh--stale">{message}</span> : null}
    </div>
  )
}

// Administrators: which markets exist, what feeds them, how fresh and how
// big it all is, and which in-game markets still need linking.
export default function MarketDiagnostics() {
  const diagnostics = useMarketResource('/api/market/admin/diagnostics')
  if (diagnostics.status === 'loading') return <div className="gw-skeleton"><div className="gw-skeleton__row" /><div className="gw-skeleton__row" /></div>
  if (diagnostics.status === 'error' || !diagnostics.data) return <p className="gw-ahf__empty">Diagnostics could not be loaded (administrators only).</p>
  const data = diagnostics.data
  const now = data.now
  const apiHouses = data.markets.filter((market) => market.kind === 'api_house')
  const warnings = data.markets.flatMap((market) => market.warnings.map((warning) => ({ market, warning })))
  const provider = data.provider
  return (
    <div className="gw-diag">
      <section className="gw-diag__cards">
        <div><span>Markets</span><strong>{data.markets.length}</strong><small>{apiHouses.length} API houses · {data.markets.length - apiHouses.length} in-game</small></div>
        <div><span>Blizzard API</span><strong>{provider.config?.configured ? 'Connected' : 'Not configured'}</strong>
          <small>{provider.config?.configured ? `${provider.config.regions?.join(', ')} · every ${Math.round((provider.config.refreshSeconds || 0) / 60)} min · ${provider.stats?.requestsLastHour ?? 0}/${provider.config.maxRequestsPerHour} requests this hour` : 'Set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET on the server.'}</small></div>
        <div><span>Refresher</span><strong>{provider.stats ? `${provider.stats.refreshed} new · ${provider.stats.unchanged} unchanged` : 'Idle'}</strong>
          <small>{provider.stats ? `${provider.stats.failed} failed · ${provider.stats.skipped} rate-limited since start` : 'In-game scans only'}</small></div>
        <div><span>Storage</span><strong>{bytes(data.storage.databaseBytes)}</strong>
          <small>{(data.storage.rows.market_series_hourly || 0).toLocaleString('en-US')} hourly · {(data.storage.rows.market_series_daily || 0).toLocaleString('en-US')} daily · {(data.storage.rows.market_observations || 0).toLocaleString('en-US')} raw rows</small></div>
        <div><span>Maintenance</span><strong>{data.maintenance.rollup ? ago(data.maintenance.rollup.ranAt, now) : 'not yet run'}</strong>
          <small>{data.maintenance.prune ? `pruned ${Object.values(data.maintenance.prune.detail).reduce((sum, value) => sum + (Number(value) || 0), 0).toLocaleString('en-US')} rows` : 'runs daily'}</small></div>
      </section>

      {warnings.length ? (
        <section className="gw-diag__warn" role="alert">
          <h3>Needs attention</h3>
          <ul>{warnings.map(({ market, warning }) => <li key={`${market.marketKey}${warning}`}><strong>{market.name}</strong>: {warning}</li>)}</ul>
        </section>
      ) : <p className="gw-diag__ok">Every market with data was checked within the last day and no source is failing.</p>}

      <section>
        <h3>Markets</h3>
        <div className="gw-ahf__tablewrap">
          <table className="gw-ahf__table gw-ahf__table--plain gw-diag__table">
            <thead><tr><th scope="col">Market</th><th scope="col">Checked</th><th scope="col">Changed</th><th scope="col">Last full</th><th scope="col" className="gw-col-num">Listed</th>
              <th scope="col" className="gw-col-num">Stale</th><th scope="col" className="gw-col-num">Conflicts</th><th scope="col">Sources, 7 days</th><th scope="col">Endpoints</th><th scope="col">Checks, 24 h</th></tr></thead>
            <tbody>{data.markets.map((market) => (
              <tr key={market.marketKey} className={market.warnings.length ? 'is-stale' : ''}>
                <td><strong>{market.name}</strong><br /><code className="gw-small gw-muted">{market.marketKey}</code>{market.linkedMarketKey ? <><br /><small>→ {market.linkedMarketKey}{market.linkShared ? ' (shared house)' : ''}</small></> : null}</td>
                <td>{ago(market.lastCheckedAt, now)}</td>
                <td>{ago(market.lastChangedAt, now)}</td>
                <td>{ago(market.lastFullAt, now)}</td>
                <td className="gw-col-num">{market.listed.toLocaleString('en-US')}</td>
                <td className="gw-col-num">{market.staleSummaries.toLocaleString('en-US')}</td>
                <td className="gw-col-num">{market.conflicts}</td>
                <td className="gw-small">{market.sources.length ? market.sources.map((source) => (
                  <div key={`${source.source}${source.coverage}`}>{SOURCE_LABELS[source.source]} ({source.coverage}): {source.snapshots7d} snapshots, seen {ago(source.lastSeenAt, now)}{source.contributors7d ? `, ${source.contributors7d} players` : ''}</div>
                )) : <span className="gw-muted">none</span>}</td>
                <td className="gw-small">{market.endpoints.length ? market.endpoints.map((endpoint) => (
                  <div key={endpoint.endpoint} className={endpoint.consecutiveFailures ? 'gw-fresh--stale' : ''}>
                    {endpoint.endpoint}: {endpoint.lastStatus || '—'}{endpoint.consecutiveFailures ? ` (${endpoint.consecutiveFailures}× ${endpoint.lastError})` : ''}, ok {ago(endpoint.lastSuccessAt, now)}
                  </div>
                )) : <span className="gw-muted">—</span>}</td>
                <td className="gw-small">{Object.entries(market.checks24h).map(([outcome, value]) => <div key={outcome}>{outcome.replace('_', ' ')}: {value.count}</div>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section>
        <h3>Market identity</h3>
        <p className="gw-small gw-muted">In-game markets stay separate until an administrator links each one to the API house it is. Never link on price similarity alone: in the game, open that auction house, note a few distinctive listings (an odd price or stack), and confirm the same listings appear in the API house after its next refresh.</p>
        {data.identity.length ? (
          <ul className="gw-diag__identity">{data.identity.map((entry) => {
            const market = data.markets.find((row) => row.marketKey === entry.marketKey)
            return (
              <li key={`${entry.kind}${entry.marketKey}`}>
                <strong>{market?.name || entry.marketKey}</strong> <span className="gw-muted">{entry.text}</span>
                {entry.evidence?.length ? (
                  <table className="gw-table gw-table--dense">
                    <thead><tr><th scope="col">API house</th><th scope="col" className="gw-col-num">Items compared</th><th scope="col" className="gw-col-num">Same lowest ask</th>
                      <th scope="col" className="gw-col-num">Within 5%</th><th scope="col" className="gw-col-num">Median difference</th></tr></thead>
                    <tbody>{entry.evidence.map((row) => (
                      <tr key={row.marketKey}><td>{row.name}</td><td className="gw-col-num">{row.comparedItems}</td><td className="gw-col-num">{row.exactShare ?? '—'}{row.exactShare !== null ? '%' : ''}</td>
                        <td className="gw-col-num">{row.within5PctShare ?? '—'}{row.within5PctShare !== null ? '%' : ''}</td><td className="gw-col-num">{row.medianDifferencePct ?? '—'}{row.medianDifferencePct !== null ? '%' : ''}</td></tr>
                    ))}</tbody>
                  </table>
                ) : null}
                {entry.kind === 'unlinked' && market ? <LinkControl entry={{ ...entry, market }} apiHouses={apiHouses} onDone={diagnostics.reload} /> : null}
              </li>
            )
          })}</ul>
        ) : <p className="gw-small">Every in-game market is linked.</p>}
      </section>

      <section>
        <h3>Recent provider runs</h3>
        {data.runs.length ? (
          <div className="gw-ahf__tablewrap">
            <table className="gw-ahf__table gw-ahf__table--plain">
              <thead><tr><th scope="col">Started</th><th scope="col">Market</th><th scope="col">Status</th><th scope="col">Endpoints</th><th scope="col" className="gw-col-num">Auctions</th><th scope="col">Error</th></tr></thead>
              <tbody>{data.runs.map((run) => (
                <tr key={`${run.marketKey}${run.startedAt}`} className={run.status === 'failed' ? 'is-stale' : ''}>
                  <td>{formatDateTime(run.startedAt)}</td><td><code className="gw-small">{run.marketKey}</code></td><td>{run.status}</td>
                  <td className="gw-small">{(run.detail?.endpoints || []).map((entry) => `${entry.endpoint} ${entry.status}${entry.absent ? ` (${entry.absent} gone)` : ''}`).join(' · ')}</td>
                  <td className="gw-col-num">{run.auctions ?? '—'}</td><td className="gw-small">{run.error}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="gw-small gw-muted">No provider runs yet.</p>}
      </section>

      <section>
        <h3>Storage</h3>
        <table className="gw-table gw-table--dense gw-diag__storage">
          <tbody>{Object.entries(data.storage.rows).map(([table, rows]) => <tr key={table}><th scope="row"><code>{table}</code></th><td className="gw-col-num">{rows.toLocaleString('en-US')}</td></tr>)}</tbody>
        </table>
        <p className="gw-small gw-muted">Raw observations are kept {data.storage.retention.observationsDays} days, checks {data.storage.retention.checksDays}, hourly history 10, daily 400 and weekly 10 years.</p>
      </section>
    </div>
  )
}
