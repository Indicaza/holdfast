// In-game class colors and class icon FileDataIDs (Interface\Icons\ClassIcon_*).

const CLASSES = {
  WARRIOR: { color: '#c69b6d', iconFileId: 626008 },
  PALADIN: { color: '#f48cba', iconFileId: 626003 },
  HUNTER: { color: '#aad372', iconFileId: 626000 },
  ROGUE: { color: '#fff468', iconFileId: 626005 },
  PRIEST: { color: '#ffffff', iconFileId: 626004 },
  SHAMAN: { color: '#0070dd', iconFileId: 626006 },
  MAGE: { color: '#3fc7eb', iconFileId: 626001 },
  WARLOCK: { color: '#8788ee', iconFileId: 626007 },
  DRUID: { color: '#ff7c0a', iconFileId: 625999 },
}

export function classIdentity(className) {
  const token = String(className || '').toUpperCase().replace(/[^A-Z]/g, '')
  return { token, ...(CLASSES[token] || { color: '#c4a667', iconFileId: null }) }
}
