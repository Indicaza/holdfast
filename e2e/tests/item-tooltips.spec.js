import { expect, test } from '@playwright/test'
import { seedArmory } from '../helpers/armory.js'

async function seedItemDefinitions(page) {
  await page.evaluate(async () => {
    async function json(url, options = {}) {
      const { headers = {}, ...requestOptions } = options
      const response = await fetch(url, {
        ...requestOptions,
        headers: { 'Content-Type': 'application/json', ...headers },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }

    const pairing = await json('/api/bridge/pairing/start', {
      method: 'POST',
      body: JSON.stringify({ deviceName: 'Item Tooltip E2E' }),
    })
    await json('/api/bridge/pairing/approve', {
      method: 'POST',
      body: JSON.stringify({ userCode: pairing.userCode }),
    })
    const token = await json('/api/bridge/pairing/token', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: pairing.deviceCode }),
    })

    const definitions = [
      {
        itemId: 11746,
        itemLink: '|cff0070dd|Hitem:11746:17:0:0:0:0:0:0:30:::::::|h[Golem Skull Helm]|h|r',
        name: 'Golem Skull Helm',
        qualityId: 3,
        itemLevel: 35,
        requiredLevel: 30,
        iconFileDataId: 132767,
        bindType: 2,
        equipLocation: 'INVTYPE_HEAD',
        sellPrice: 12345,
        itemClass: { id: 4, name: 'Armor' },
        itemSubclass: { id: 4, name: 'Plate' },
        stats: {
          ITEM_MOD_STRENGTH_SHORT: 13,
          ITEM_MOD_STAMINA_SHORT: 14,
        },
        tooltip: {
          source: 'GameTooltip',
          method: 'SetInventoryItem',
          rendered: true,
          complete: true,
          lines: [
            { left: 'Golem Skull Helm', leftColor: { r: 0, g: 0.44, b: 0.87 } },
            { left: 'Binds when equipped', leftColor: { r: 1, g: 1, b: 1 } },
            { left: 'Head', right: 'Plate', leftColor: { r: 1, g: 1, b: 1 }, rightColor: { r: 1, g: 1, b: 1 } },
            { left: '242 Armor', leftColor: { r: 1, g: 1, b: 1 } },
            { left: '+13 Strength', leftColor: { r: 1, g: 1, b: 1 } },
            { left: '+14 Stamina', leftColor: { r: 1, g: 1, b: 1 } },
            { blank: true },
            { left: 'Durability 80 / 80', leftColor: { r: 1, g: 1, b: 1 } },
            { left: 'Requires Level 30', leftColor: { r: 1, g: 1, b: 1 } },
            { left: 'Equip: Catalog-only text must not leak into the live slot tooltip.', leftColor: { r: 0, g: 1, b: 0 } },
          ],
        },
      },
      {
        itemId: 6975,
        itemLink: '|cff0070dd|Hitem:6975::::::::30:::::::|h[Whirlwind Axe]|h|r',
        name: 'Whirlwind Axe',
        qualityId: 3,
        itemLevel: 40,
        requiredLevel: 30,
        iconFileDataId: 132402,
        bindType: 1,
        equipLocation: 'INVTYPE_2HWEAPON',
        sellPrice: 8432,
        itemClass: { id: 2, name: 'Weapon' },
        itemSubclass: { id: 1, name: 'Two-Handed Axes' },
        stats: {
          ITEM_MOD_STRENGTH_SHORT: 15,
          ITEM_MOD_STAMINA_SHORT: 14,
        },
        tooltip: {
          source: 'GameTooltip',
          method: 'SetInventoryItem',
          rendered: true,
          complete: true,
          lines: [
            { left: 'Whirlwind Axe', leftColor: { r: 0, g: 0.44, b: 0.87 } },
            { left: 'Binds when picked up', leftColor: { r: 1, g: 1, b: 1 } },
            { left: 'Two-Hand', right: 'Axe', leftColor: { r: 1, g: 1, b: 1 }, rightColor: { r: 1, g: 1, b: 1 } },
            { left: '102 - 154 Damage', right: 'Speed 3.60', leftColor: { r: 1, g: 1, b: 1 }, rightColor: { r: 1, g: 1, b: 1 } },
            { left: '(35.6 damage per second)', leftColor: { r: 1, g: 1, b: 1 } },
            { left: '+15 Strength', leftColor: { r: 1, g: 1, b: 1 } },
            { left: '+14 Stamina', leftColor: { r: 1, g: 1, b: 1 } },
            { blank: true },
            { left: 'Durability 100 / 100', leftColor: { r: 1, g: 1, b: 1 } },
            { left: 'Requires Level 30', leftColor: { r: 1, g: 1, b: 1 } },
          ],
        },
      },
    ]

    for (const item of definitions) {
      const idempotencyKey = `item-tooltip-${item.itemId}-${Date.now()}`
      await json('/api/bridge/telemetry', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.deviceToken}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          streamKey: `item_definition:item:${item.itemId}`,
          kind: 'state',
          revision: 1,
          envelope: {
            schemaVersion: 1,
            eventType: 'item_definition',
            capturedAt: Math.floor(Date.now() / 1000),
            gameBuild: { version: '1.60.1', build: '70338', interface: 16001 },
            payloadSchemaVersion: 1,
            payload: {
              schemaVersion: 1,
              itemKey: `item:${item.itemId}`,
              item,
            },
          },
        }),
      })
    }
  })
}

test('Armory renders the full client-captured Blizzard equipment tooltip verbatim', async ({ page, context }) => {
  await seedArmory(page, context)
  await seedItemDefinitions(page)
  await page.goto('/intelligence#characters')

  const characterCard = page.locator('.character-card').filter({ hasText: 'Armorytest' })
  await expect(characterCard).toBeVisible()
  await characterCard.click()

  const profile = page.getByRole('dialog', { name: 'Armorytest' })
  await profile.getByRole('tab', { name: /^Equipment/ }).click()

  const helmSlot = profile.getByRole('button', { name: 'Head: Golem Skull Helm' })
  await helmSlot.hover()
  const helmTooltip = page.getByRole('tooltip').filter({ hasText: 'Golem Skull Helm' })
  await expect(helmTooltip).toBeVisible()
  await expect(helmTooltip).toContainText('Item Level 35')
  await expect(helmTooltip).toContainText('Binds when equipped')
  await expect(helmTooltip).toContainText('Head')
  await expect(helmTooltip).toContainText('Plate')
  await expect(helmTooltip).toContainText('242 Armor')
  await expect(helmTooltip).toContainText('+13 Strength')
  await expect(helmTooltip).toContainText('+14 Stamina')
  await expect(helmTooltip).toContainText('Durability 80 / 80')
  await expect(helmTooltip).toContainText('Requires Level 30')
  await expect(helmTooltip).toContainText('Sell Price:')
  await expect(helmTooltip).not.toContainText('Catalog-only text must not leak')
  await expect(helmTooltip).not.toContainText('Item #')
  await expect(helmTooltip).not.toContainText('Full Blizzard tooltip is still syncing')

  const axeSlot = profile.getByRole('button', { name: 'Main Hand: Whirlwind Axe' })
  await axeSlot.hover()
  const axeTooltip = page.getByRole('tooltip').filter({ hasText: 'Whirlwind Axe' })
  await expect(axeTooltip).toBeVisible()
  await expect(axeTooltip).toContainText('Item Level 40')
  await expect(axeTooltip).toContainText('Binds when picked up')
  await expect(axeTooltip).toContainText('Two-Hand')
  await expect(axeTooltip).toContainText('Axe')
  await expect(axeTooltip).toContainText('102 - 154 Damage')
  await expect(axeTooltip).toContainText('Speed 3.60')
  await expect(axeTooltip).toContainText('(35.6 damage per second)')
  await expect(axeTooltip).toContainText('+15 Strength')
  await expect(axeTooltip).toContainText('+14 Stamina')
  await expect(axeTooltip).toContainText('Durability 100 / 100')
  await expect(axeTooltip).toContainText('Requires Level 30')
  await expect(axeTooltip).toContainText('Sell Price:')
})
