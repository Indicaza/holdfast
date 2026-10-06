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
      schemaVersion: 1,
      capturedAt: Math.floor(Date.now() / 1000),
      guid: 'Player-E2E-ARMORY',
      characterKey: 'e2e:armory-test',
      name: 'Armorytest',
      realm: 'Classic Beta PvE 2',
      region: 'US',
      level: 30,
      race: { id: 4, name: 'Night Elf' },
      class: { id: 1, name: 'Warrior' },
      specialization: { id: 73, name: 'Protection' },
      guild: { id: 'holdfast', name: 'Holdfast' },
      gameBuild: 'Forever E2E',
      stats: { strength: 91, stamina: 104, armor: 1820 },
      equipment: [
        { slot: 'HEAD', itemID: 11746, name: 'Golem Skull Helm', quality: 3, itemLevel: 35, enchant: { name: '+8 Stamina' }, iconFileID: 132767 },
        { slot: 'MAINHAND', itemID: 6975, name: 'Whirlwind Axe', quality: 3, itemLevel: 40, iconFileID: 132402 },
      ],
      talents: {
        configID: 901,
        treeID: 73,
        specID: 73,
        name: 'Protection',
        nodes: [
          { nodeID: 101, x: 0, y: 0, selected: true, entries: [{ entryID: 1001, spellID: 12975, name: 'Last Stand', description: 'Temporarily increases maximum health.', iconFileID: 135871, selected: true, rank: 1, maxRank: 1 }] },
          { nodeID: 102, x: 1, y: 1, entries: [{ entryID: 1002, spellID: 12328, name: 'Shield Mastery', description: 'Improves your shield work.', iconFileID: 134951, selected: false, rank: 0, maxRank: 3 }] },
        ],
        edges: [{ from: 101, to: 102 }],
      },
      professions: [
        {
          professionID: 164,
          name: 'Blacksmithing',
          iconFileID: 136241,
          skillLevel: 225,
          maxSkillLevel: 225,
          recipes: [
            {
              recipeID: 9789,
              name: 'Mithril Spurs',
              known: true,
              iconFileID: 132307,
              requiredSkill: 215,
              craftedItemID: 7969,
              craftedItem: { id: 7969, name: 'Mithril Spurs' },
              reagents: [{ itemID: 3860, name: 'Mithril Bar', quantity: 4 }],
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
  await expect(page.getByText('+8 Stamina')).toBeVisible()

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

test('guild intelligence discovers synced characters and Craft Finder results', async ({ page, context }) => {
  await seedArmory(page, context)
  await page.goto('/intelligence')

  await expect(page.getByRole('heading', { name: 'The living armory.' })).toBeVisible()
  await expect(page.getByText('Armorytest', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Specs' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Professions' })).toBeVisible()

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
