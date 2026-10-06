export const guildweaverDownloads = Object.freeze([
  Object.freeze({
    id: 'windows',
    os: 'windows',
    label: 'Windows',
    detail: '64-bit',
    href: '/guildweaver/download/windows',
    checksumHref: '/guildweaver/download/windows/sha256',
  }),
  Object.freeze({
    id: 'macos-arm64',
    os: 'macos',
    label: 'macOS',
    detail: 'Apple Silicon',
    href: '/guildweaver/download/macos-arm64',
    checksumHref: '/guildweaver/download/macos-arm64/sha256',
  }),
  Object.freeze({
    id: 'macos-x64',
    os: 'macos',
    label: 'macOS',
    detail: 'Intel',
    href: '/guildweaver/download/macos-x64',
    checksumHref: '/guildweaver/download/macos-x64/sha256',
  }),
  Object.freeze({
    id: 'linux-x64',
    os: 'linux',
    label: 'Linux',
    detail: 'x64',
    href: '/guildweaver/download/linux-x64',
    checksumHref: '/guildweaver/download/linux-x64/sha256',
  }),
  Object.freeze({
    id: 'linux-arm64',
    os: 'linux',
    label: 'Linux',
    detail: 'ARM64',
    href: '/guildweaver/download/linux-arm64',
    checksumHref: '/guildweaver/download/linux-arm64/sha256',
  }),
])

export const guildweaverRepositories = Object.freeze([
  Object.freeze({
    name: 'Holdfast Website',
    href: 'https://github.com/Indicaza/holdfast',
    description: 'The member site, guild systems, API, and Discord integration.',
  }),
  Object.freeze({
    name: 'Guildweaver Bridge',
    href: 'https://github.com/Indicaza/guildweaver-bridge',
    description: 'The local companion that links WoW data to Holdfast and maintains the addon.',
  }),
  Object.freeze({
    name: 'Guildweaver WoW Addon',
    href: 'https://github.com/Indicaza/guildweaver',
    description: 'The in-game addon that reads supported character and guild data.',
  }),
])

export function detectGuildweaverOs(navigatorLike = {}) {
  const platform = navigatorLike.userAgentData?.platform || navigatorLike.platform || ''
  const userAgent = navigatorLike.userAgent || ''
  const fingerprint = `${platform} ${userAgent}`.toLowerCase()

  if (fingerprint.includes('win')) return 'windows'
  if (fingerprint.includes('mac')) return 'macos'
  if (fingerprint.includes('linux') || fingerprint.includes('x11')) return 'linux'
  return 'unknown'
}

export function recommendedGuildweaverDownload(navigatorLike = {}) {
  const os = detectGuildweaverOs(navigatorLike)
  const preferredId =
    os === 'windows'
      ? 'windows'
      : os === 'macos'
        ? 'macos-arm64'
        : os === 'linux'
          ? 'linux-x64'
          : null

  return preferredId
    ? guildweaverDownloads.find((download) => download.id === preferredId) || null
    : null
}

export function guildweaverDownloadsForOs(os) {
  return guildweaverDownloads.filter((download) => download.os === os)
}
