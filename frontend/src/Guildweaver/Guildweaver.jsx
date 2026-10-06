import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import PageShell from '../PageShell/PageShell.jsx'
import GuildweaverDownload from './GuildweaverDownload.jsx'
import { guildweaverRepositories } from './downloads.js'
import './Guildweaver.css'

const fallbackRelease = {
  channel: 'edge',
  channelLabel: 'Alpha / Edge',
  releasePage: 'https://github.com/Indicaza/guildweaver-bridge/releases/tag/edge',
  buildPipeline: 'https://github.com/Indicaza/guildweaver-bridge/actions/workflows/release.yml',
  reportIssue: 'https://github.com/Indicaza/guildweaver-bridge/issues/new/choose',
}

const syncFacts = [
  'Character name, race, class, level, spec, gear, and supported professions',
  'Supported quest, inventory, and guild activity needed by Holdfast features',
  'Local addon data through WoW SavedVariables — never your Battle.net password',
]

const authorityFacts = [
  'Cannot change Holdfast rank, permissions, Rep, or Marks',
  'Cannot log in to Battle.net or access your WoW password',
  'Does not automate protected in-game guild authority actions',
]

export default function Guildweaver() {
  const [release, setRelease] = useState(fallbackRelease)

  useEffect(() => {
    let active = true

    apiJson('/api/guildweaver/release')
      .then((metadata) => {
        if (active && metadata?.channel && metadata?.releasePage) {
          setRelease({ ...fallbackRelease, ...metadata })
        }
      })
      .catch(() => {
        // The public GitHub edge channel remains a safe fallback.
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <PageShell
      eyebrow="Guildweaver · Open source"
      title="Connect Holdfast to World of Warcraft."
      intro="Guildweaver is Holdfast's open-source WoW addon and local companion bridge. Download the bridge once; it installs and maintains the addon, then securely pairs this computer with your Holdfast account."
      className="guildweaver-page"
    >
      <section className="guildweaver-hero-card">
        <div className="guildweaver-release-line">
          <span className="guildweaver-release-badge">{release.channelLabel}</span>
          <span>Windows · macOS · Linux</span>
        </div>

        <GuildweaverDownload />

        <aside className="guildweaver-alpha-note">
          <strong>Transparent alpha software.</strong>
          <span>
            Guildweaver is still early and the desktop packages are not yet code-signed or Apple-notarized. The source, build pipeline, release artifacts, and SHA-256 checksums are public so you can inspect exactly what you are installing.
          </span>
        </aside>
      </section>

      <section className="guildweaver-section">
        <div className="guildweaver-section__heading">
          <p>How it works</p>
          <h2>One install. Then get back to the game.</h2>
        </div>
        <ol className="guildweaver-steps">
          <li>
            <strong>Download the Bridge.</strong>
            <span>Choose the package for this computer and run the included installer.</span>
          </li>
          <li>
            <strong>Guildweaver finds WoW.</strong>
            <span>The Bridge installs and keeps the Guildweaver addon up to date for you.</span>
          </li>
          <li>
            <strong>Connect Holdfast.</strong>
            <span>The Bridge opens a Holdfast pairing page so you can approve this device with your Discord identity.</span>
          </li>
          <li>
            <strong>Play normally.</strong>
            <span>Supported character and guild data can sync without manual exports or addon-copying chores.</span>
          </li>
        </ol>
      </section>

      <section className="guildweaver-section guildweaver-boundaries">
        <div className="guildweaver-boundary-card">
          <p className="guildweaver-section-kicker">What it can sync</p>
          <h2>Game facts, not credentials.</h2>
          <ul>
            {syncFacts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </div>
        <div className="guildweaver-boundary-card">
          <p className="guildweaver-section-kicker">What it cannot do</p>
          <h2>Holdfast stays authoritative.</h2>
          <ul>
            {authorityFacts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </div>
      </section>

      <section className="guildweaver-section">
        <div className="guildweaver-section__heading">
          <p>Open source</p>
          <h2>Inspect the whole stack.</h2>
          <span>Every Holdfast-owned piece of the Guildweaver path is public. There is no mystery binary sitting between the addon and the website.</span>
        </div>
        <div className="guildweaver-repositories">
          {guildweaverRepositories.map((repository) => (
            <a
              className="guildweaver-repository"
              href={repository.href}
              key={repository.href}
              target="_blank"
              rel="noreferrer"
            >
              <span className="guildweaver-repository__mark" aria-hidden="true">↗</span>
              <strong>{repository.name}</strong>
              <span>{repository.description}</span>
              <small>View source on GitHub</small>
            </a>
          ))}
        </div>
      </section>

      <section className="guildweaver-section guildweaver-architecture">
        <div className="guildweaver-section__heading">
          <p>Architecture</p>
          <h2>No black box.</h2>
        </div>
        <div className="guildweaver-architecture__diagram" aria-label="Guildweaver data flow">
          <span>World of Warcraft</span>
          <b>↕ SavedVariables</b>
          <span>Guildweaver Addon</span>
          <b>↕ Local files</b>
          <span>Guildweaver Bridge</span>
          <b>↕ HTTPS</b>
          <span>Holdfast</span>
          <b>↕</b>
          <span>Discord</span>
        </div>
      </section>

      <section className="guildweaver-section guildweaver-verification">
        <div>
          <p className="guildweaver-section-kicker">Verify the software</p>
          <h2>Trust, but verify.</h2>
          <p>
            Every platform download publishes a SHA-256 checksum beside it. Releases are assembled by the public GitHub Actions pipeline from the public Bridge repository.
          </p>
        </div>
        <div className="guildweaver-verification__links">
          <a href={release.releasePage} target="_blank" rel="noreferrer">Current release</a>
          <a href={release.buildPipeline} target="_blank" rel="noreferrer">Public build pipeline</a>
          <a href="https://github.com/Indicaza/guildweaver-bridge/blob/main/README.md" target="_blank" rel="noreferrer">Installation notes</a>
          <a href={release.reportIssue} target="_blank" rel="noreferrer">Report a bug</a>
          <a href="/privacy">Holdfast privacy</a>
        </div>
      </section>
    </PageShell>
  )
}
