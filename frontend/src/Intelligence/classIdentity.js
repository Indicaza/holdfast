// In-game class colors, class icon FileDataIDs (Interface\Icons\ClassIcon_*),
// and each class's primary power (used when telemetry does not report one).

const CLASSES = {
  WARRIOR: { color: '#c69b6d', iconFileId: 626008, power: 'RAGE' },
  PALADIN: { color: '#f48cba', iconFileId: 626003, power: 'MANA' },
  HUNTER: { color: '#aad372', iconFileId: 626000, power: 'MANA' },
  ROGUE: { color: '#fff468', iconFileId: 626005, power: 'ENERGY' },
  PRIEST: { color: '#ffffff', iconFileId: 626004, power: 'MANA' },
  SHAMAN: { color: '#0070dd', iconFileId: 626006, power: 'MANA' },
  MAGE: { color: '#3fc7eb', iconFileId: 626001, power: 'MANA' },
  WARLOCK: { color: '#8788ee', iconFileId: 626007, power: 'MANA' },
  DRUID: { color: '#ff7c0a', iconFileId: 625999, power: 'MANA' },
}

export function classIdentity(className) {
  const token = String(className || '').toUpperCase().replace(/[^A-Z]/g, '')
  return { token, ...(CLASSES[token] || { color: '#c4a667', iconFileId: null, power: 'MANA' }) }
}
