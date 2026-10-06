import { useEffect, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import Modal from '../Modal/Modal.jsx'
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
  'Character identity, level, class, spec, gear, and supported professions',
  'Supported quest, inventory, and guild activity used by Holdfast features',
  'Local addon data read from WoW SavedVariables',
]

const authorityFacts = [
  'Your Battle.net or WoW password',
  'Authority to change rank, permissions, Rep, or Marks',
  'Automated protected in-game guild actions',
]

const trustCards = [
  {
    id: 'source',
    eyebrow: 'Open source',
    title: 'Inspect everything.',
    body: 'Website, bridge, and addon are all public.',
    mark: '⌘',
  },
  {
    id: 'privacy',
    eyebrow: 'Data boundary',
    title: 'Game facts only.',
    body: 'No Battle.net credentials. Holdfast keeps authority.',
    mark: '◇',
  },
  {
    id: 'architecture',
    eyebrow: 'Architecture',
    title: 'No black box.',
    body: 'See exactly how data moves from WoW to Holdfast.',
    mark: '↕',
  },
  {
    id: 'verification',
    eyebrow: 'Verification',
    title: 'Trust, but verify.',
    body: 'Public builds, releases, and SHA-256 checksums.',
    mark: '✓',
  },
]

export default function Guildweaver() {
  const [release, setRelease] = useState(fallbackRelease)
  const [activeModal, setActiveModal] = useState(null)

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
      eyebrow="Holdfast companion"
      title="Guildweaver"
      intro="Install once. Guildweaver connects World of Warcraft to Holdfast, keeps the addon current, and quietly handles supported sync in the background."
      centered
      className="guildweaver-page"
    >
      <section className="guildweaver-hero-card">
        <div className="guildweaver-product-mark" aria-hidden="true">♜</div>

        <div className="guildweaver-release-line" aria-label="Guildweaver release status">
          <span className="guildweaver-release-badge">{release.channelLabel}</span>
          <span className="guildweaver-release-platforms">Windows · macOS · Linux</span>
        </div>

        <GuildweaverDownload />

        <div className="guildweaver-hero-trust">
          <span>Open source</span>
          <span>SHA-256 verified</span>
          <span>No Battle.net credentials</span>
        </div>

        <button
          className="guildweaver-text-button"
          type="button"
          onClick={() => setActiveModal('verification')}
        >
          Currently unsigned alpha software · learn what that means
        </button>
      </section>

      <section className="guildweaver-section guildweaver-how">
        <div className="guildweaver-section__heading">
          <p>How it works</p>
          <h2>Three steps. Then forget about it.</h2>
        </div>

        <ol className="guildweaver-steps">
          <li>
            <strong>Install the Bridge</strong>
            <span>Download the build for this computer and run the included installer.</span>
          </li>
          <li>
            <strong>Pair with Holdfast</strong>
            <span>Approve the device in your browser. Guildweaver finds WoW and installs the addon.</span>
          </li>
          <li>
            <strong>Play normally</strong>
            <span>The bridge and addon maintain themselves and sync supported data as you play.</span>
          </li>
        </ol>
      </section>

      <section className="guildweaver-section guildweaver-trust-section">
        <div className="guildweaver-section__heading">
          <p>Built in the open</p>
          <h2>Nothing important is hidden.</h2>
        </div>

        <div className="guildweaver-trust-grid">
          {trustCards.map((card) => (
            <button
              className="guildweaver-trust-card"
              type="button"
              key={card.id}
              onClick={() => setActiveModal(card.id)}
            >
              <span className="guildweaver-trust-card__mark" aria-hidden="true">{card.mark}</span>
              <span className="guildweaver-trust-card__eyebrow">{card.eyebrow}</span>
              <strong>{card.title}</strong>
              <span>{card.body}</span>
              <small>Explore →</small>
            </button>
          ))}
        </div>
      </section>

      <nav className="guildweaver-footer-links" aria-label="Guildweaver resources">
        <a href={release.releasePage} target="_blank" rel="noreferrer">Current release ↗</a>
        <a href={release.reportIssue} target="_blank" rel="noreferrer">Report a bug ↗</a>
        <a href="/privacy">Holdfast privacy</a>
      </nav>

      {activeModal === 'source' ? (
        <Modal
          eyebrow="Open source"
          title="Inspect the whole stack."
          intro="Every Holdfast-owned piece of Guildweaver is public. Browse the code, history, issues, and build configuration yourself."
          size="wide"
          onClose={() => setActiveModal(null)}
        >
          <div className="guildweaver-modal-repositories">
            {guildweaverRepositories.map((repository) => (
              <a href={repository.href} key={repository.href} target="_blank" rel="noreferrer">
                <strong>{repository.name}</strong>
                <span>{repository.description}</span>
                <small>View on GitHub ↗</small>
              </a>
            ))}
          </div>
        </Modal>
      ) : null}

      {activeModal === 'privacy' ? (
        <Modal
          eyebrow="Data boundary"
          title="Game facts, not credentials."
          intro="WoW owns observed character data. Holdfast owns guild authority. Guildweaver connects the two without becoming either one."
          size="wide"
          onClose={() => setActiveModal(null)}
        >
          <div className="guildweaver-modal-columns">
            <section>
              <p>Can sync</p>
              <ul>
                {syncFacts.map((fact) => <li key={fact}>{fact}</li>)}
              </ul>
            </section>
            <section>
              <p>Never receives authority over</p>
              <ul>
                {authorityFacts.map((fact) => <li key={fact}>{fact}</li>)}
              </ul>
            </section>
          </div>
          <a className="guildweaver-modal-link" href="/privacy">Read Holdfast privacy policy →</a>
        </Modal>
      ) : null}

      {activeModal === 'architecture' ? (
        <Modal
          eyebrow="Architecture"
          title="No black box."
          intro="The addon observes WoW. The local bridge moves supported data over HTTPS. Holdfast remains authoritative for guild-owned state."
          size="wide"
          onClose={() => setActiveModal(null)}
        >
          <div className="guildweaver-architecture__diagram" aria-label="Guildweaver data flow">
            <span>World of Warcraft</span>
            <b>↓ SavedVariables</b>
            <span>Guildweaver Addon</span>
            <b>↓ Local files</b>
            <span>Guildweaver Bridge</span>
            <b>↓ HTTPS</b>
            <span>Holdfast</span>
            <b>↕</b>
            <span>Discord</span>
          </div>
        </Modal>
      ) : null}

      {activeModal === 'verification' ? (
        <Modal
          eyebrow="Verification"
          title="Trust, but verify."
          intro="Guildweaver is early software. We would rather show you exactly how it is built than ask you to blindly trust a binary."
          size="wide"
          onClose={() => setActiveModal(null)}
        >
          <div className="guildweaver-verification-modal">
            <aside>
              <strong>Unsigned alpha</strong>
              <span>Desktop packages are not yet Windows code-signed or Apple-notarized. Your operating system may warn you before first launch.</span>
            </aside>
            <div className="guildweaver-verification-links">
              <a href={release.releasePage} target="_blank" rel="noreferrer">Current release <span>↗</span></a>
              <a href={release.buildPipeline} target="_blank" rel="noreferrer">Public build pipeline <span>↗</span></a>
              <a href="https://github.com/Indicaza/guildweaver-bridge/blob/main/README.md" target="_blank" rel="noreferrer">Installation notes <span>↗</span></a>
              <a href={release.reportIssue} target="_blank" rel="noreferrer">Report a bug <span>↗</span></a>
            </div>
            <p>Every platform download publishes a matching SHA-256 checksum beside the release asset.</p>
          </div>
        </Modal>
      ) : null}
    </PageShell>
  )
}
