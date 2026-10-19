import test from 'node:test'
import assert from 'node:assert/strict'

import { guildHeroActions, guildHomeContent } from '../src/Guild/guildHomeContent.js'
import { recruitmentFacts } from '../src/Home/recruitmentContent.js'

const ironVanguard = {
  slug: 'iron-vanguard',
  name: 'Iron Vanguard',
  tagline: 'Steel before glory.',
  faction: 'horde',
  region: 'EU',
  realm: 'Gehennas',
  realmType: 'pvp',
  playStyles: ['raiding', 'pvp', 'economy'],
  schedule: { raidDays: ['wed', 'sun'], raidStart: '20:00', raidEnd: '23:00' },
  timezone: 'Europe/Berlin',
  voiceRequired: true,
  recruiting: true,
  minimumLevel: 40,
}

test('Holdfast keeps its own slides, heading and recruitment copy', () => {
  const content = guildHomeContent('holdfast', { slug: 'holdfast', name: 'Holdfast', tagline: 'Anything' })
  assert.equal(content.slideSet, 'holdfast')
  assert.equal(content.name, 'Holdfast')
  assert.equal(content.motto, 'Servimus ut permaneat.')
  assert.equal(content.eyebrow, 'World of Warcraft · Forever · Alliance · PvP')
  assert.equal(content.snapshot.facts, recruitmentFacts)
})

test('other guilds show their own name, motto and faction over default slides', () => {
  const content = guildHomeContent('iron-vanguard', ironVanguard)
  assert.equal(content.slideSet, 'default')
  assert.equal(content.name, 'Iron Vanguard')
  assert.equal(content.motto, 'Steel before glory.')
  assert.equal(content.eyebrow, 'World of Warcraft · Gehennas · Horde · PvP')
  assert.equal(content.snapshot.eyebrow, 'Iron Vanguard at a glance')
  assert.deepEqual(content.snapshot.facts.map((fact) => fact.id), ['realm', 'schedule', 'styles', 'recruiting'])
  const [realm, schedule, styles, recruiting] = content.snapshot.facts
  assert.equal(realm.label, 'Europe')
  assert.equal(realm.value, 'Gehennas')
  assert.match(schedule.value, /Wed · Sun 8pm–11pm Berlin/)
  assert.equal(styles.value, 'Raiding & PvP')
  assert.equal(recruiting.value, 'Now recruiting')
  assert.match(recruiting.detail, /Level 40/)
})

test('a guild still loading is named from its slug and shows no borrowed Holdfast facts', () => {
  const content = guildHomeContent('iron-vanguard', null)
  assert.equal(content.name, 'Iron Vanguard')
  assert.deepEqual(content.snapshot.facts, [])
})

test('hero actions: Holdfast joins through Discord, other guilds through their listing', () => {
  assert.deepEqual(guildHeroActions({ slug: 'holdfast' }), {
    primary: { label: 'Join Holdfast', join: true },
    secondary: { label: 'Read the Charter', href: '/holdfast/charter' },
  })
  assert.equal(guildHeroActions({ slug: 'holdfast', authenticated: true }).primary.href, '/holdfast/quests')
  assert.deepEqual(guildHeroActions({ slug: 'iron-vanguard', guild: ironVanguard }).primary, { label: 'Apply to join', href: '/iron-vanguard/about?apply=1' })
  assert.deepEqual(guildHeroActions({ slug: 'iron-vanguard', guild: { ...ironVanguard, recruiting: false } }), {
    primary: { label: 'Guild profile', href: '/iron-vanguard/about' },
    secondary: { label: 'Find more guilds', href: '/' },
  })
  assert.equal(guildHeroActions({ slug: 'iron-vanguard', guild: ironVanguard, authenticated: true, memberSlug: 'iron-vanguard' }).primary.href, '/iron-vanguard/quests')
})
