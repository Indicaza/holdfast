// UI-Character-Info-<Class>-BG: the stat pane's class crest background.
const CLASS_ART = new Set(['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'])

export function statsArt(className) {
  const key = String(className || '').toLowerCase().replace(/[^a-z]/g, '')
  return `url("/armory-art/stats-${CLASS_ART.has(key) ? key : 'default'}.webp")`
}
