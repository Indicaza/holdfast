import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
import { marketChoices } from './marketBrowse.js'
import { resolveMarket, storeMarket, storedMarket } from './marketFormat.js'

// A GET resource with reload(). Keeps the last data on screen while a new
// request runs, so tables do not flash when sorting or paging.
export function useMarketResource(url, { enabled = true } = {}) {
  const [state, setState] = useState({ status: url && enabled ? 'loading' : 'idle', data: null, error: null })
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  useEffect(() => {
    if (!url || !enabled) {
      setState({ status: 'idle', data: null, error: null })
      return undefined
    }
    const controller = new AbortController()
    setState((current) => ({ ...current, status: current.data ? 'refreshing' : 'loading' }))
    apiJson(url, { signal: controller.signal })
      // A response that lost the race to a newer request is dropped.
      .then((data) => { if (!controller.signal.aborted) setState({ status: 'ready', data, error: null }) })
      .catch((error) => {
        if (controller.signal.aborted) return
        setState({ status: error?.status === 404 ? 'missing' : 'error', data: null, error })
      })
    return () => controller.abort()
  }, [url, enabled, version])
  return { ...state, reload }
}

export async function marketWrite(url, { method = 'PUT', body } = {}) {
  return apiJson(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

// The markets and the one the player is looking at: the URL's, else the
// remembered one if it belongs to the chosen server, else that server's
// freshest house.
export function useMarkets(requested = '', server = '') {
  const markets = useMarketResource('/api/market/markets')
  const list = useMemo(() => markets.data?.markets || [], [markets.data])
  const candidates = useMemo(() => marketChoices(list, server).keys, [list, server])
  const marketKey = resolveMarket(list, requested, storedMarket(), candidates)
  useEffect(() => { if (marketKey) storeMarket(marketKey) }, [marketKey])
  return { status: markets.status, markets: list, marketKey, market: list.find((entry) => entry.marketKey === marketKey) || null, reload: markets.reload }
}

// Prices for a set of items in the remembered market, for reusable price
// cells (dungeon loot, recipes, wishlists).
export function useItemPrices(itemIds = [], marketKey = '') {
  const market = marketKey || storedMarket()
  const ids = [...new Set(itemIds.filter((id) => Number.isSafeInteger(Number(id))).map(Number))].sort((a, b) => a - b).slice(0, 500)
  const url = market && ids.length ? `/api/market/prices?market=${encodeURIComponent(market)}&items=${ids.join(',')}` : ''
  const result = useMarketResource(url)
  const byItem = new Map((result.data?.prices || []).map((entry) => [entry.item.itemId, entry]))
  return { status: result.status, marketKey: market, prices: byItem }
}

// Debounced suggestions while typing: their own small request, separate
// from the search, cancelled when the text changes. A number suggests the
// item with that id.
export function useSuggestions(query, marketKey) {
  const [suggestions, setSuggestions] = useState([])
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    const q = String(query || '').trim()
    if (q.length < 2 && !/^\d+$/.test(q)) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    timer.current = setTimeout(() => {
      apiJson(`/api/market/suggest?q=${encodeURIComponent(q)}&market=${encodeURIComponent(marketKey || '')}`, { signal: controller.signal, retry: false })
        .then((data) => { if (!controller.signal.aborted) setSuggestions(data.suggestions || []) })
        .catch(() => {})
    }, 200)
    return () => { clearTimeout(timer.current); controller.abort() }
  }, [query, marketKey])
  return suggestions
}

// Price and supply history of one item variant in one market. Fetched only
// where it is shown (an inspector's History tab, the History tab), never in
// the default Browse view.
export function useItemHistory({ itemId, itemKey = '', marketKey = '', range = '7d', enabled = true }) {
  const variant = itemKey ? `&key=${encodeURIComponent(itemKey)}` : ''
  return useMarketResource(enabled && itemId && marketKey ? `/api/market/items/${itemId}/history?market=${encodeURIComponent(marketKey)}&range=${range}${variant}` : '')
}

// One item in one market, as the item panel, the inspectors and the
// Appraiser read it: the same endpoints for every view of an item.
export function useItemMarket({ itemId, itemKey = '', marketKey = '', analysis = true }) {
  const variant = itemKey ? `&key=${encodeURIComponent(itemKey)}` : ''
  const detail = useMarketResource(itemId ? `/api/market/items/${itemId}?market=${encodeURIComponent(marketKey || '')}${variant}` : '')
  // Without a chosen market, the server picks one that has the item (and says so).
  const market = marketKey || detail.data?.marketKey || ''
  const focusKey = detail.data?.itemKey || itemKey
  const metrics = useMarketResource(analysis && itemId && market ? `/api/market/items/${itemId}/analysis?market=${encodeURIComponent(market)}${focusKey ? `&key=${encodeURIComponent(focusKey)}` : ''}` : '')
  const here = detail.data?.variants?.find((entry) => entry.itemKey === focusKey) || null
  return { detail, analysis: metrics, marketKey: market, focusKey, here }
}
