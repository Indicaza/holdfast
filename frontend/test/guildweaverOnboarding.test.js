import test from 'node:test'
import assert from 'node:assert/strict'

import { detectGuildweaverOs, recommendedGuildweaverDownload } from '../src/Guildweaver/downloads.js'

test('Guildweaver onboarding keeps native installers platform-aware', () => {
  assert.equal(detectGuildweaverOs({ platform: 'Win32' }), 'windows')
  assert.equal(recommendedGuildweaverDownload({ platform: 'Win32' })?.id, 'windows')
  assert.equal(detectGuildweaverOs({ platform: 'MacIntel' }), 'macos')
  assert.equal(recommendedGuildweaverDownload({ platform: 'MacIntel' })?.id, 'macos')
})
