import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { apiJson } from '../Api/apiClient.js'
import { classIdentity } from '../Intelligence/classIdentity.js'
import { sourcesUrl } from '../Intelligence/Farming/farmingModel.js'
import { GameTooltipHover } from '../Intelligence/GameTooltip.jsx'
import { navigate } from '../Navigation/navigation.js'
import WowIcon from '../WowAssets/WowIcon.jsx'
import { paletteEntries } from './exploreModel.js'
import { Icon } from './ui.jsx'

function EntryIcon({ entry }) {
  if (entry.kind === 'view') return <span className="gw-palette__glyph"><Icon name={entry.icon} size={16} /></span>
  if (entry.kind === 'character') {
    const identity = classIdentity(entry.character.className)
    return identity.iconFileId
      ? <WowIcon iconFileId={identity.iconFileId} label={entry.character.className} size={28} />
      : <span className="gw-palette__glyph"><Icon name="characters" size={16} /></span>
  }
  return <WowIcon iconFileId={entry.item?.iconFileDataId} itemId={entry.item?.itemId} label={entry.label} quality={entry.item?.qualityId} size={28} />
}

// `onOpenSource`, when given, opens a source or drop where the reader is (the
// map opens its details over itself) instead of going to its page.
export default function CommandPalette({ open, onClose, characters = [], views = [], onOpenCharacter, onOpenSource }) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    setInput('')
    setQuery('')
    setActive(0)
    const previous = document.activeElement
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 140)
    return () => window.clearTimeout(timer)
  }, [input])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    apiJson(sourcesUrl({ query }), { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        setSources(Array.isArray(data?.sources) ? data.sources : [])
        setLoading(false)
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return
        setSources([])
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, query])

  // The last results stay up while the next search runs, so the list never
  // blinks empty between keystrokes.
  const entries = useMemo(() => paletteEntries({ query, sources, characters, views }), [query, sources, characters, views])
  const shownActive = Math.min(active, Math.max(0, entries.length - 1))

  useEffect(() => { setActive(0) }, [query])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [shownActive])

  if (!open) return null

  function choose(entry) {
    if (!entry) return
    onClose()
    if (entry.kind === 'character') onOpenCharacter(entry.character.id)
    else if (onOpenSource && entry.source) onOpenSource({ ...entry.source, itemKey: entry.kind === 'drop' ? entry.item?.itemKey || '' : '' })
    else if (entry.href) navigate(entry.href)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (entries.length ? (Math.min(current, entries.length - 1) + 1) % entries.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (entries.length ? (Math.min(current, entries.length - 1) - 1 + entries.length) % entries.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(entries[shownActive])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return createPortal(
    <div className="gw-palette-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="gw-palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="gw-palette__field">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search an item, herb, vein, pool, creature or character"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={entries[shownActive] ? `${listId}-${shownActive}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
          />
          {loading ? <span className="gw-palette__spinner" aria-hidden="true" /> : null}
          <kbd>Esc</kbd>
        </div>
        <ul className="gw-palette__list" id={listId} role="listbox" ref={listRef} aria-label="Results">
          {entries.map((entry, index) => {
            const heading = index === 0 || entries[index - 1].group !== entry.group ? entry.group : ''
            const selected = index === shownActive
            const content = (
              <>
                <EntryIcon entry={entry} />
                <span className="gw-palette__copy">
                  <strong className={entry.item && entry.kind === 'drop' && entry.item.qualityId != null ? `gw-q${entry.item.qualityId}` : undefined}>{entry.label}</strong>
                  <small>{entry.detail}</small>
                </span>
              </>
            )
            return (
              <li key={entry.id} role="presentation">
                {heading ? <span className="gw-palette__group" role="presentation">{heading}</span> : null}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-active={selected}
                  className={`gw-palette__option${selected ? ' is-active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(entry)}
                >
                  {entry.kind === 'drop' && entry.item ? <GameTooltipHover item={entry.item} anchor="parent">{content}</GameTooltipHover> : content}
                  <Icon name="chevron" size={14} className="gw-palette__go" />
                </div>
              </li>
            )
          })}
          {!entries.length && !loading ? (
            <li className="gw-palette__empty" role="presentation">
              Nothing matches “{input}”. Drops appear here once someone gathers or loots them with Guildweaver.
            </li>
          ) : null}
        </ul>
        <footer className="gw-palette__foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
