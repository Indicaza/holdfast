import { useCallback, useMemo } from 'react'

import { navigate } from '../../Navigation/navigation.js'
import { resolveCharacter } from '../lootModel.js'
import { onServerKey } from '../playerModel.js'
import { readAtlasQuery, withAtlasOpen } from './atlasModel.js'
import DungeonDetailModal from './DungeonDetailModal.jsx'
import { useDungeonList } from './useAtlasData.js'

function here() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

// The dungeon modal for any page: shown while the URL has ?open=<id>,
// for the character in ?character= (else the latest played on the
// server). Closing removes the param and keeps everything else.
export default function AtlasModalHost({ server = '', queryString = '', characters = [], showMapLink = true }) {
  const query = useMemo(() => readAtlasQuery(queryString), [queryString])
  const mine = useMemo(() => characters.filter((entry) => onServerKey(entry, server)), [characters, server])
  const character = resolveCharacter(mine, query.character)
  const list = useDungeonList()
  const onNavigate = useCallback(({ section = '', boss = '' }) => navigate(withAtlasOpen(here(), { open: query.open, section, boss }), { preserveScroll: true, replace: true }), [query.open])
  const onClose = useCallback(() => navigate(withAtlasOpen(here(), { open: null }), { preserveScroll: true }), [])
  if (!query.open) return null
  return (
    <DungeonDetailModal key={query.open} instanceId={query.open} dungeons={list.dungeons} character={character} server={server}
      section={query.section} boss={query.boss} onNavigate={onNavigate} onClose={onClose} showMapLink={showMapLink} />
  )
}
