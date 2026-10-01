export function publicJoinAction(authenticated) {
  return authenticated
    ? { eyebrow: 'Member quests', label: 'View Quests', href: '/quests' }
    : { eyebrow: 'Join Holdfast', label: 'Join Holdfast', href: '/join' }
}
