import { useEffect, useState } from 'react'
import { apiJson } from '../../Api/apiClient.js'
import Select from '../../DesignSystem/Select.jsx'

export default function DevPersonaChooser() {
  const [personas, setPersonas] = useState([])

  useEffect(() => {
    let active = true

    async function loadPersonas() {
      try {
        const data = await apiJson('/api/dev')

        if (active && data.enabled === true && Array.isArray(data.personas)) {
          setPersonas(data.personas)
        }
      } catch {
        // Keep the chooser hidden if development auth is unavailable.
      }
    }

    loadPersonas()

    return () => {
      active = false
    }
  }, [])

  function handleChange(event) {
    const personaKey = event.target.value
    const persona = personas.find((item) => item.key === personaKey)

    if (persona?.loginPath) {
      window.location.assign(persona.loginPath)
    }
  }

  if (personas.length === 0) {
    return null
  }

  return (
    <div className="dev-persona-chooser">
      <Select
        label="Development persona"
        hideLabel
        size="sm"
        placeholder="Choose test persona"
        options={personas.map((persona) => ({
          value: persona.key,
          label: `${persona.name} — ${persona.rank}`,
        }))}
        value=""
        onChange={handleChange}
      />
    </div>
  )
}
