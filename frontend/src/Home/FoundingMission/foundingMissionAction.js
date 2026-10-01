export function foundingMissionAction(authenticated) {
  return authenticated
    ? { label: 'View Quests', href: '/quests' }
    : { label: 'Join Holdfast', href: null }
}
