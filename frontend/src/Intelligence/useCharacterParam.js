import { useEffect, useState } from 'react'

// The open character lives in the URL (?character=), so a refresh, a shared
// link or Back/Forward reopens it, and nothing else on the page can close it.
function readCharacterFromLocation() {
  return new URLSearchParams(window.location.search).get('character') || ''
}

function writeCharacterToLocation(characterId) {
  const url = new URL(window.location.href)
  if (characterId) url.searchParams.set('character', characterId)
  else url.searchParams.delete('character')
  if (url.href !== window.location.href) window.history.pushState(null, '', url)
}

// [open character id, open(characterId) — '' closes]
export function useCharacterParam() {
  const [characterId, setCharacterId] = useState(readCharacterFromLocation)

  useEffect(() => {
    const sync = () => setCharacterId(readCharacterFromLocation())
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  function open(nextId) {
    setCharacterId(nextId)
    writeCharacterToLocation(nextId)
  }

  return [characterId, open]
}
