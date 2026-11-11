// The Auction House's Back and Forward. Each meaningful step (a search, a
// category, a sort, a page, another house, another tab) is a browser history
// entry tagged with its position among the Auction House's own steps, so the
// buttons know whether there is an earlier or later Auction House state and
// never leave the Auction House. Typing, hovering, opening a category branch
// and selecting a row are not steps.
import { navigate } from '../Navigation/navigation.js'
import { auctionHref } from './marketFormat.js'

const MAX_KEY = 'guildweaver:auctions:steps'

function currentStep() {
  const step = Number(globalThis.history?.state?.auctionStep)
  return Number.isSafeInteger(step) && step >= 0 ? step : 0
}

function readMax() {
  try { return Number(globalThis.sessionStorage?.getItem(MAX_KEY)) || 0 } catch { return 0 }
}

function writeMax(value) {
  try { globalThis.sessionStorage?.setItem(MAX_KEY, String(value)) } catch { /* a convenience */ }
}

// A new step: one entry further; anything that was "forward" is gone, as in
// a browser.
export function goAuction(state, server, { replace = false } = {}) {
  const href = auctionHref(state, server)
  if (replace) {
    navigate(href, { replace: true, preserveScroll: true, state: { auctionStep: currentStep() } })
    return
  }
  const next = currentStep() + 1
  writeMax(next)
  navigate(href, { preserveScroll: true, state: { auctionStep: next } })
}

export function auctionHistory() {
  const step = currentStep()
  return { canBack: step > 0, canForward: step < readMax() }
}

export function auctionBack() {
  if (currentStep() > 0) globalThis.history.back()
}

export function auctionForward() {
  if (currentStep() < readMax()) globalThis.history.forward()
}

// Arriving at the Auction House from elsewhere (a menu link, a fresh tab):
// the steps start again, so Forward does not offer a page that is gone.
export function startAuctionHistory() {
  if (globalThis.history?.state?.auctionStep === undefined) writeMax(0)
}
