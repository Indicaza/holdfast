import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectGuildweaverOs,
  guildweaverDownloads,
  guildweaverDownloadsForOs,
  guildweaverRepositories,
  recommendedGuildweaverDownload,
} from '../src/Guildweaver/downloads.js'

test('Guildweaver detects broad operating-system families', () => {
  assert.equal(detectGuildweaverOs({ platform: 'Win32' }), 'windows')
  assert.equal(detectGuildweaverOs({ userAgentData: { platform: 'macOS' } }), 'macos')
  assert.equal(detectGuildweaverOs({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux')
  assert.equal(detectGuildweaverOs({ userAgent: 'Something Unknown' }), 'unknown')
})

test('Windows and macOS resolve to one native installer each', () => {
  assert.equal(recommendedGuildweaverDownload({ platform: 'Win32' })?.id, 'windows')
  assert.equal(recommendedGuildweaverDownload({ platform: 'MacIntel' })?.id, 'macos')
  assert.equal(recommendedGuildweaverDownload({ userAgentData: { platform: 'macOS' } })?.id, 'macos')
  assert.equal(recommendedGuildweaverDownload({ platform: 'Linux x86_64' })?.id, 'linux-x64')
  assert.equal(recommendedGuildweaverDownload({ platform: 'Unknown' }), null)

  assert.deepEqual(
    guildweaverDownloadsForOs('macos').map((download) => download.id),
    ['macos'],
  )
  assert.deepEqual(
    guildweaverDownloadsForOs('linux').map((download) => download.id),
    ['linux-x64', 'linux-arm64'],
  )
})

test('every public Guildweaver download exposes stable Holdfast routes', () => {
  assert.equal(guildweaverDownloads.length, 4)
  for (const download of guildweaverDownloads) {
    assert.equal(download.href, `/guildweaver/download/${download.id}`)
    assert.equal(download.checksumHref, `/guildweaver/download/${download.id}/sha256`)
  }
})

test('transparency links expose all three Holdfast-owned repositories', () => {
  assert.deepEqual(
    guildweaverRepositories.map((repository) => repository.href),
    [
      'https://github.com/Indicaza/holdfast',
      'https://github.com/Indicaza/guildweaver-bridge',
      'https://github.com/Indicaza/guildweaver',
    ],
  )
})
