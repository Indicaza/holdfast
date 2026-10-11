// UI-Character-Info-<Class>-BG: the stat pane's class crest background.
const CLASS_ART = new Set(['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'])

export function statsArt(className) {
  const key = String(className || '').toLowerCase().replace(/[^a-z]/g, '')
  return `url("/armory-art/stats-${CLASS_ART.has(key) ? key : 'default'}.webp")`
}

// Race backdrops behind the character (DressUpBackground-<Race> in game).
const RACE_SCENES = {
  human: 'human', dwarf: 'dwarf', 'night elf': 'nightelf', nightelf: 'nightelf', gnome: 'gnome',
  orc: 'orc', undead: 'scourge', scourge: 'scourge', tauren: 'tauren', troll: 'troll',
}

export function raceScene(race) {
  const key = RACE_SCENES[String(race || '').trim().toLowerCase()]
  return key ? `/armory-art/race-${key}.webp` : null
}
