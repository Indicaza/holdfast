export function foundingMissionAction(authenticated, questsHref = '/holdfast/quests') {
  return authenticated
    ? { label: 'View Quests', href: questsHref }
    : { label: 'Join Holdfast', href: null }
}
