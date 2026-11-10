import { useCallback, useEffect, useRef, useState } from 'react'

import { apiJson } from '../Api/apiClient.js'
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
      .then((data) => setState({ status: 'ready', data, error: null }))
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

// The markets and the one the player is looking at (URL, else remembered,
// else the freshest with data).
export function useMarkets(requested = '') {
  const markets = useMarketResource('/api/market/markets')
  const list = markets.data?.markets || []
  const marketKey = resolveMarket(list, requested, storedMarket())
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

// Debounced suggestions while typing.
export function useSuggestions(query, marketKey) {
  const [suggestions, setSuggestions] = useState([])
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    const q = String(query || '').trim()
    if (q.length < 2 || /^\d+$/.test(q)) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    timer.current = setTimeout(() => {
      apiJson(`/api/market/suggest?q=${encodeURIComponent(q)}&market=${encodeURIComponent(marketKey || '')}`, { signal: controller.signal })
        .then((data) => setSuggestions(data.suggestions || []))
        .catch(() => {})
    }, 150)
    return () => { clearTimeout(timer.current); controller.abort() }
  }, [query, marketKey])
  return suggestions
}
