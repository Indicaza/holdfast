import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JoinContext } from './JoinContext.js'
import JoinModal from './JoinModal.jsx'
import { navigate } from '../Navigation/navigation.js'
import { currentReturnTo, safeReturnTo } from './joinDestination.js'

function RecruitmentProvider({ children }) {
  const openerRef = useRef(null)
  const [join, setJoin] = useState(() => ({
    isOpen: window.location.pathname.replace(/\/+$/, '') === '/join',
    returnTo: currentReturnTo(),
  }))
  const openJoin = useCallback((returnTo, opener) => {
    openerRef.current = opener ?? returnTo?.currentTarget ?? document.activeElement
    setJoin({
      isOpen: true,
      returnTo: typeof returnTo === 'string' ? safeReturnTo(returnTo) : currentReturnTo(),
    })
  }, [])
  useEffect(() => {
    if (!join.isOpen && openerRef.current?.isConnected) {
      openerRef.current.focus({ preventScroll: true })
      openerRef.current = null
    }
  }, [join.isOpen])
  const closeJoin = useCallback(() => {
    if (window.location.pathname.replace(/\/+$/, '') === '/join') {
      navigate(join.returnTo)
    }
    setJoin((current) => ({ ...current, isOpen: false }))
  }, [join.returnTo])
  const value = useMemo(() => ({ isOpen: join.isOpen, openJoin }), [join.isOpen, openJoin])

  return (
    <JoinContext.Provider value={value}>
      <div inert={join.isOpen ? true : undefined}>{children}</div>
      {join.isOpen ? <JoinModal onClose={closeJoin} returnTo={join.returnTo} /> : null}
    </JoinContext.Provider>
  )
}

export default RecruitmentProvider
