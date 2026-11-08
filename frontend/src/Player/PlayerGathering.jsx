import { disciplineLabel, formatCount } from '../Intelligence/Farming/farmingModel.js'
import { farmingDuration, farmingRunLabel } from '../Intelligence/Farming/farmingSessionModel.js'
import { classIdentity } from '../Intelligence/classIdentity.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import { sourceHref } from './exploreModel.js'
import { playerApiUrl, relativeTime } from './playerModel.js'
import { DisciplineTag, EmptyState, ErrorState, Icon, ItemLabel, Panel, SkeletonRows, Stat, Zone } from './ui.jsx'

const FARMING_TOPICS = ['player', 'farming']

// What the player's own characters gathered, fished and looted on the chosen
// server. Kept apart from the community drop rates, which pool everyone's
// observations without saying whose they are.
export default function PlayerGathering({ server }) {
  const { status, data } = useLiveResource(playerApiUrl('farming', server), { topics: FARMING_TOPICS })

  if (status === 'loading') return <SkeletonRows rows={8} label="Loading your gathering" />
  if (status === 'error' || status === 'missing') return <ErrorState>Your gathering could not be loaded.</ErrorState>
  if (!data?.summary?.observations) {
    return (
      <EmptyState
        title={server ? 'No farming on this server yet.' : 'No farming synced yet.'}
        icon="gathering"
        action={<a className="gw-btn" href="/dashboard/farming">Browse community drop rates</a>}
      >
        Gather, fish, skin or loot with Guildweaver running, then <kbd>/reload</kbd> or log out to send it.
      </EmptyState>
    )
  }

  const maxItem = Math.max(1, ...data.items.map((item) => Number(item.quantity) || 0))
  const maxSource = Math.max(1, ...data.sources.map((source) => Number(source.observations) || 0))

  return (
    <div className="gw-stack">
      <section className="gw-stats gw-stats--3" aria-label="Your farming summary">
        <Stat label="Gathers & loots" icon="gathering" value={formatCount(data.summary.observations)} foot={`From ${formatCount(data.summary.sources)} source${data.summary.sources === 1 ? '' : 's'}`} />
        <Stat label="Materials" icon="loot" value={formatCount(data.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0))} foot={`${data.items.length} different item${data.items.length === 1 ? '' : 's'}`} />
        <Stat label="Last gathered" icon="bolt" value={<span className="gw-stat__time">{relativeTime(data.summary.lastObservedAt)}</span>} foot={data.disciplines.map((entry) => disciplineLabel(entry.discipline)).join(', ')} />
      </section>

      <div className="gw-grid gw-grid--2">
        <Panel id="player-farming-items" title="What you collected" flush>
          <ul className="gw-bars">
            {data.items.map((item) => (
              <li key={item.itemKey}>
                <ItemLabel item={item} size={24} />
                <span className="gw-bars__bar" aria-hidden="true"><i style={{ width: `${((Number(item.quantity) || 0) / maxItem) * 100}%` }} /></span>
                <strong>{formatCount(item.quantity)}</strong>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="player-farming-sources" title="Where you farmed" flush>
          <ul className="gw-bars">
            {data.sources.map((source) => (
              <li key={source.sourceKey}>
                <a className="gw-bars__label" href={sourceHref(source.sourceKey)}>
                  <strong>{source.name}</strong>
                  <span><DisciplineTag discipline={source.discipline} compact />{source.zone ? <Zone name={source.zone} /> : null}</span>
                </a>
                <span className="gw-bars__bar" aria-hidden="true"><i style={{ width: `${((Number(source.observations) || 0) / maxSource) * 100}%` }} /></span>
                <strong>{formatCount(source.observations)}×</strong>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel id="player-farming-recent" title="Your latest gathers" flush>
        <div className="gw-table-wrap">
          <table className="gw-table">
            <thead>
              <tr>
                <th scope="col">Got</th>
                <th scope="col">From</th>
                <th scope="col" className="gw-hide-sm">Character</th>
                <th scope="col" className="gw-col-num">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {entry.outputs.length ? (
                      <ul className="gw-got">
                        {entry.outputs.map((output) => (
                          <li key={output.itemKey}><span className="gw-got__qty">{formatCount(output.quantity)}×</span><ItemLabel item={output} size={20} /></li>
                        ))}
                      </ul>
                    ) : <span className="gw-muted">Nothing</span>}
                  </td>
                  <td>
                    <a className="gw-row-link" href={sourceHref(entry.sourceKey)}>
                      <strong>{entry.sourceName}</strong>
                      <Zone name={[entry.zone, entry.subzone].filter(Boolean).join(' · ')} />
                    </a>
                  </td>
                  <td className="gw-hide-sm">
                    {entry.character
                      ? <span className="gw-class-name" style={{ '--class-color': classIdentity(entry.character.className).color || 'var(--gw-text)' }}>{entry.character.name}</span>
                      : <span className="gw-muted">—</span>}
                  </td>
                  <td className="gw-col-num gw-muted">{relativeTime(entry.capturedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {data.sessions.length ? (
        <Panel id="player-farming-runs" title="Your farming runs" flush>
          <div className="gw-table-wrap">
            <table className="gw-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col" className="gw-hide-sm">Zone</th>
                  <th scope="col" className="gw-col-num">Duration</th>
                  <th scope="col" className="gw-col-num">Harvests</th>
                  <th scope="col">Top haul</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => (
                  <tr key={session.id}>
                    <td><strong>{farmingRunLabel(session)}</strong></td>
                    <td className="gw-hide-sm"><Zone name={session.zone} /></td>
                    <td className="gw-col-num">{farmingDuration(session.durationSeconds)}</td>
                    <td className="gw-col-num">{formatCount(session.observedGathers)}</td>
                    <td className="gw-muted">{session.outputs.slice(0, 2).map((output) => `${output.quantity}× ${output.name || output.itemKey}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <p className="gw-footnote"><Icon name="info" size={12} /> Only you can see this page.</p>
    </div>
  )
}
