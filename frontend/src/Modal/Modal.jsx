import { useEffect, useRef } from 'react'
import './Modal.css'

function Modal({
  eyebrow,
  title,
  intro,
  size = 'default',
  onClose,
  children,
}) {
  const panelRef = useRef(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  function handleBackdrop(event) {
    if (event.target === event.currentTarget) {
      onClose?.()
    }
  }

  return (
    <div className="modal" role="presentation" onMouseDown={handleBackdrop}>
      <section
        ref={panelRef}
        className={`modal__panel modal__panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex="-1"
      >
        <button
          className="modal__close"
          type="button"
          aria-label="Close"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>

        <header className="modal__header">
          {eyebrow ? <p className="modal__eyebrow">{eyebrow}</p> : null}
          <h1 id="modal-title">{title}</h1>
          {intro ? <p className="modal__intro">{intro}</p> : null}
        </header>

        <div className="modal__body">{children}</div>
      </section>
    </div>
  )
}

export default Modal
