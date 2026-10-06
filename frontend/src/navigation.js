export const publicNavigationLinks = [
  { label: 'Charter', href: '/charter' },
  { label: 'Ranks', href: '/ranks' },
  { label: 'Guildweaver', href: '/guildweaver' },
]

export const signInNavigationLabel = 'Sign In'

export const footerNavigationLinks = [
  { label: 'Join Holdfast', href: '/join' },
  ...publicNavigationLinks,
  { label: 'Privacy', href: '/privacy' },
  {
    label: 'Source',
    href: 'https://github.com/Indicaza/holdfast',
    external: true,
  },
]

export function primaryNavigationLinks(authenticated) {
  if (!authenticated) {
    return publicNavigationLinks
  }

  return [
    { label: 'Quests', href: '/quests' },
    { label: 'Members', href: '/members' },
    { label: 'Intelligence', href: '/intelligence' },
    ...publicNavigationLinks,
  ]
}
