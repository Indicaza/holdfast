import DungeonStudio from './DungeonStudio.jsx'

// The studio as a page. Later milestones add the media library and the
// previews through `extensions`.
export default function DungeonStudioPage({ instanceId = null }) {
  return <DungeonStudio instanceId={instanceId} />
}
