import test from 'node:test'
import assert from 'node:assert/strict'

import {
  guildweaverDownloadUrl,
  guildweaverPackages,
  guildweaverReleaseMetadata,
} from '../src/Guildweaver/releaseConfig.js'

test('Guildweaver public downloads use native installers on Windows and macOS', () => {
  assert.equal(guildweaverPackages.windows.artifact, 'GuildweaverInstaller.exe')
  assert.equal(guildweaverPackages.macos.artifact, 'GuildweaverInstaller-macos.pkg')

  assert.equal(
    guildweaverDownloadUrl('windows', { env: { GUILDWEAVER_RELEASE_CHANNEL: 'edge' } }),
    'https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverInstaller.exe',
  )
  assert.equal(
    guildweaverDownloadUrl('macos', { env: { GUILDWEAVER_RELEASE_CHANNEL: 'edge' } }),
    'https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverInstaller-macos.pkg',
  )
})

test('Guildweaver metadata keeps manual platform packages available', () => {
  const metadata = guildweaverReleaseMetadata({ GUILDWEAVER_RELEASE_CHANNEL: 'edge' })

  assert.equal(metadata.packages.windows.download, '/guildweaver/download/windows')
  assert.equal(metadata.packages.macos.download, '/guildweaver/download/macos')
  assert.equal(metadata.packages['macos-x64'].download, '/guildweaver/download/macos-x64')
  assert.equal(metadata.packages['macos-arm64'].download, '/guildweaver/download/macos-arm64')
  assert.equal(metadata.packages['linux-x64'].download, '/guildweaver/download/linux-x64')
  assert.equal(metadata.packages['linux-arm64'].download, '/guildweaver/download/linux-arm64')
})

test('Guildweaver download URLs reject unknown platforms', () => {
  assert.equal(guildweaverDownloadUrl('plan9'), null)
})
