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
        <p className="guildweaver-download__eyebrow">Recommended download</p>
        <h2 id="guildweaver-download-title">
          {recommended ? platformLabel(recommended) : 'Choose your platform'}
        </h2>
        <p>
          {detectedOs === 'macos'
            ? 'Apple Silicon is the default for modern Macs. If your Mac has an Intel processor, choose the Intel build below.'
            : recommended
              ? 'We detected your operating system. You can choose a different build below.'
              : 'We could not confidently detect your operating system. Pick the build that matches this computer.'}
        </p>
      </div>

      {recommended ? (
        <div className="guildweaver-download__recommended">
          <a className="guildweaver-download__primary" href={recommended.href}>
            Download for {recommended.label}
          </a>
          <a className="guildweaver-download__checksum" href={recommended.checksumHref}>
            SHA-256 checksum
          </a>
        </div>
      ) : null}

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
    </section>
  )
}
