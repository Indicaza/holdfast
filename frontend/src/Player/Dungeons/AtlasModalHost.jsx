import { useCallback, useMemo } from 'react'

import { navigate } from '../../Navigation/navigation.js'
import { resolveCharacter } from '../lootModel.js'
import { onServerKey } from '../playerModel.js'
import { dungeonsView, readAtlasQuery, withAtlasOpen, withCharacter } from './atlasModel.js'
import DungeonDetailModal from './DungeonDetailModal.jsx'
import { useDungeonList } from './useAtlasData.js'

function here() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

const BACK_LABELS = { explore: 'All dungeons', loot: 'Back to wishlist', runs: 'Back to my runs' }

// The dungeon for any page: shown while the URL has ?open=<id>, for the
// character in ?character= (else the latest played on the server). Closing
// removes the param and keeps everything else. layout 'dialog' draws it over
// the page (the world map); 'page' is the Dungeons page's own view of it.
export default function AtlasModalHost({ server = '', queryString = '', characters = [], showMapLink = true, layout = 'dialog' }) {
  const query = useMemo(() => readAtlasQuery(queryString), [queryString])
  const mine = useMemo(() => characters.filter((entry) => onServerKey(entry, server)), [characters, server])
  const character = resolveCharacter(mine, query.character)
  const list = useDungeonList()
  const onNavigate = useCallback(({ section = '', boss = '' }) => navigate(withAtlasOpen(here(), { open: query.open, section, boss }), { preserveScroll: true, replace: true }), [query.open])
  const onClose = useCallback(() => navigate(withAtlasOpen(here(), { open: null }), { preserveScroll: true }), [])
  const onCharacter = useCallback((id) => navigate(withCharacter(here(), id), { preserveScroll: true, replace: true }), [])
  if (!query.open) return null
  const backHref = layout === 'page' && typeof window !== 'undefined' ? withAtlasOpen(here(), { open: null }) : ''
  return (
    <DungeonDetailModal key={query.open} instanceId={query.open} dungeons={list.dungeons} character={character} characters={mine} onCharacter={onCharacter} server={server}
      section={query.section} boss={query.boss} onNavigate={onNavigate} onClose={onClose} showMapLink={showMapLink}
      layout={layout} backHref={backHref} backLabel={BACK_LABELS[dungeonsView(queryString)] || BACK_LABELS.explore} />
  )
}

// The Dungeons page's views, or, while the URL opens a dungeon, that
// dungeon as a page of its own in their place. Back (the link or the
// browser's) returns to the view it was opened from.
export function AtlasPageSwitch({ server = '', queryString = '', characters = [], children }) {
  const open = useMemo(() => readAtlasQuery(queryString).open, [queryString])
  if (open) return <AtlasModalHost server={server} queryString={queryString} characters={characters} layout="page" />
  return children
}
