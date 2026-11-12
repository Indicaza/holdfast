// Which storage domain a table belongs to, and what kind of data it holds
// (see docs/DATA_RETENTION.md). Used by the storage observatory and the
// offline audit so both group tables the same way.

const DOMAINS = [
  [/^market_/, 'auction_house'],
  [/^guildweaver_telemetry_|^guildweaver_character_aliases$/, 'telemetry_transport'],
  [/^character_|^characters$|^telemetry_(characters|professions|recipes|organizations)$|^talent_tree_definitions$/, 'character_state'],
  [/^economic_|^farming_|^game_loot_/, 'economy_loot'],
  [/^dungeon_/, 'dungeons'],
  [/^public_game_|^game_data_catalog$|^game_icon_|^icon_/, 'game_definitions'],
  [/^guildweaver_(devices|pairings)$/, 'devices'],
  [/^(members|member_|guild|guilds|guild_|billets|rank_authority|assignments|quests?|quest_|objectives|contribution_|reward_items|notifications|audit_events)/, 'guild_operations'],
]

export function domainOf(table) {
  for (const [pattern, domain] of DOMAINS) if (pattern.test(table)) return domain
  return 'system'
}
