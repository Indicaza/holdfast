const intelligenceViews = Object.freeze([
  {
    id: 'overview',
    label: 'Overview',
    description: 'Roster health and recent activity',
    icon: 'overview',
    section: 'intelligence',
  },
  {
    id: 'roster',
    label: 'Roster',
    description: 'Class, spec, and profession mix',
    icon: 'roster',
    section: 'intelligence',
  },
  {
    id: 'characters',
    label: 'Characters',
    description: 'Browse synced armories',
    icon: 'characters',
    section: 'intelligence',
  },
  {
    id: 'craft',
    label: 'Craft Finder',
    description: 'Find recipes and crafters',
    icon: 'craft',
    section: 'intelligence',
  },
  {
    id: 'audit',
    label: 'Audit Log',
    description: 'Administrative activity and safety history',
    icon: 'audit',
    section: 'operations',
    permission: 'audit.view',
  },
  {
    id: 'guildweaver',
    label: 'Guildweaver',
    description: 'Sync health and raw telemetry console',
    icon: 'guildweaver',
    section: 'operations',
    permission: 'site.admin',
  },
])

export default intelligenceViews
