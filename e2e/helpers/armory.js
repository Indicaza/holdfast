import { authenticate } from './auth.js'

// Pairs a device as the member persona and syncs one character (Armorytest)
// with equipment, talents, professions and recipes.
export async function seedArmory(page, context) {
  await authenticate(context, 'member')
  await page.goto('/holdfast')

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
          qualityId: 3,
          itemLevel: 35,
          requiredLevel: 30,
          icon: 132767,
          iconFileDataId: 132767,
          enchantId: 17,
          gemIds: [],
          bonusIds: [],
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
              { left: 'Item Level 35', leftColor: { r: 1, g: 0.82, b: 0 } },
              { left: 'Binds when equipped', leftColor: { r: 1, g: 1, b: 1 } },
              { left: 'Head', right: 'Plate', leftColor: { r: 1, g: 1, b: 1 }, rightColor: { r: 1, g: 1, b: 1 } },
              { left: '242 Armor', leftColor: { r: 1, g: 1, b: 1 } },
              { left: '+13 Strength', leftColor: { r: 1, g: 1, b: 1 } },
              { left: '+14 Stamina', leftColor: { r: 1, g: 1, b: 1 } },
              { blank: true },
              { left: 'Durability 80 / 80', leftColor: { r: 1, g: 1, b: 1 } },
              { left: 'Requires Level 30', leftColor: { r: 1, g: 1, b: 1 } },
            ],
          },
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
          qualityId: 3,
          itemLevel: 40,
          requiredLevel: 30,
          icon: 132402,
          iconFileDataId: 132402,
          enchantId: 0,
          gemIds: [],
          bonusIds: [],
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
              { left: 'Item Level 40', leftColor: { r: 1, g: 0.82, b: 0 } },
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
