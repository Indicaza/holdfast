export const QUEST_MANAGEMENT_PERMISSIONS = [
  'quests.create',
  'quests.edit',
  'quests.publish',
  'rewards.approve',
  'rewards.issue',
  'rewards.policy.edit',
]

export const PRIORITIES = ['Main', 'High', 'Medium', 'Low']

export function createQuestId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function blankReward() {
  return { rep: 0, marks: 0, items: [] }
}

export function blankRewardApproval() {
  return {
    approvedByMemberId: '',
    approvedByName: '',
    approvedAt: '',
    fingerprint: '',
  }
}

export function blankObjective() {
  return {
    id: createQuestId('objective'),
    title: 'New objective',
    description: '',
    priority: 'Medium',
    completed: false,
    need: '',
    reward: blankReward(),
    rewardApproval: blankRewardApproval(),
    assignments: [],
  }
}

export function blankQuest(memberId = '') {
  return {
    id: createQuestId('quest'),
    publication: 'draft',
    mode: 'rotating',
    title: 'New quest',
    summary: '',
    createdByMemberId: memberId,
    createdAt: new Date().toISOString(),
    objectives: [blankObjective()],
    completed: false,
  }
}

export function rewardFingerprint(reward) {
  return JSON.stringify({
    rep: Number(reward?.rep) || 0,
    marks: Number(reward?.marks) || 0,
    items: (reward?.items || []).map((item) => ({
      name: String(item?.name || '').trim(),
      quantity: Number(item?.quantity) || 0,
    })),
  })
}

export function rewardHasValue(reward) {
  return Boolean(
    Number(reward?.rep) > 0 ||
      Number(reward?.marks) > 0 ||
      (reward?.items || []).length,
  )
}

export function rewardApprovalStatus(objective) {
  if (!rewardHasValue(objective?.reward)) return 'not-required'

  if (objective?.rewardApproval?.status) {
    return objective.rewardApproval.status
  }

  return objective?.rewardApproval?.approvedAt &&
    objective.rewardApproval.fingerprint === rewardFingerprint(objective.reward)
    ? 'approved'
    : 'pending'
}

export function questScopeAllows(session, permission, quest) {
  if (!session.hasPermission(permission)) return false

  const scope = session.authority?.questScopes?.[permission]

  return (
    scope === 'all' ||
    (scope === 'own' &&
      Boolean(session.user?.id) &&
      quest?.createdByMemberId === session.user.id)
  )
}

export function rewardAuthorityAllows(session, permission, quest, objective) {
  if (!questScopeAllows(session, permission, quest)) return false

  const bucket =
    permission === 'rewards.approve'
      ? session.authority?.rewardLimits?.approve
      : session.authority?.rewardLimits?.issue

  if (!bucket) return false

  const questMarks = (quest?.objectives || []).reduce(
    (total, item) => total + (Number(item.reward?.marks) || 0),
    0,
  )

  return (
    (Number(objective?.reward?.rep) || 0) <= bucket.repPerObjective &&
    (Number(objective?.reward?.marks) || 0) <= bucket.marksPerObjective &&
    questMarks <= bucket.marksPerQuest
  )
}

export function canManageAnyQuest(session) {
  return QUEST_MANAGEMENT_PERMISSIONS.some((permission) =>
    session.hasPermission(permission),
  )
}

export function withSelfAssignments(quest, memberId) {
  if (!quest) return quest

  return {
    ...quest,
    objectives: (quest.objectives || []).map((objective) => ({
      ...objective,
      assignments: (objective.assignments || []).map((assignment) => ({
        ...assignment,
        isSelf:
          assignment.isSelf === true ||
          (Boolean(memberId) && assignment.memberId === memberId),
      })),
    })),
  }
}
