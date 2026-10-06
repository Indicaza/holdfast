import { expect, test } from '@playwright/test'
import { authenticate } from '../helpers/auth.js'

async function seedArmory(page, context) {
  await authenticate(context, 'member')
  await page.goto('/')

  return page.evaluate(async () => {
    async function json(url, options = {}) {
      const { headers = {}, ...requestOptions } = options
      const response = await fetch(url, {
        ...requestOptions,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      })
      const body = await response.json()
      if (!response.ok) throw new Error(`${url}: ${response.status} ${JSON.stringify(body)}`)
      return body
    }

    const pairing = await json('/api/bridge/pairing/start', {
      method: 'POST',
      body: JSON.stringify({ deviceName: 'Armory E2E' }),
    })

    await json('/api/bridge/pairing/approve', {
      method: 'POST',
      body: JSON.stringify({ userCode: pairing.userCode }),
    })

    const token = await json('/api/bridge/pairing/token', {
      method: 'POST',
      body: JSON.stringify({ deviceCode: pairing.deviceCode }),
    })

    const snapshot = {
      schemaVersion: 2,
      capturedAt: Math.floor(Date.now() / 1000),
      reason: 'PLAYER_EQUIPMENT_CHANGED',
      addonVersion: '0.5.0-alpha.1',
      characterKey: 'classic beta pve 2:armorytest',
      characterId: 'character-e2e-armory',
      name: 'Armorytest',
      realm: 'Classic Beta PvE 2',
      region: 'US',
      level: 30,
      sex: 2,
      bodyType: 'male',
      race: { id: 4, name: 'Night Elf', file: 'NightElf' },
      class: { id: 1, name: 'Warrior', file: 'WARRIOR' },
      specialization: { index: 1, id: 73, name: 'Protection', icon: 132341, role: 'TANK' },
      guild: { name: 'Holdfast', rankName: 'Member', rankIndex: 5, realm: 'Classic Beta PvE 2' },
      gameBuild: { version: '1.60.1', build: '60001', buildDate: 'Oct 5 2026', interface: 16001 },
      equipment: [
        {
          slot: 'HeadSlot',
          slotId: 1,
          itemId: 11746,
          itemLink: '|cff0070dd|Hitem:11746:17:0:0:0:0:0:0:30:::::::|h[Golem Skull Helm]|h|r',
          itemString: 'item:11746:17:0:0:0:0:0:0:30:::::::',
          name: 'Golem Skull Helm',
          quality: 3,
          itemLevel: 35,
          icon: 132767,
          enchantId: 17,
          gemIds: [],
          bonusIds: [],
          modifierData: [11746, 17, 0, 0, 0, 0, 0, 0, 30],
        },
        {
          slot: 'MainHandSlot',
          slotId: 16,
          itemId: 6975,
          itemLink: '|cff0070dd|Hitem:6975::::::::30:::::::|h[Whirlwind Axe]|h|r',
          itemString: 'item:6975::::::::30:::::::',
          name: 'Whirlwind Axe',
          quality: 3,
          itemLevel: 40,
          icon: 132402,
          enchantId: 0,
          gemIds: [],
          bonusIds: [],
          modifierData: [6975, 0, 0, 0, 0, 0, 0, 0, 30],
        },
      ],
      talents: {
        api: 'traits',
        kind: 'combat',
        configId: 901,
        name: 'Protection',
        treeIds: [73],
        pointsSpent: 2,
        pointsAvailable: 1,
        trees: [
          {
            id: 73,
            rootNodeId: 101,
            nodes: [
              {
                id: 101,
                position: { x: 0, y: 0 },
                activeRank: 1,
                currentRank: 1,
                ranksPurchased: 1,
                maxRanks: 1,
                isAvailable: true,
                isVisible: true,
                meetsEdgeRequirements: true,
                conditionIds: [],
                entries: [
                  {
                    id: 1001,
                    definitionId: 2001,
                    spellId: 12975,
                    icon: 135871,
                    name: 'Last Stand',
                    description: 'Temporarily increases maximum health.',
                    selected: true,
                    rank: 1,
                    maxRanks: 1,
                    isAvailable: true,
                  },
                ],
              },
              {
                id: 102,
                position: { x: 1, y: 1 },
                activeRank: 0,
                currentRank: 0,
                ranksPurchased: 0,
                maxRanks: 3,
                isAvailable: true,
                isVisible: true,
                meetsEdgeRequirements: true,
                conditionIds: [],
                entries: [
                  {
                    id: 1002,
                    definitionId: 2002,
                    spellId: 12328,
                    icon: 134951,
                    name: 'Shield Mastery',
                    description: 'Improves your shield work.',
                    selected: false,
                    rank: 0,
                    maxRanks: 3,
                    isAvailable: true,
                  },
                ],
              },
            ],
            edges: [{ sourceNodeId: 101, targetNodeId: 102, type: 1, isActive: true }],
          },
        ],
      },
      professions: [
        {
          id: 164,
          name: 'Blacksmithing',
          kind: 'primary',
          icon: 136241,
          skillLevel: 225,
          maxSkillLevel: 225,
          skillLineId: 164,
          skillModifier: 5,
          skillLineName: 'Blacksmithing',
          specialization: { configId: 81001, name: 'Weaponsmith', treeIds: [82001] },
          recipes: [
            {
              id: 9789,
              name: 'Mithril Spurs',
              known: true,
              icon: 132307,
              professionId: 164,
              professionName: 'Blacksmithing',
              craftedItemId: 7969,
              craftedItemLink: '|cffffffff|Hitem:7969::::::::30:::::::|h[Mithril Spurs]|h|r',
              reagents: [
                {
                  slotIndex: 1,
                  quantityRequired: 4,
                  required: true,
                  reagents: [{ itemId: 3860, quantityRequired: 4 }],
                },
              ],
            },
          ],
        },
      ],
    }

    return json('/api/bridge/characters/snapshot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.deviceToken}` },
      body: JSON.stringify({ revision: 8, snapshot }),
    })
  })
}

test('member Armory renders equipment, talent tree, professions, recipes, and narrow screens', async ({ page, context }) => {
  const seeded = await seedArmory(page, context)
  const characterId = seeded.character.id

  await page.goto(`/armory/${encodeURIComponent(characterId)}`)
  await expect(page.getByRole('heading', { name: 'Armorytest', level: 1 })).toBeVisible()
  await expect(page.getByText('Level 30')).toBeVisible()
  await expect(page.getByText('Protection', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Holdfast', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Equipment' }).click()
  await expect(page.getByText('Golem Skull Helm', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('ilvl 35')).toBeVisible()
  await page.getByTitle('Golem Skull Helm').click()
  await expect(page.getByText('Enchant')).toBeVisible()
  await expect(page.getByText('17', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Talents' }).click()
  await expect(page.locator('.talent-node')).toHaveCount(2)
  await expect(page.locator('.talent-tree__edges line')).toHaveCount(1)
  await expect(page.getByText('Last Stand', { exact: true })).toBeVisible()
  await page.locator('.talent-node').nth(1).click()
  await expect(page.getByText('Shield Mastery', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Professions' }).click()
  await expect(page.getByRole('heading', { name: 'Blacksmithing' })).toBeVisible()
  await expect(page.getByText('225 / 225')).toBeVisible()

  await page.getByRole('button', { name: 'Recipes' }).click()
  await expect(page.getByText('Mithril Spurs', { exact: true }).first()).toBeVisible()
  await page.getByPlaceholder('Thorium, potion, recipe ID…').fill('nothing-here')
  await expect(page.getByRole('heading', { name: 'No recipes match.' })).toBeVisible()

  await page.setViewportSize({ width: 320, height: 700 })
  await page.getByPlaceholder('Thorium, potion, recipe ID…').fill('')
  await page.getByRole('button', { name: 'Talents' }).click()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('guild intelligence discovers synced characters, tunes roster composition, and finds crafters', async ({ page, context }) => {
  await seedArmory(page, context)
  await page.goto('/intelligence')

  await expect(page.getByRole('heading', { name: 'The living armory.' })).toBeVisible()
  await expect(page.getByText('Fresh in 24h', { exact: true })).toBeVisible()
  await expect(page.getByText('Armorytest', { exact: true }).first()).toBeVisible()

  const composition = page.locator('.roster-composition')
  await expect(composition.getByRole('heading', { name: 'See what the guild can field.' })).toBeVisible()
  await expect(composition.getByRole('button', { name: 'Classes' })).toHaveAttribute('aria-pressed', 'true')
  await expect(composition.getByText('Warrior', { exact: true })).toBeVisible()

  await composition.getByRole('button', { name: 'Professions' }).click()
  await expect(composition.getByRole('button', { name: 'Professions' })).toHaveAttribute('aria-pressed', 'true')
  await expect(composition.getByText('Blacksmithing', { exact: true })).toBeVisible()
  await composition.getByLabel('Slice detail').selectOption('5')
  await expect(composition.getByLabel('Slice detail')).toHaveValue('5')

  const craftSearch = page.getByPlaceholder('Mithril Spurs, potion, item ID…')
  await craftSearch.fill('spurs')
  await expect(page.locator('.craft-result').getByText('Mithril Spurs', { exact: true })).toBeVisible()
  await expect(page.getByText('Blacksmithing 225/225')).toBeVisible()
  await expect(page.locator('.craft-result__crafters').getByText('Armorytest', { exact: true })).toBeVisible()
})

test('guild intelligence remains member-gated', async ({ page }) => {
  await page.goto('/intelligence')
  await expect(page.getByRole('dialog')).toContainText('Member sign in')
  await expect(page.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
})
