import { useCallback, useMemo, useState } from 'react'
import { JoinContext } from './JoinContext.js'
import JoinModal from './JoinModal.jsx'
import { currentReturnTo, safeReturnTo } from './joinDestination.js'

function RecruitmentProvider({ children }) {
  const [join, setJoin] = useState(() => ({
    isOpen: window.location.pathname.replace(/\/+$/, '') === '/join',
    returnTo: currentReturnTo(),
  }))
  const openJoin = useCallback((returnTo) => {
    setJoin({
      isOpen: true,
      returnTo: typeof returnTo === 'string' ? safeReturnTo(returnTo) : currentReturnTo(),
    })
  }, [])
  const closeJoin = useCallback(() => {
    if (window.location.pathname.replace(/\/+$/, '') === '/join') {
      window.location.assign(join.returnTo)
      return
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
