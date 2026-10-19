// questsHref: the quest board of the guild whose page this is.
export function publicJoinAction(authenticated, questsHref = '/holdfast/quests') {
  return authenticated
    ? { eyebrow: 'Member quests', label: 'View Quests', href: questsHref }
    : { eyebrow: 'Join Holdfast', label: 'Join Holdfast', href: '/join' }
}
