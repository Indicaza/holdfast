import { useMemo } from 'react'

import CharacterCard from '../Intelligence/CharacterCard.jsx'
import { dashboardHref, onServerKey, relativeTime, setupSteps, syncStatusCopy, withServer } from './playerModel.js'

export function SyncCallout({ sync, compact = false }) {
  const copy = syncStatusCopy(sync)
  if (compact && copy.tone === 'ok') return null
  return (
    <div className={`player-callout player-callout--${copy.tone}`} role="status">
      <strong>{copy.title}</strong>
      {copy.body ? <p>{copy.body}</p> : null}
      {copy.action ? <a className="player-callout__action" href={copy.action.href}>{copy.action.label} →</a> : null}
    </div>
  )
}

// Shown until the first character arrives: what to do next, from what the
// website has actually received.
function SetupChecklist({ sync }) {
  const steps = setupSteps(sync)
  return (
    <section className="player-setup intel-panel" aria-labelledby="player-setup-title">
      <div className="intel-panel__heading">
        <span>Get started</span>
        <h2 id="player-setup-title">Three steps to your first sync.</h2>
        <p>Guildweaver runs beside WoW on your computer. It installs the addon and uploads what the addon saves.</p>
      </div>
      <ol className="player-setup__steps">
        {steps.map((step, index) => (
          <li key={step.id} className={step.done ? 'player-setup__step player-setup__step--done' : 'player-setup__step'}>
            <span className="player-setup__marker" aria-hidden="true">{step.done ? '✓' : index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <span className="visually-hidden">{step.done ? ' (done)' : ' (to do)'}</span>
              {step.id === 'install' ? <p><a href="/download">Download Guildweaver</a> for Windows, macOS or Linux and open the installer.</p> : null}
              {step.id === 'connect' ? <p>Open Guildweaver. It shows a code and opens this site; sign in with Discord and approve this computer.</p> : null}
              {step.id === 'sync' ? <p>Play, then <kbd>/reload</kbd> or log out. WoW writes addon data only at those moments, so uploads arrive then, not live while you play.</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <SyncCallout sync={sync} />
    </section>
  )
}

export default function PlayerOverview({ data, server, onOpenCharacter }) {
  const characters = useMemo(() => (data.characters || []).filter((character) => onServerKey(character, server)), [data.characters, server])
  const sync = data.sync || {}

  if (!data.characters?.length) return <SetupChecklist sync={sync} />

  const servers = server ? data.servers.filter((entry) => entry.key === server) : data.servers
  const highest = characters.reduce((best, character) => Math.max(best, Number(character.level) || 0), 0)
  const professions = new Set(characters.flatMap((character) => character.professions || []))

  return (
    <>
      <SyncCallout sync={sync} compact />

      <section className="intel-scorecards" aria-label="Your summary">
        <article><span>Characters</span><strong>{characters.length}</strong><small>{server ? 'On this server' : 'Across your servers'}</small></article>
        <article><span>Servers</span><strong>{servers.length}</strong><small>Where you have synced</small></article>
        <article><span>Highest level</span><strong>{highest || '—'}</strong><small>From the latest snapshots</small></article>
        <article><span>Last sync</span><strong className="player-scorecard__time">{relativeTime(sync.lastUploadAt || sync.lastCharacterAt)}</strong><small>{professions.size} profession{professions.size === 1 ? '' : 's'} known</small></article>
      </section>

      <div className="player-overview-grid">
        <section className="intel-panel intel-characters">
          <div className="intel-panel__heading intel-panel__heading--split">
            <div>
              <span>Recently synced</span>
              <h2>Your characters</h2>
              <p>Each card is the latest snapshot Guildweaver received. Open one for gear, stats, talents and bags.</p>
            </div>
            <a href={dashboardHref('characters', server)}>All characters →</a>
          </div>
          <div className="intel-character-grid">
            {characters.slice(0, 6).map((character) => <CharacterCard character={character} key={character.id} onOpen={onOpenCharacter} />)}
          </div>
        </section>

        <aside className="intel-panel player-servers" aria-labelledby="player-servers-title">
          <div className="intel-panel__heading">
            <span>Servers</span>
            <h2 id="player-servers-title">Where you play</h2>
          </div>
          <ul className="player-servers__list">
            {data.servers.map((entry) => (
              <li key={entry.key}>
                <a
                  href={withServer(dashboardHref('characters'), entry.key)}
                  aria-current={entry.key === server ? 'true' : undefined}
                >
                  <strong>{entry.label}</strong>
                  <span>{entry.characterCount} character{entry.characterCount === 1 ? '' : 's'} · last seen {relativeTime(entry.lastSeenAt)}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="player-help-link">
            <a href={dashboardHref('sync', server)}>Devices &amp; sync</a> · <a href="/download">Setup help</a>
          </p>
        </aside>
      </div>
    </>
  )
}
