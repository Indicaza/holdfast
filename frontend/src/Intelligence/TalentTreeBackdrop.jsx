import { useEffect, useMemo, useState } from 'react'

import WowIcon from '../WowAssets/WowIcon.jsx'
import { resolveWowIconAsset } from '../WowAssets/assetResolver.js'
import './TalentTreeBackdrop.css'

const QUADRANTS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']

function TalentTexture({ texture }) {
  const fileDataId = Number(texture?.fileDataId)
  const src = useMemo(
    () => resolveWowIconAsset({ iconFileId: fileDataId, size: 512 }),
    [fileDataId],
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) return <span className="talent-backdrop__missing-tile" />

  return (
    <img
      className="talent-backdrop__texture"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function TalentBackgroundPanel({ tab }) {
  const textures = tab?.backgroundTextures && typeof tab.backgroundTextures === 'object'
    ? tab.backgroundTextures
    : {}
  const resolvedCount = QUADRANTS.filter((key) => Number(textures?.[key]?.fileDataId) > 0).length

  return (
    <section
      className={`talent-backdrop__panel${resolvedCount ? ' talent-backdrop__panel--art' : ''}`}
      data-background-token={tab?.background || undefined}
    >
      <div className="talent-backdrop__tiles">
        {QUADRANTS.map((key) => <TalentTexture key={key} texture={textures?.[key]} />)}
      </div>
      <div className="talent-backdrop__veil" />
      <div className="talent-backdrop__heading">
        <WowIcon
          iconFileId={tab?.iconFileDataId}
          label={tab?.name || 'Talent tree'}
          size={30}
        />
        <div>
          <strong>{tab?.name || 'Talent tree'}</strong>
          {tab?.pointsSpent !== null && tab?.pointsSpent !== undefined
            ? <span>{tab.pointsSpent} points</span>
            : null}
        </div>
      </div>
    </section>
  )
}

export default function TalentTreeBackdrop({ art }) {
  const tabs = Array.isArray(art?.talentTabs) ? art.talentTabs.filter(Boolean).slice(0, 6) : []
  const specialization = art?.specialization && typeof art.specialization === 'object' ? art.specialization : null

  if (!tabs.length) {
    return (
      <div className="talent-backdrop talent-backdrop--fallback" aria-hidden="true">
        {specialization?.name ? <span className="talent-backdrop__watermark">{specialization.name}</span> : null}
      </div>
    )
  }

  return (
    <div
      className="talent-backdrop"
      style={{ '--talent-panel-count': tabs.length }}
      aria-hidden="true"
    >
      {tabs.map((tab, index) => (
        <TalentBackgroundPanel key={`${tab?.id ?? tab?.index ?? index}-${tab?.name || index}`} tab={tab} />
      ))}
    </div>
  )
}
