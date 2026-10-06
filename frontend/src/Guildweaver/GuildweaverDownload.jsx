import { useState } from 'react'

import Modal from '../Modal/Modal.jsx'
import {
  detectGuildweaverOs,
  guildweaverDownloads,
  guildweaverDownloadsForOs,
  recommendedGuildweaverDownload,
} from './downloads.js'
import './GuildweaverDownload.css'

export default function GuildweaverDownload({ compact = false, navigatorLike = globalThis.navigator }) {
  const [showAllDownloads, setShowAllDownloads] = useState(false)
  const detectedOs = detectGuildweaverOs(navigatorLike)
  const recommended = recommendedGuildweaverDownload(navigatorLike)
  const macDownloads = guildweaverDownloadsForOs('macos')
  const intelMac = macDownloads.find((download) => download.id === 'macos-x64')
  const appleSiliconMac = macDownloads.find((download) => download.id === 'macos-arm64')
  const isMac = detectedOs === 'macos'

  if (compact) {
    if (isMac) {
      return (
        <div className="guildweaver-download guildweaver-download--compact">
          <a className="guildweaver-download__primary" href="/guildweaver">
            Choose Mac download
          </a>
          <span className="guildweaver-download__detail">Intel and Apple Silicon builds available</span>
        </div>
      )
    }

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
        <p className="guildweaver-download__eyebrow">Download</p>
        <h2 id="guildweaver-download-title">
          {isMac ? 'Choose your Mac' : recommended ? `Guildweaver for ${recommended.label}` : 'Choose your platform'}
        </h2>
        <p>
          {isMac
            ? 'Browsers cannot reliably tell Intel Macs from Apple Silicon. Pick the processor your Mac uses.'
            : recommended
              ? 'We detected your operating system. Download the bridge to get started.'
              : 'Pick the build that matches this computer.'}
        </p>
      </div>

      {isMac ? (
        <div className="guildweaver-download__mac-choices">
          <a className="guildweaver-download__choice" href={intelMac?.href || '/guildweaver'}>
            <strong>Intel Mac</strong>
            <span>Intel processor</span>
          </a>
          <a className="guildweaver-download__choice" href={appleSiliconMac?.href || '/guildweaver'}>
            <strong>Apple Silicon</strong>
            <span>M1, M2, M3, M4 or newer</span>
          </a>
        </div>
      ) : (
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
            {recommended ? 'Other platforms' : 'Choose platform'}
          </button>
        </div>
      )}

      {isMac ? (
        <p className="guildweaver-download__help">Not sure? Apple menu → About This Mac will show your processor.</p>
      ) : recommended ? (
        <a className="guildweaver-download__checksum" href={recommended.checksumHref}>
          SHA-256 checksum
        </a>
      ) : null}

      {isMac ? (
        <button
          className="guildweaver-download__plain-button"
          type="button"
          onClick={() => setShowAllDownloads(true)}
        >
          Windows or Linux downloads
        </button>
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
