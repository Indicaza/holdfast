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
        data-client-path={texture?.resolvedPath || texture?.path || undefined}
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
      data-client-path={texture?.resolvedPath || texture?.path || undefined}
      onError={() => setFailed(true)}
    />
  )
}

function TalentBackgroundPanel({ tab, index }) {
  const textures = tab?.backgroundTextures && typeof tab.backgroundTextures === 'object'
    ? tab.backgroundTextures
    : {}
  const resolvedCount = QUADRANTS.filter((key) => Number(textures?.[key]?.fileDataId) > 0).length
  const points = Number(tab?.pointsSpent)
  const hasPoints = Number.isFinite(points)

  return (
    <section
      className={`talent-backdrop__panel${resolvedCount ? ' talent-backdrop__panel--art' : ''}${tab?.unresolvedName ? ' talent-backdrop__panel--unresolved' : ''}`}
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
            label={tab?.name || `Specialization ${index + 1}`}
            size={38}
          />
        ) : null}
        <div className="talent-backdrop__identity">
          <strong>{tab?.name || `Specialization ${index + 1}`}</strong>
          <span>{hasPoints ? `${points} ${points === 1 ? 'point' : 'points'} spent` : 'Points unavailable'}</span>
        </div>
      </div>
    </section>
  )
}

export default function TalentTreeBackdrop({ tabs = [] }) {
  const panels = Array.isArray(tabs) && tabs.length ? tabs : [{ id: 'fallback', name: 'Talents', pointsSpent: 0 }]

  return (
    <div
      className="talent-backdrop"
      style={{ '--talent-panel-count': panels.length }}
      aria-hidden="true"
      data-has-client-art={panels.some((tab) => QUADRANTS.some((key) => Number(tab?.backgroundTextures?.[key]?.fileDataId) > 0)) ? 'true' : 'false'}
    >
      {panels.map((tab, index) => (
        <TalentBackgroundPanel key={`${tab?.id ?? tab?.index ?? index}-${tab?.name || index}`} tab={tab} index={index} />
      ))}
    </div>
  )
}
