const intelligenceViews = Object.freeze([
  {
    id: 'overview',
    label: 'Overview',
    description: 'Guild health and recent activity',
    icon: 'overview',
    section: 'guild',
  },
  {
    id: 'characters',
    label: 'Characters',
    description: 'Browse synced armories',
    icon: 'characters',
    section: 'guild',
  },
  {
    id: 'roster',
    label: 'Roster',
    description: 'Class, spec, and profession mix',
    icon: 'roster',
    section: 'guild',
  },
  {
    id: 'craft',
    label: 'Craft Finder',
    description: 'Find recipes and crafters',
    icon: 'craft',
    section: 'guild',
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
    description: 'Devices, sync health, and raw telemetry',
    icon: 'guildweaver',
    section: 'operations',
    permission: 'site.admin',
  },
])

export default intelligenceViews
