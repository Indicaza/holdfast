export const publicNavigationLinks = [
  { label: 'Charter', href: '/charter' },
  { label: 'Ranks', href: '/ranks' },
]

export const footerNavigationLinks = [
  { label: 'Join Holdfast', href: '/join' },
  ...publicNavigationLinks,
  { label: 'Privacy', href: '/privacy' },
]

export function primaryNavigationLinks(authenticated) {
  if (!authenticated) {
    return publicNavigationLinks
  }

  return [
    { label: 'Quests', href: '/quests' },
    { label: 'Members', href: '/members' },
    ...publicNavigationLinks,
  ]
}
