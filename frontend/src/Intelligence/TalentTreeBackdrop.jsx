import { useEffect, useMemo, useState } from 'react'

import WowIcon from '../WowAssets/WowIcon.jsx'
import { resolveWowFileAsset } from '../WowAssets/assetResolver.js'
import './TalentTreeBackdrop.css'

const QUADRANTS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']

function TalentTexture({ texture }) {
  const fileDataId = Number(texture?.fileDataId)
  const src = useMemo(() => resolveWowFileAsset(fileDataId), [fileDataId])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    return (
      <span
        className="talent-backdrop__missing-tile"
        data-file-data-id={fileDataId > 0 ? fileDataId : undefined}
        data-client-path={texture?.path || undefined}
      />
    )
  }

  return (
    <img
      className="talent-backdrop__texture"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      data-file-data-id={fileDataId}
      data-client-path={texture?.path || undefined}
      onError={() => setFailed(true)}
    />
  )
}

function TalentBackgroundPanel({ tab, index }) {
  const textures = tab?.backgroundTextures && typeof tab.backgroundTextures === 'object'
    ? tab.backgroundTextures
    : {}
  const resolvedCount = QUADRANTS.filter((key) => Number(textures?.[key]?.fileDataId) > 0).length
  const hasIdentity = Boolean(tab?.name || tab?.iconFileDataId || tab?.background)

  return (
    <section
      className={`talent-backdrop__panel${resolvedCount ? ' talent-backdrop__panel--art' : ''}${hasIdentity ? '' : ' talent-backdrop__panel--anonymous'}`}
      data-background-token={tab?.background || undefined}
      data-background-assets={resolvedCount}
    >
      <div className="talent-backdrop__tiles">
        {QUADRANTS.map((key) => <TalentTexture key={key} texture={textures?.[key]} />)}
      </div>
      <div className="talent-backdrop__veil" />
      <div className="talent-backdrop__heading">
        {tab?.iconFileDataId ? (
          <WowIcon
            iconFileId={tab.iconFileDataId}
            label={tab?.name || `Talent tree ${index + 1}`}
            size={34}
          />
        ) : null}
        <div>
          <strong>{tab?.name || `Tree ${index + 1}`}</strong>
          {tab?.pointsSpent !== null && tab?.pointsSpent !== undefined
            ? <span>{tab.pointsSpent} {Number(tab.pointsSpent) === 1 ? 'point' : 'points'}</span>
            : null}
        </div>
      </div>
    </section>
  )
}

export default function TalentTreeBackdrop({ art, fallbackPanelCount = 3 }) {
  const sourceTabs = Array.isArray(art?.talentTabs) ? art.talentTabs.filter(Boolean).slice(0, 6) : []
  const panelCount = sourceTabs.length || Math.max(1, Math.min(6, Number(fallbackPanelCount) || 1))
  const tabs = sourceTabs.length
    ? sourceTabs
    : Array.from({ length: panelCount }, (_, index) => ({ id: `fallback-${index}` }))

  return (
    <div
      className="talent-backdrop"
      style={{ '--talent-panel-count': tabs.length }}
      aria-hidden="true"
      data-has-client-art={sourceTabs.some((tab) => QUADRANTS.some((key) => Number(tab?.backgroundTextures?.[key]?.fileDataId) > 0)) ? 'true' : 'false'}
    >
      {tabs.map((tab, index) => (
        <TalentBackgroundPanel key={`${tab?.id ?? tab?.index ?? index}-${tab?.name || index}`} tab={tab} index={index} />
      ))}
    </div>
  )
}
