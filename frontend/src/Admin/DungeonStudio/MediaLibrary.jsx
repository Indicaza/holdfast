import { useState } from 'react'

import { apiJson } from '../../Api/apiClient.js'
import { Badge, Button, Panel, Select, TextInput } from '../../DesignSystem/index.js'

const API = '/api/admin/atlas-studio'
const ASPECTS = [['card', 16 / 9, 'Card 16:9'], ['banner', 3, 'Banner 3:1'], ['addon', 2, 'Add-on card 2:1'], ['portrait', 1, 'Portrait 1:1']]

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// One image in each frame it is used in, cropped around its focal point.
export function AspectPreviews({ media, crop }) {
  return (
    <div className="studio-aspects">
      {ASPECTS.map(([id, aspect, label]) => (
        <figure key={id} className="studio-aspect">
          <img src={media.urls.web} alt="" style={{ aspectRatio: String(aspect), objectPosition: `${crop.focusX * 100}% ${crop.focusY * 100}%` }} />
          <figcaption className="studio-muted">{label}</figcaption>
        </figure>
      ))}
    </div>
  )
}

function MediaEditor({ media, onSaved }) {
  const [form, setForm] = useState({ attribution: media.attribution, license: media.license, sourceUrl: media.sourceUrl, provenance: media.provenance, purpose: media.purpose, crop: media.crop })
  const [message, setMessage] = useState('')
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  async function save() {
    try {
      await apiJson(`${API}/media/${media.id}`, json('PATCH', form))
      setMessage('Saved.')
      onSaved()
    } catch {
      setMessage('Not saved.')
    }
  }
  async function remove() {
    try {
      await apiJson(`${API}/media/${media.id}`, { method: 'DELETE' })
      onSaved()
    } catch (error) {
      const users = error?.body?.usedBy || []
      setMessage(error?.status === 409 ? `In use: ${users.map((use) => `dungeon ${use.instanceId} (${use.in})`).join(', ')}. Remove it there first.` : 'Not removed.')
    }
  }
  return (
    <div className="studio-media-editor">
      <AspectPreviews media={media} crop={form.crop} />
      <div className="studio-grid studio-grid--3">
        <label className="studio-range">Focus x <input type="range" min="0" max="1" step="0.01" value={form.crop.focusX} onChange={(event) => set({ crop: { ...form.crop, focusX: Number(event.target.value) } })} /></label>
        <label className="studio-range">Focus y <input type="range" min="0" max="1" step="0.01" value={form.crop.focusY} onChange={(event) => set({ crop: { ...form.crop, focusY: Number(event.target.value) } })} /></label>
        <Select label="Purpose" value={form.purpose} options={['card', 'overview', 'map', 'portrait', 'general'].map((value) => [value, value])} onChange={(event) => set({ purpose: event.target.value })} />
      </div>
      <div className="studio-grid studio-grid--3">
        <TextInput label="Attribution" maxLength={300} value={form.attribution} onChange={(event) => set({ attribution: event.target.value })} />
        <TextInput label="License" maxLength={120} value={form.license} onChange={(event) => set({ license: event.target.value })} />
        <TextInput label="Source URL" maxLength={500} value={form.sourceUrl} onChange={(event) => set({ sourceUrl: event.target.value })} />
      </div>
      <TextInput label="Provenance" maxLength={500} value={form.provenance} onChange={(event) => set({ provenance: event.target.value })} />
      <div className="studio-actions">
        <Button size="sm" variant="primary" onClick={save}>Save details</Button>
        <Button size="sm" variant="danger" onClick={remove}>Remove image</Button>
        {message ? <span className="studio-muted" role="status">{message}</span> : null}
      </div>
    </div>
  )
}

export function MediaLibrary({ library }) {
  const [file, setFile] = useState(null)
  const [purpose, setPurpose] = useState('card')
  const [attribution, setAttribution] = useState('')
  const [license, setLicense] = useState('')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState('')
  async function upload(event) {
    event.preventDefault()
    if (!file) return
    const query = new URLSearchParams({ name: file.name, purpose, attribution, license })
    try {
      const result = await apiJson(`${API}/media?${query}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file, timeoutMs: 60_000 })
      setMessage(`Uploaded ${result.media.width}×${result.media.height}.`)
      setFile(null)
      event.target.reset()
      library.reload()
      setOpen(result.media.id)
    } catch (error) {
      setMessage(error?.body?.problems?.map((problem) => problem.message).join(' ') || 'Upload failed.')
    }
  }
  return (
    <Panel title="Media library" titleAs="h3">
      <form className="studio-upload" onSubmit={upload}>
        <label className="studio-file">Image (PNG, JPEG or WebP, up to 8 MB, 32–4096 px)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <Select label="Purpose" value={purpose} options={['card', 'overview', 'map', 'portrait', 'general'].map((value) => [value, value])} onChange={(event) => setPurpose(event.target.value)} />
        <TextInput label="Attribution" value={attribution} onChange={(event) => setAttribution(event.target.value)} />
        <TextInput label="License" value={license} onChange={(event) => setLicense(event.target.value)} />
        <Button type="submit" size="sm" variant="primary" disabled={!file}>Upload</Button>
      </form>
      {message ? <p className="studio-muted" role="status">{message}</p> : null}
      <p className="studio-muted">PNG uploads get a thumbnail and a web variant and can be packaged for the add-on. JPEG and WebP are served as uploaded and stay website-only.</p>
      <ul className="studio-media-grid">
        {library.media.map((media) => (
          <li key={media.id} className={open === media.id ? 'is-open' : ''}>
            <button type="button" className="studio-media-card" onClick={() => setOpen(open === media.id ? '' : media.id)} aria-expanded={open === media.id}>
              <img src={media.urls.thumb} alt="" loading="lazy" />
              <span>{media.originalName || media.id}</span>
              <span className="studio-muted">{media.width}×{media.height} · {media.mime.replace('image/', '')} · {Math.round(media.bytes / 1024)} KB</span>
              {media.usedBy?.length ? <Badge tone="gold">In use ×{media.usedBy.length}</Badge> : null}
            </button>
            {open === media.id ? <MediaEditor key={media.id} media={media} onSaved={library.reload} /> : null}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// A media field's editor: pick from the library, see it in its frames.
export function MediaPicker({ field, value, onChange, library }) {
  const selected = library.media.find((media) => media.id === value) || null
  return (
    <div className="studio-picker">
      <Select label={field.label} hideLabel value={value || ''} placeholder="No image" options={library.media.map((media) => [media.id, `${media.originalName || media.id} (${media.width}×${media.height}, ${media.purpose})`])}
        onChange={(event) => onChange(event.target.value || null)} />
      {selected ? <AspectPreviews media={selected} crop={selected.crop} /> : null}
      {value && !selected && library.status === 'ready' ? <p className="studio-inline-error">This image is no longer in the library.</p> : null}
    </div>
  )
}
