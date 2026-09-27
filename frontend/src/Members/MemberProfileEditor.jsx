import { useMemo, useState } from 'react'
import Modal from '../Modal/Modal.jsx'
import './MemberProfileEditor.css'

const CLASS_SUGGESTIONS = [
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Shaman',
  'Mage',
  'Warlock',
  'Druid',
  'Monk',
  'Death Knight',
]

const RACE_SUGGESTIONS = [
  'Human',
  'Dwarf',
  'Night Elf',
  'Gnome',
  'Draenei',
  'Skyborne',
]

function blankCharacter() {
  return {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    race: '',
    className: '',
    spec: '',
    professions: [],
    professionInput: '',
    isMain: false,
  }
}

function normalizeDraft(member) {
  const profile = member?.profile || {}
  const characters = Array.isArray(profile.characters)
    ? profile.characters.map((character) => ({
        ...character,
        professions: Array.isArray(character.professions)
          ? character.professions
          : [],
        professionInput: Array.isArray(character.professions)
          ? character.professions.join(', ')
          : '',
      }))
    : []

  return {
    battleTag: profile.battleTag || '',
    timezone: profile.timezone || '',
    availability: profile.availability || '',
    bio: profile.bio || '',
    characters,
  }
}

function professionText(character) {
  return (character.professions || []).join(', ')
}

function MemberProfileEditor({ member, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => normalizeDraft(member))
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const hasCharacters = draft.characters.length > 0
  const canSave = status !== 'saving'

  const mainId = useMemo(
    () => draft.characters.find((character) => character.isMain)?.id || null,
    [draft.characters],
  )

  function updateField(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function updateCharacter(id, field, value) {
    setDraft((current) => ({
      ...current,
      characters: current.characters.map((character) =>
        character.id === id
          ? {
              ...character,
              [field]: value,
            }
          : character,
      ),
    }))
  }

  function addCharacter() {
    setDraft((current) => {
      const character = blankCharacter()
      character.isMain = current.characters.length === 0

      return {
        ...current,
        characters: [...current.characters, character],
      }
    })
  }

  function removeCharacter(id) {
    setDraft((current) => {
      const remaining = current.characters.filter(
        (character) => character.id !== id,
      )

      if (remaining.length && !remaining.some((character) => character.isMain)) {
        remaining[0] = {
          ...remaining[0],
          isMain: true,
        }
      }

      return {
        ...current,
        characters: remaining,
      }
    })
  }

  function setMain(id) {
    setDraft((current) => ({
      ...current,
      characters: current.characters.map((character) => ({
        ...character,
        isMain: character.id === id,
      })),
    }))
  }

  async function save(event) {
    event.preventDefault()
    setStatus('saving')
    setError('')

    try {
      const response = await fetch('/api/guild/members/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profile: {
            ...draft,
            characters: draft.characters.map((character) => {
              const {
                professionInput = '',
                ...rest
              } = character

              return {
                ...rest,
                professions: professionInput
                  .split(',')
                  .map((profession) => profession.trim())
                  .filter(Boolean)
                  .slice(0, 6),
              }
            }),
          },
        }),
      })

      if (!response.ok) {
        throw new Error('Profile update failed')
      }

      const result = await response.json()
      setStatus('saved')
      onSaved?.(result.member)
    } catch {
      setStatus('error')
      setError('Could not save your member profile. Try again.')
    }
  }

  return (
    <Modal
      eyebrow="Member Profile"
      title="Edit your guild card"
      intro="Keep the useful stuff current: how to find you, what you play, and when you are usually around."
      size="wide"
      align="left"
      onClose={onClose}
    >
      <form className="member-editor" onSubmit={save}>
        <section className="member-editor__section">
          <div className="member-editor__section-heading">
            <div>
              <span>Player</span>
              <h2>Contact & availability</h2>
            </div>
          </div>

          <div className="member-editor__fields member-editor__fields--two">
            <label>
              <span>BattleTag</span>
              <input
                type="text"
                maxLength="64"
                placeholder="Name#1234"
                value={draft.battleTag}
                onChange={(event) => updateField('battleTag', event.target.value)}
              />
            </label>

            <label>
              <span>Timezone</span>
              <input
                type="text"
                maxLength="64"
                placeholder="ET / UTC-4 / whatever is useful"
                value={draft.timezone}
                onChange={(event) => updateField('timezone', event.target.value)}
              />
            </label>
          </div>

          <label>
            <span>Usually around</span>
            <input
              type="text"
              maxLength="160"
              placeholder="Weeknights after 7, weekends, raid nights…"
              value={draft.availability}
              onChange={(event) => updateField('availability', event.target.value)}
            />
          </label>

          <label>
            <span>About</span>
            <textarea
              rows="3"
              maxLength="500"
              placeholder="A line or two about how you like to play."
              value={draft.bio}
              onChange={(event) => updateField('bio', event.target.value)}
            />
          </label>
        </section>

        <section className="member-editor__section">
          <div className="member-editor__section-heading">
            <div>
              <span>WoW Forever</span>
              <h2>Characters</h2>
            </div>

            <button
              className="member-editor__add"
              type="button"
              onClick={addCharacter}
            >
              + Add character
            </button>
          </div>

          {hasCharacters ? (
            <div className="member-editor__characters">
              {draft.characters.map((character, index) => (
                <article
                  className={`member-editor__character ${
                    character.isMain ? 'member-editor__character--main' : ''
                  }`}
                  key={character.id}
                >
                  <div className="member-editor__character-heading">
                    <div>
                      <span>
                        {character.isMain ? 'Main character' : `Alt ${index + 1}`}
                      </span>
                      <strong>{character.name || 'Unnamed character'}</strong>
                    </div>

                    <div className="member-editor__character-actions">
                      {!character.isMain ? (
                        <button
                          type="button"
                          onClick={() => setMain(character.id)}
                        >
                          Make main
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => removeCharacter(character.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="member-editor__fields member-editor__fields--character">
                    <label>
                      <span>Name</span>
                      <input
                        type="text"
                        maxLength="32"
                        value={character.name}
                        onChange={(event) =>
                          updateCharacter(character.id, 'name', event.target.value)
                        }
                      />
                    </label>

                    <label>
                      <span>Race</span>
                      <input
                        type="text"
                        list="holdfast-races"
                        maxLength="32"
                        value={character.race}
                        onChange={(event) =>
                          updateCharacter(character.id, 'race', event.target.value)
                        }
                      />
                    </label>

                    <label>
                      <span>Class</span>
                      <input
                        type="text"
                        list="holdfast-classes"
                        maxLength="32"
                        value={character.className}
                        onChange={(event) =>
                          updateCharacter(
                            character.id,
                            'className',
                            event.target.value,
                          )
                        }
                      />
                    </label>

                    <label>
                      <span>Spec</span>
                      <input
                        type="text"
                        maxLength="48"
                        placeholder="Arms, Holy, Feral…"
                        value={character.spec}
                        onChange={(event) =>
                          updateCharacter(character.id, 'spec', event.target.value)
                        }
                      />
                    </label>

                    <label className="member-editor__professions">
                      <span>Professions</span>
                      <input
                        type="text"
                        maxLength="180"
                        placeholder="Mining, Blacksmithing"
                        value={character.professionInput || ''}
                        onChange={(event) =>
                          updateCharacter(
                            character.id,
                            'professionInput',
                            event.target.value,
                          )
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <button
              className="member-editor__empty"
              type="button"
              onClick={addCharacter}
            >
              <strong>Add your main character</strong>
              <span>
                Character name, race, class, spec, and professions will show on
                your member profile.
              </span>
            </button>
          )}
        </section>

        <datalist id="holdfast-classes">
          {CLASS_SUGGESTIONS.map((className) => (
            <option key={className} value={className} />
          ))}
        </datalist>

        <datalist id="holdfast-races">
          {RACE_SUGGESTIONS.map((race) => (
            <option key={race} value={race} />
          ))}
        </datalist>

        {error ? <p className="member-editor__error">{error}</p> : null}

        <div className="member-editor__footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="member-editor__save"
            type="submit"
            disabled={!canSave}
          >
            {status === 'saving' ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default MemberProfileEditor
