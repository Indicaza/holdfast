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

const detailItems = [
  {
    id: 'source',
    title: 'Open source',
    body: 'Browse the website, bridge, and addon repositories.',
  },
  {
    id: 'privacy',
    title: 'What gets synced',
    body: 'See the data boundary and what Guildweaver cannot access.',
  },
  {
    id: 'architecture',
    title: 'How it works',
    body: 'See the path from WoW to the bridge, Holdfast, and Discord.',
  },
  {
    id: 'verification',
    title: 'Verify the download',
    body: 'Release artifacts, public builds, checksums, and alpha status.',
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
      intro="Connect World of Warcraft to Holdfast. Install the bridge once, pair this computer, and Guildweaver keeps the addon and supported sync working for you."
      centered
      className="guildweaver-page"
    >
      <section className="guildweaver-download-panel">
        <p className="guildweaver-release-status">{release.channelLabel} release · Windows · macOS · Linux</p>
        <GuildweaverDownload />
        <button
          className="guildweaver-text-button"
          type="button"
          onClick={() => setActiveModal('verification')}
        >
          Guildweaver is currently unsigned alpha software
        </button>
      </section>

      <section className="guildweaver-section">
        <div className="guildweaver-section__heading">
          <p>What happens next</p>
          <h2>Install. Pair. Play.</h2>
        </div>

        <ol className="guildweaver-steps">
          <li>
            <span className="guildweaver-step-number">1</span>
            <div>
              <strong>Install the Bridge</strong>
              <span>Run the download. The bridge finds WoW and installs the addon.</span>
            </div>
          </li>
          <li>
            <span className="guildweaver-step-number">2</span>
            <div>
              <strong>Pair with Holdfast</strong>
              <span>Your browser opens once so you can approve this computer.</span>
            </div>
          </li>
          <li>
            <span className="guildweaver-step-number">3</span>
            <div>
              <strong>Play normally</strong>
              <span>Guildweaver maintains itself and syncs supported data in the background.</span>
            </div>
          </li>
        </ol>
      </section>

      <section className="guildweaver-section">
        <div className="guildweaver-section__heading">
          <p>Want more detail?</p>
          <h2>Everything is inspectable.</h2>
          <span>You do not need any of this to install Guildweaver. It is here if you want to look deeper.</span>
        </div>

        <div className="guildweaver-detail-list">
          {detailItems.map((item) => (
            <button type="button" key={item.id} onClick={() => setActiveModal(item.id)}>
              <span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </span>
              <b aria-hidden="true">→</b>
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
          intro="Every Holdfast-owned piece of Guildweaver is public."
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
          intro="WoW owns observed character data. Holdfast owns guild authority."
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
              <p>Cannot access or control</p>
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
          intro="The addon observes WoW. The bridge moves supported data over HTTPS. Holdfast remains authoritative for guild-owned state."
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
          intro="Guildweaver is early software. The source, build pipeline, releases, and checksums are public."
          size="wide"
          onClose={() => setActiveModal(null)}
        >
          <div className="guildweaver-verification-modal">
            <p>
              Desktop packages are not yet Windows code-signed or Apple-notarized, so your operating system may warn you before first launch.
            </p>
            <div className="guildweaver-verification-links">
              <a href={release.releasePage} target="_blank" rel="noreferrer">Current release <span>↗</span></a>
              <a href={release.buildPipeline} target="_blank" rel="noreferrer">Public build pipeline <span>↗</span></a>
              <a href="https://github.com/Indicaza/guildweaver-bridge/blob/main/README.md" target="_blank" rel="noreferrer">Installation notes <span>↗</span></a>
              <a href={release.reportIssue} target="_blank" rel="noreferrer">Report a bug <span>↗</span></a>
            </div>
            <p>Every platform download publishes a matching SHA-256 checksum.</p>
          </div>
        </Modal>
      ) : null}
    </PageShell>
  )
}
