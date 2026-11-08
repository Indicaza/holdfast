import { useMemo } from 'react'

import { formatCount, observationLabel, sourcesUrl } from '../Intelligence/Farming/farmingModel.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import PlayerCharacterCard from './PlayerCharacterCard.jsx'
import { bestPlacesToFarm, rateScale, sourceHref } from './exploreModel.js'
import { dashboardHref, onServerKey, relativeTime, setupSteps, syncStatusCopy } from './playerModel.js'
import { Confidence, DisciplineTag, EmptyState, Icon, ItemLabel, Panel, RateBar, SkeletonRows, Stat, Zone } from './ui.jsx'

const COMMUNITY_TOPICS = ['farming']

export function SyncCallout({ sync, compact = false }) {
  const copy = syncStatusCopy(sync)
  if (compact && copy.tone === 'ok') return null
  return (
    <div className={`gw-callout gw-callout--${copy.tone}`} role="status">
      <div>
        <strong>{copy.title}</strong>
        {copy.body ? <p>{copy.body}</p> : null}
      </div>
      {copy.action ? <a className="gw-btn gw-btn--sm" href={copy.action.href}>{copy.action.label}</a> : null}
    </div>
  )
}

// Shown until the first character arrives: what to do next, from what the
// website has actually received. The community data below it works already.
function SetupChecklist({ sync }) {
  const steps = setupSteps(sync)
  const done = steps.filter((step) => step.done).length
  return (
    <Panel
      className="gw-setup"
      id="player-setup"
      title="Three steps to your first sync."
      description="Guildweaver runs beside WoW on your computer. It installs the addon and uploads what the addon saves. Community drop rates below work without it."
      actions={<span className="gw-tag">{done} of {steps.length} done</span>}
    >
      <ol className="gw-setup__steps">
        {steps.map((step, index) => (
          <li key={step.id} className={step.done ? 'is-done' : undefined}>
            <span className="gw-setup__marker" aria-hidden="true">{step.done ? '✓' : index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <span className="visually-hidden">{step.done ? ' (done)' : ' (to do)'}</span>
              {step.id === 'install' ? <p><a href="/download">Download Guildweaver</a> for Windows, macOS or Linux and open the installer.</p> : null}
              {step.id === 'connect' ? <p>Open Guildweaver. It shows a code and opens this site; sign in with Discord and approve this computer.</p> : null}
              {step.id === 'sync' ? <p>Play, then <kbd>/reload</kbd> or log out. WoW writes addon data only then, so uploads arrive at those moments.</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <SyncCallout sync={sync} />
    </Panel>
  )
}

function BestPlaces({ sources }) {
  const rows = useMemo(() => bestPlacesToFarm(sources).slice(0, 8), [sources])
  const max = rateScale(rows.map((row) => row.best.drop))
  if (!rows.length) {
    return <EmptyState title="No rare drops recorded yet." icon="sparkle">Rare drops show up once players gather or loot with Guildweaver running.</EmptyState>
  }
  return (
    <div className="gw-table-wrap">
      <table className="gw-table">
        <thead>
          <tr>
            <th scope="col">Drop</th>
            <th scope="col">Best source</th>
            <th scope="col" className="gw-col-rate">Chance</th>
            <th scope="col" className="gw-col-num gw-hide-sm">Sources</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, best, places }) => (
            <tr key={item.itemKey} className="is-link">
              <td><ItemLabel item={item} size={24} /></td>
              <td>
                <a className="gw-row-link" href={sourceHref(best.source.sourceKey, { item: item.itemKey })}>
                  <strong>{best.source.name}</strong>
                  <Zone name={best.source.primaryZone} />
                </a>
              </td>
              <td className="gw-col-rate">
                <span className="gw-rate-cell">
                  <RateBar entry={best.drop} max={max} />
                  <Confidence confidence={best.drop.confidence} />
                </span>
              </td>
              <td className="gw-col-num gw-hide-sm">{places.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TopZones({ zones }) {
  const top = zones.slice(0, 7)
  const max = Math.max(1, ...top.map((zone) => zone.observations))
  return (
    <ul className="gw-zones">
      {top.map((zone) => (
        <li key={zone.zone}>
          <a href={`${dashboardHref('farming')}?zone=${encodeURIComponent(zone.zone)}`}>
            <span className="gw-zones__name">{zone.zone}</span>
            <span className="gw-zones__meta">{formatCount(zone.sources)} source{zone.sources === 1 ? '' : 's'}</span>
            <span className="gw-zones__bar" aria-hidden="true"><i style={{ width: `${(zone.observations / max) * 100}%` }} /></span>
            <span className="gw-zones__count">{formatCount(zone.observations)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function YourCharacters({ characters, server, onOpenCharacter }) {
  if (!characters.length) {
    return <EmptyState title="No characters yet." icon="characters">Log in with Guildweaver running, then <kbd>/reload</kbd>.</EmptyState>
  }
  return (
    <div className="gw-char-list">
      {characters.slice(0, 5).map((character) => (
        <PlayerCharacterCard character={character} key={character.id} onOpen={onOpenCharacter} showServer={!server} compact />
      ))}
    </div>
  )
}

export default function PlayerOverview({ data, server, onOpenCharacter }) {
  const community = useLiveResource(sourcesUrl({}), { topics: COMMUNITY_TOPICS })
  const characters = useMemo(() => (data.characters || []).filter((character) => onServerKey(character, server)), [data.characters, server])
  const sync = data.sync || {}
  const sources = community.data?.sources || []
  const disciplines = community.data?.disciplines || []
  const zones = community.data?.zones || []
  const totalObservations = disciplines.reduce((sum, entry) => sum + (Number(entry.observations) || 0), 0)
  const hasCharacters = Boolean(data.characters?.length)
  const lastSync = sync.lastUploadAt || sync.lastCharacterAt

  return (
    <div className="gw-stack">
      {hasCharacters ? <SyncCallout sync={sync} compact /> : <SetupChecklist sync={sync} />}

      <section className="gw-stats" aria-label="Your summary">
        <Stat label="Observations" icon="farming" value={community.status === 'ready' ? formatCount(totalObservations) : '—'} foot="Pooled from every player" />
        <Stat label="Sources tracked" icon="pin" value={community.status === 'ready' ? formatCount(sources.length) : '—'} foot={`Across ${formatCount(zones.length)} zone${zones.length === 1 ? '' : 's'}`} />
        <Stat label="Your characters" icon="characters" value={characters.length} foot={server ? 'On this server' : `On ${data.servers?.length || 0} server${data.servers?.length === 1 ? '' : 's'}`} />
        <Stat label="Last sync" icon="guildweaver" value={<span className="gw-stat__time">{relativeTime(lastSync)}</span>} foot={sync.connectedDevices ? `${sync.connectedDevices} device${sync.connectedDevices === 1 ? '' : 's'} connected` : 'No device connected'} />
      </section>

      <div className="gw-grid gw-grid--main">
        <div className="gw-stack">
          <Panel
            id="gw-best"
            title="Best places to farm"
            description="Each notable drop and the source that gives it most often."
            actions={<a className="gw-link" href={dashboardHref('farming', server)}>All drop rates <Icon name="chevron" size={14} /></a>}
            flush
          >
            {community.status === 'loading' ? <SkeletonRows rows={6} label="Loading drop rates" /> : null}
            {community.status === 'error' ? <p className="gw-muted gw-pad">Drop rates are unavailable right now.</p> : null}
            {community.status === 'ready' ? <BestPlaces sources={sources} /> : null}
          </Panel>
          {community.status === 'ready' && sources.length ? (
            <Panel
              id="gw-top-sources"
              title="Popular sources"
              actions={<a className="gw-link" href={dashboardHref('farming', server)}>Browse all <Icon name="chevron" size={14} /></a>}
            >
              <ul className="gw-source-tiles">
                {sources.slice(0, 6).map((source) => (
                  <li key={source.sourceKey}>
                    <a href={sourceHref(source.sourceKey)} className={`gw-source-tile gw-source-tile--${source.discipline}`}>
                      <ItemLabel item={{ ...source.icon, name: source.name }} size={36} tooltip={false} />
                      <span className="gw-source-tile__meta">
                        <DisciplineTag discipline={source.discipline} />
                        <Zone name={source.primaryZone} extra={Math.max(0, (source.zones || 0) - 1)} />
                      </span>
                      <span className="gw-source-tile__count">
                        <strong>{formatCount(source.observations)}</strong>
                        <small>{observationLabel(source.discipline, source.observations)}</small>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="gw-stack">
          <Panel
            id="gw-your-characters"
            title="Your characters"
            actions={hasCharacters ? <a className="gw-link" href={dashboardHref('characters', server)}>All characters <Icon name="chevron" size={14} /></a> : null}
          >
            <YourCharacters characters={characters} server={server} onOpenCharacter={onOpenCharacter} />
          </Panel>

          <Panel id="gw-zones" title="Where people farm">
            {community.status === 'ready' && zones.length ? <TopZones zones={zones} /> : null}
            {community.status === 'ready' && !zones.length ? <p className="gw-muted">No zones recorded yet.</p> : null}
            {community.status === 'loading' ? <SkeletonRows rows={4} label="Loading zones" /> : null}
          </Panel>
        </div>
      </div>

    </div>
  )
}
