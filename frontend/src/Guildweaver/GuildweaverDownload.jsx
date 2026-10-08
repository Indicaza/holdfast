import { useState } from 'react'

import {
  detectGuildweaverOs,
  guildweaverDownloads,
  recommendedGuildweaverDownload,
} from './downloads.js'
import './GuildweaverDownload.css'

export default function GuildweaverDownload({
  compact = false,
  showLead = true,
  navigatorLike = globalThis.navigator,
}) {
  const [showAllDownloads, setShowAllDownloads] = useState(false)
  const [downloadStarted, setDownloadStarted] = useState(false)
  const detectedOs = detectGuildweaverOs(navigatorLike)
  const recommended = recommendedGuildweaverDownload(navigatorLike)
  const nativeInstaller = detectedOs === 'windows' || detectedOs === 'macos'

  function beginDownload() {
    setDownloadStarted(true)
  }

  if (compact) {
    return (
      <div className="guildweaver-download guildweaver-download--compact">
        <a
          className="guildweaver-download__primary"
          href={recommended?.href || '/guildweaver'}
          onClick={recommended ? beginDownload : undefined}
        >
          {nativeInstaller ? 'Install Guildweaver' : recommended ? 'Download Guildweaver' : 'Get Guildweaver'}
        </a>
        <span className="guildweaver-download__detail">
          {nativeInstaller
            ? 'Open the installer after it downloads. Guildweaver handles the rest.'
            : 'Windows and macOS have one-click installers.'}
        </span>
      </div>
    )
  }

  return (
    <section className="guildweaver-download" aria-labelledby={showLead ? 'guildweaver-download-title' : undefined}>
      {showLead ? (
        <div className="guildweaver-download__lead">
          <h2 id="guildweaver-download-title">
            {nativeInstaller ? 'Install Guildweaver' : recommended ? `Guildweaver for ${recommended.label}` : 'Get Guildweaver'}
          </h2>
          <p>
            {nativeInstaller
              ? 'One installer sets up Guildweaver, finds WoW, installs the addon, and keeps everything updated.'
              : detectedOs === 'linux'
                ? 'Linux is still a manual package for now. Windows and macOS use one-click installers.'
                : 'Choose the platform for this computer.'}
          </p>
        </div>
      ) : null}

      <div className="guildweaver-download__actions">
        {recommended ? (
          <a className="guildweaver-download__primary" href={recommended.href} onClick={beginDownload}>
            {nativeInstaller ? 'Install Guildweaver' : `Download for ${recommended.label}`}
          </a>
        ) : null}
        <button
          className="guildweaver-download__secondary"
          type="button"
          aria-expanded={showAllDownloads}
          onClick={() => setShowAllDownloads((current) => !current)}
        >
          {showAllDownloads ? 'Hide platforms' : 'Other platforms'}
        </button>
      </div>

      {nativeInstaller ? (
        <p className="guildweaver-download__next-step">
          {downloadStarted
            ? 'Download started. Open the installer when your browser finishes — Guildweaver does everything else.'
            : 'After it downloads, open the installer. That is the only manual step.'}
        </p>
      ) : null}

      {showAllDownloads ? (
        <div className="guildweaver-download__platforms" aria-label="All Guildweaver downloads">
          {guildweaverDownloads.map((download) => (
            <div className="guildweaver-download__platform" key={download.id}>
              <div>
                <strong>{download.label}</strong>
                <span>{download.detail}</span>
              </div>
              <div className="guildweaver-download__platform-actions">
                <a href={download.href} onClick={beginDownload}>
                  {download.os === 'windows' || download.os === 'macos' ? 'Installer' : 'Download'}
                </a>
                <a href={download.checksumHref}>Checksum</a>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
