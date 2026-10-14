export function catalogLink(itemId, scope, options = {}) {
  const query = new URLSearchParams({ build: scope.gameBuild, locale: scope.locale })
  if (options.q) query.set('q', options.q)
  if (options.after) query.set('after', options.after)
  return `${itemId ? `/items/${itemId}` : '/items'}?${query}`
}
