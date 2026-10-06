import { useState } from 'react'

import Modal from '../Modal/Modal.jsx'
import {
  detectGuildweaverOs,
  guildweaverDownloads,
  recommendedGuildweaverDownload,
} from './downloads.js'
import './GuildweaverDownload.css'

function platformLabel(download) {
  return `${download.label} · ${download.detail}`
}

export default function GuildweaverDownload({ compact = false, navigatorLike = globalThis.navigator }) {
  const [showAllDownloads, setShowAllDownloads] = useState(false)
  const detectedOs = detectGuildweaverOs(navigatorLike)
  const recommended = recommendedGuildweaverDownload(navigatorLike)

  if (compact) {
    return (
      <div className="guildweaver-download guildweaver-download--compact">
        <a
          className="guildweaver-download__primary"
          href={recommended?.href || '/guildweaver'}
        >
          {recommended ? `Download for ${recommended.label}` : 'Choose a download'}
        </a>
        {recommended ? (
          <span className="guildweaver-download__detail">
            {recommended.detail} · other platforms available
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <section className="guildweaver-download" aria-labelledby="guildweaver-download-title">
      <div className="guildweaver-download__lead">
        <p className="guildweaver-download__eyebrow">Recommended for this computer</p>
        <h2 id="guildweaver-download-title">
          {recommended ? platformLabel(recommended) : 'Choose your platform'}
        </h2>
        <p>
          {detectedOs === 'macos'
            ? 'Apple Silicon is recommended for modern Macs. Intel builds are available under other downloads.'
            : recommended
              ? 'We detected your operating system. One download gets the bridge and addon setup started.'
              : 'We could not confidently detect your operating system. Choose your platform below.'}
        </p>
      </div>

      <div className="guildweaver-download__actions">
        {recommended ? (
          <a className="guildweaver-download__primary" href={recommended.href}>
            Download for {recommended.label}
          </a>
        ) : null}
        <button
          className="guildweaver-download__secondary"
          type="button"
          onClick={() => setShowAllDownloads(true)}
        >
          Other downloads
        </button>
      </div>

      {recommended ? (
        <a className="guildweaver-download__checksum" href={recommended.checksumHref}>
          Verify SHA-256 checksum
        </a>
      ) : null}

      {showAllDownloads ? (
        <Modal
          eyebrow="Downloads"
          title="Choose your platform."
          intro="Pick the build that matches this computer. Every package has a matching SHA-256 checksum."
          size="wide"
          onClose={() => setShowAllDownloads(false)}
        >
          <div className="guildweaver-download__platforms" aria-label="All Guildweaver downloads">
            {guildweaverDownloads.map((download) => (
              <div className="guildweaver-download__platform" key={download.id}>
                <div>
                  <strong>{download.label}</strong>
                  <span>{download.detail}</span>
                </div>
                <div className="guildweaver-download__platform-actions">
                  <a href={download.href}>Download</a>
                  <a href={download.checksumHref}>Checksum</a>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </section>
  )
}
