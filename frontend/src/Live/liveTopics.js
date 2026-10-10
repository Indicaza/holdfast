// Whether a live event concerns any of the topics a view cares about. A
// reconnect ('*') may have missed anything, so it matches every topic.
export function matchesLiveTopics(eventTopics, topics) {
  if (!eventTopics?.length || !topics.length) return false
  if (eventTopics.includes('*')) return true
  return topics.some((topic) => eventTopics.includes(topic))
}
