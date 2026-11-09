import { useMemo } from 'react'

import PlayerCharacterCard from './PlayerCharacterCard.jsx'
import { dashboardHref, onServerKey, relativeTime, setupSteps, syncStatusCopy } from './playerModel.js'
import { EmptyState, Icon, Panel, Stat } from './ui.jsx'

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
      description="Guildweaver runs beside WoW on your computer. It installs the addon and uploads what the addon saves."
      actions={<span className="gw-tag">{done} of {steps.length} done</span>}
    >
      <ol className="gw-setup__steps">
        {steps.map((step, index) => (
          <li key={step.id} className={step.done ? 'is-done' : undefined}>
            <span className="gw-setup__marker" aria-hidden="true">{step.done ? '✓' : index + 1}</span>
            <div>
              <strong>{step.label}</strong>
              <span className="visually-hidden">{step.done ? ' (done)' : ' (to do)'}</span>
              {step.id === 'install' ? <p><a href={`${dashboardHref('sync')}#install`}>Download Guildweaver</a> for Windows, macOS or Linux and open the installer.</p> : null}
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

// Home: what Guildweaver has from you, in plain terms. When it last
// uploaded, from how many computers, and every character it has. The
// community's drop rates and map are one click away, not in the way.
export default function PlayerOverview({ data, server, onOpenCharacter }) {
  const characters = useMemo(() => (data.characters || []).filter((character) => onServerKey(character, server)), [data.characters, server])
  const sync = data.sync || {}
  const hasCharacters = Boolean(data.characters?.length)
  const lastSync = sync.lastUploadAt || sync.lastCharacterAt
  const computers = sync.connectedDevices || 0

  return (
    <div className="gw-stack">
      {hasCharacters ? <SyncCallout sync={sync} compact /> : <SetupChecklist sync={sync} />}

      <section className="gw-stats gw-stats--3" aria-label="Your summary">
        <Stat label="Last upload" icon="guildweaver" value={<span className="gw-stat__time">{relativeTime(lastSync)}</span>} foot={lastSync ? new Date(lastSync).toLocaleString() : 'Nothing received yet'} />
        <Stat label="Characters" icon="characters" value={characters.length} foot={server ? 'On this server' : `On ${data.servers?.length || 0} server${data.servers?.length === 1 ? '' : 's'}`} />
        <Stat label="Computers" icon="guildweaver" value={computers} foot={<a href={dashboardHref('sync', server)}>{computers ? 'Manage' : 'Install Guildweaver'}</a>} />
      </section>

      <Panel
        id="gw-your-characters"
        title="Your characters"
        description={hasCharacters ? 'Open one for its gear, talents, bags and professions.' : undefined}
      >
        {characters.length ? (
          <div className="gw-char-grid">
            {characters.map((character) => (
              <PlayerCharacterCard character={character} key={character.id} onOpen={onOpenCharacter} showServer={!server} />
            ))}
          </div>
        ) : (
          <EmptyState title="No characters yet." icon="characters">Log in with Guildweaver running, then <kbd>/reload</kbd>.</EmptyState>
        )}
      </Panel>

      <Panel id="gw-community" title="Community data" description="What every player's Guildweaver has recorded, pooled and anonymous.">
        <div className="gw-shortcuts">
          <a className="gw-shortcut" href={dashboardHref('farming', server)}>
            <Icon name="farming" />
            <span><strong>Drop rates</strong><small>What each herb, vein, pool and creature drops</small></span>
            <Icon name="chevron" size={14} />
          </a>
          <a className="gw-shortcut" href="/map">
            <Icon name="map" />
            <span><strong>Resource map</strong><small>Where people gather, on a map of Azeroth</small></span>
            <Icon name="chevron" size={14} />
          </a>
        </div>
      </Panel>
    </div>
  )
}
