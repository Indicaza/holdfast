import { useEffect, useId, useRef } from 'react'
import './Modal.css'

function Modal({
  eyebrow,
  title,
  intro,
  size = 'default',
  align = 'center',
  onClose,
  children,
  hideHeader = false,
  ariaLabel,
}) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const introId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (panelRef.current?.closest('[inert]')) return
      if (event.key === 'Escape' && onCloseRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const focusable = Array.from(
        panelRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      )

      if (!focusable.length) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    panelRef.current?.querySelector('button, a[href], input, select, textarea')?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus()
      }
    }
  }, [])

  function handleBackdrop(event) {
    if (event.target === event.currentTarget) {
      onClose?.()
    }
  }

  const dialogLabel = ariaLabel || title || 'Dialog'

  return (
    <div className={`modal modal--${size}`} role="presentation" onMouseDown={handleBackdrop}>
      <section
        ref={panelRef}
        className={`modal__panel modal__panel--${size} modal__panel--${align}${hideHeader ? ' modal__panel--headerless' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideHeader ? undefined : titleId}
        aria-label={hideHeader ? dialogLabel : undefined}
        aria-describedby={!hideHeader && intro ? introId : undefined}
        tabIndex="-1"
      >
        {onClose ? (
          <button
            className="modal__close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}

        {!hideHeader ? (
          <header className="modal__header">
            {eyebrow ? <p className="modal__eyebrow">{eyebrow}</p> : null}
            <h1 id={titleId}>{title}</h1>
            {intro ? (
              <p id={introId} className="modal__intro">
                {intro}
              </p>
            ) : null}
          </header>
        ) : null}

        <div className="modal__body">{children}</div>
      </section>
    </div>
  )
}

export default Modal
