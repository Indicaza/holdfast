import DungeonStudio from './DungeonStudio.jsx'
import { MediaLibrary, MediaPicker } from './MediaLibrary.jsx'
import PreviewPane from './PreviewPane.jsx'
import { useMediaLibrary } from './useMediaLibrary.js'

// The studio as a page: the editor with the media library, the media
// picker for art fields, and the live website and add-on previews.
export default function DungeonStudioPage({ instanceId = null }) {
  const library = useMediaLibrary()
  const extensions = {
    tabs: [['media', 'Media']],
    renderTab: (id) => (id === 'media' ? <MediaLibrary library={library} /> : null),
    renderMedia: (props) => <MediaPicker {...props} library={library} />,
    aside: ({ document, instanceId: id, bossKey }) => <PreviewPane instanceId={id} document={document} bossKey={bossKey} />,
  }
  return <DungeonStudio instanceId={instanceId} extensions={instanceId ? extensions : {}} />
}
