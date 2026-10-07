import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveWowIconAsset,
  wowAssetDescriptor,
} from '../src/WowAssets/assetResolver.js'

test('WoW asset resolver uses Holdfast FileDataID media when no template is configured', () => {
  const previous = globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__
  delete globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__
  try {
    const descriptor = wowAssetDescriptor({ iconFileID: '132767', itemID: 11746 })
    assert.equal(descriptor.iconFileId, 132767)
    assert.equal(descriptor.itemId, 11746)
    assert.equal(descriptor.src, '/api/intelligence/media/icon/132767')
    assert.equal(resolveWowIconAsset({ itemId: 11746 }), null)
  } finally {
    if (previous === undefined) delete globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__
    else globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__ = previous
  }
})

test('WoW asset resolver centralizes configurable ID templates', () => {
  const previous = globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__
  globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__ = 'https://assets.example.test/icons/{iconFileID}?size={size}'
  try {
    assert.equal(
      resolveWowIconAsset({ iconFileId: 132767, size: 48 }),
      'https://assets.example.test/icons/132767?size=48',
    )
  } finally {
    if (previous === undefined) delete globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__
    else globalThis.__HOLDFAST_WOW_ASSET_TEMPLATE__ = previous
  }
})
