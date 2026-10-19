export function foundingCalloutContent(authenticated, questsHref = '/holdfast/quests') {
  if (authenticated) {
    return {
      eyebrow: 'Member quests',
      title: 'See what Holdfast is working on.',
      description:
        'Find an objective that fits, lend a hand, or see what the guild has already accomplished.',
      action: 'View Quests',
      href: questsHref,
    }
  }

  return {
    eyebrow: 'Join Holdfast',
    title: 'Come play with us.',
    description:
      'No application gauntlet. Meet the guild, find your place, and get into the game.',
    action: 'Join Holdfast',
    href: null,
  }
}
