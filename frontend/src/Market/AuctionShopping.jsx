import { useState } from 'react'

import { AuctionItem, ItemPicker } from './AuctionParts.jsx'
import { goAuction } from './auctionNavigation.js'
import { Coins, ListingState } from './MarketComponents.jsx'
import { marketWrite, useMarketResource } from './useMarket.js'

// One list: what is still needed and what it costs on this house now.
function ListItems({ list, marketKey, onChange, onInspect }) {
  const [error, setError] = useState('')
  const write = async (url, options) => {
    setError('')
    try { await marketWrite(url, options); onChange() } catch { setError('That change was not saved. Try again.') }
  }
  const items = list.items
  return (
    <>
      <ItemPicker id="ah-list-add" label="Add an item" marketKey={marketKey}
        onPick={(entry) => write(`/api/market/lists/${list.id}/items/${entry.itemId}`, { body: { quantity: 1 } })} />
      {error ? <p className="ah-error" role="alert">{error}</p> : null}
      {items.length ? (
        <table className="ah-table ah-table--list" aria-label={`${list.name} items`}>
          <thead>
            <tr>
              <th scope="col"><span className="ah-head">Name</span></th>
              <th scope="col"><span className="ah-head ah-head--num">Need</span></th>
              <th scope="col"><span className="ah-head ah-head--num">Bought</span></th>
              <th scope="col"><span className="ah-head ah-head--num">Lowest buyout</span></th>
              <th scope="col"><span className="ah-head ah-head--num">Cost</span></th>
              <th scope="col"><span className="ah-head"><span className="gw-sr">Remove</span></span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => {
              const done = entry.purchased >= entry.quantity
              const listed = entry.price && !entry.price.variantsOnly && entry.price.quantity > 0
              return (
                <tr key={entry.item.itemId} className={done ? 'is-done' : ''} onDoubleClick={() => onInspect({ itemId: entry.item.itemId, itemKey: '', name: entry.item.name, qualityId: entry.item.qualityId })}>
                  <td className="ah-col-name"><AuctionItem item={entry.item} size={28} /></td>
                  <td className="ah-col-num">
                    <input className="ah-qty" type="number" min="1" max="100000" defaultValue={entry.quantity} aria-label={`${entry.item.name} quantity`}
                      onBlur={(event) => { const quantity = Number(event.target.value); if (quantity > 0 && quantity !== entry.quantity) write(`/api/market/lists/${list.id}/items/${entry.item.itemId}`, { body: { quantity } }) }} />
                  </td>
                  <td className="ah-col-num">
                    <input className="ah-qty" type="number" min="0" max={entry.quantity} defaultValue={entry.purchased} aria-label={`${entry.item.name} bought`}
                      onBlur={(event) => { const purchased = Number(event.target.value); if (purchased >= 0 && purchased !== entry.purchased) write(`/api/market/lists/${list.id}/items/${entry.item.itemId}`, { body: { purchased } }) }} />
                  </td>
                  <td className="ah-col-num">{listed ? <Coins value={entry.price.minUnitBuyout} compact />
                    : <ListingState listing={entry.price?.variantsOnly ? 'listed' : entry.price ? 'none_listed' : 'unknown'} />}</td>
                  <td className="ah-col-num">{entry.estimatedCost === null ? '—' : <Coins value={entry.estimatedCost} compact />}</td>
                  <td><button type="button" className="ah-band-button" aria-label={`Remove ${entry.item.name}`} title="Remove"
                    onClick={() => write(`/api/market/lists/${list.id}/items/${entry.item.itemId}`, { method: 'DELETE' })}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <div className="ah-empty">This list is empty.<p>Add items above, or with "Add to list" in an item's window.</p></div>}
      {items.length ? (
        <p className="ah-list-total">
          Still to buy: <Coins value={list.estimate.copper} />
          {list.estimate.missingPrices ? <small> · {list.estimate.missingPrices} item{list.estimate.missingPrices === 1 ? '' : 's'} without a price here, not counted</small> : null}
          <small> · lowest buyout × quantity still needed</small>
        </p>
      ) : null}
    </>
  )
}

// The Shopping tab: the player's lists, priced on the chosen house.
export default function AuctionShopping({ state, server, active, marketKey, marketName, onInspect }) {
  const lists = useMarketResource(active && marketKey ? `/api/market/lists?market=${encodeURIComponent(marketKey)}` : '')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const all = lists.data?.lists || []
  const chosen = all.find((list) => list.id === state.list) || all[0] || null
  async function create(event) {
    event.preventDefault()
    if (!name.trim()) return
    setError('')
    try {
      const result = await marketWrite('/api/market/lists', { method: 'POST', body: { name: name.trim() } })
      if (result.status === 'limit') { setError('You have as many lists as allowed.'); return }
      setName('')
      lists.reload()
      if (result.list) goAuction({ ...state, tab: 'shopping', list: result.list.id }, server)
    } catch { setError('The list was not created. Try again.') }
  }
  async function remove(list) {
    if (!globalThis.confirm?.(`Delete the list "${list.name}"?`)) return
    await marketWrite(`/api/market/lists/${list.id}`, { method: 'DELETE' })
    lists.reload()
  }
  return (
    <div className="ah-pane ah-shopping" hidden={!active}>
      <section className="ah-pane__left" aria-label="Shopping lists">
        <h3 className="ah-pane__title">Shopping lists</h3>
        {lists.status === 'loading' ? <div className="ah-loading" aria-label="Loading">Loading</div> : null}
        {lists.status === 'error' ? <div className="ah-empty">Your lists could not be loaded. <button type="button" className="ah-button" onClick={lists.reload}>Retry</button></div> : null}
        <ul className="ah-lists">
          {all.map((list) => (
            <li key={list.id}>
              <button type="button" className={`ah-cat${chosen?.id === list.id ? ' is-selected' : ''}`} aria-current={chosen?.id === list.id}
                onClick={() => goAuction({ ...state, tab: 'shopping', list: list.id }, server)}>
                <span className="ah-cat__label">{list.name}</span><span className="ah-cat__count">{list.items.length}</span>
              </button>
            </li>
          ))}
        </ul>
        <form className="ah-newlist" onSubmit={create}>
          <input aria-label="New list name" placeholder="New list" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="ah-button" disabled={!name.trim()}>Create</button>
        </form>
        {error ? <p className="ah-error" role="alert">{error}</p> : null}
      </section>
      <section className="ah-pane__right" aria-label={chosen ? chosen.name : 'Shopping list'}>
        {chosen ? (
          <>
            <header className="ah-pane__head">
              <h3 className="ah-pane__title">{chosen.name}</h3>
              <small className="ah-faint">priced on {marketName}</small>
              <span className="ah-spacer" />
              <button type="button" className="ah-band-button" onClick={() => remove(chosen)}>Delete list</button>
            </header>
            <ListItems list={chosen} marketKey={marketKey} onChange={lists.reload} onInspect={onInspect} />
          </>
        ) : lists.status === 'ready' ? <div className="ah-empty">No shopping lists yet.<p>Create one on the left.</p></div> : null}
      </section>
    </div>
  )
}
