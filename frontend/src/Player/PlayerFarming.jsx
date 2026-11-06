import { useState } from 'react'

import EmptyTelemetry from '../Intelligence/EmptyTelemetry.jsx'
import FarmingIntelligence from '../Intelligence/Farming/FarmingIntelligence.jsx'
import { disciplineLabel } from '../Intelligence/Farming/farmingModel.js'
import { farmingDuration, farmingRunLabel } from '../Intelligence/Farming/farmingSessionModel.js'
import { useLiveResource } from '../Live/useLiveResource.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import { playerApiUrl, relativeTime } from './playerModel.js'

const FARMING_TOPICS = ['player', 'farming']

// What the player gathered, fished and looted on the chosen server. Kept
// apart from the community drop rates below it, which pool everyone's
// observations without saying whose they are.
function MyFarming({ server }) {
  const { status, data } = useLiveResource(playerApiUrl('farming', server), { topics: FARMING_TOPICS })

  if (status === 'loading') return <p className="intel-muted" role="status">Loading your farming…</p>
  if (status === 'error' || status === 'missing') return <p className="intel-error" role="alert">Your farming could not be loaded.</p>
  if (!data?.summary?.observations) {
    return (
      <EmptyTelemetry title={server ? 'No farming on this server yet.' : 'No farming synced yet.'}>
        Gather, fish, skin or loot with Guildweaver running, then /reload or log out to send it.
      </EmptyTelemetry>
    )
  }

  return (
    <>
      <section className="intel-scorecards" aria-label="Your farming summary">
        <article><span>Gathers &amp; loots</span><strong>{data.summary.observations}</strong><small>Recorded by your characters</small></article>
        <article><span>Sources</span><strong>{data.summary.sources}</strong><small>Nodes, pools and creatures</small></article>
        <article><span>Last recorded</span><strong className="player-scorecard__time">{relativeTime(data.summary.lastObservedAt)}</strong><small>{data.disciplines.map((entry) => disciplineLabel(entry.discipline)).join(', ')}</small></article>
      </section>

      <div className="player-overview-grid">
        <section className="intel-panel" aria-labelledby="player-farming-items">
          <div className="intel-panel__heading">
            <span>Materials</span>
            <h2 id="player-farming-items">What you collected</h2>
          </div>
          <ul className="player-farming__items">
            {data.items.map((item) => (
              <li key={item.itemKey}>
                <WowIcon iconFileId={item.iconFileDataId} itemId={item.itemId} label={item.name} size={28} />
                <span>{item.name}</span>
                <strong>{item.quantity}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="intel-panel" aria-labelledby="player-farming-sources">
          <div className="intel-panel__heading">
            <span>Sources</span>
            <h2 id="player-farming-sources">Where you farmed</h2>
          </div>
          <ul className="player-farming__sources">
            {data.sources.map((source) => (
              <li key={source.sourceKey}>
                <span><strong>{source.name}</strong><small>{disciplineLabel(source.discipline)}{source.zone ? ` · ${source.zone}` : ''}</small></span>
                <em>{source.observations}×</em>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="intel-panel" aria-labelledby="player-farming-recent">
        <div className="intel-panel__heading">
          <span>Recent</span>
          <h2 id="player-farming-recent">Your latest gathers</h2>
        </div>
        <ul className="player-farming__recent">
          {data.recent.map((entry) => (
            <li key={entry.id}>
              <span><strong>{entry.sourceName}</strong><small>{[entry.zone, entry.subzone].filter(Boolean).join(' · ') || 'Zone unknown'}</small></span>
              <span>{entry.outputs.map((output) => `${output.quantity}× ${output.name}`).join(', ') || 'Nothing'}</span>
              <em>{relativeTime(entry.capturedAt)}</em>
            </li>
          ))}
        </ul>
        {data.sessions.length ? (
          <>
            <h3 className="player-server-group__title">Your farming runs</h3>
            <ul className="player-farming__recent">
              {data.sessions.map((session) => (
                <li key={session.id}>
                  <span><strong>{farmingRunLabel(session)}</strong><small>{session.zone || 'Zone unknown'}</small></span>
                  <span>{farmingDuration(session.durationSeconds)} · {session.observedGathers} harvests</span>
                  <em>{session.outputs.slice(0, 2).map((output) => `${output.quantity}× ${output.name || output.itemKey}`).join(', ')}</em>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </>
  )
}

export default function PlayerFarming({ server }) {
  const [communityInput, setCommunityInput] = useState('')
  return (
    <>
      <MyFarming server={server} />
      <section className="player-community" aria-labelledby="player-community-title">
        <div className="intel-panel__heading">
          <span>Community</span>
          <h2 id="player-community-title">Drop rates from every Guildweaver player</h2>
          <p>Pooled, anonymous observations: no names, characters or accounts. Not filtered by your server.</p>
        </div>
        <FarmingIntelligence input={communityInput} onInputChange={setCommunityInput} sessions={false} />
      </section>
    </>
  )
}
