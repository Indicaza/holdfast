import { useRecruitment } from './JoinContext.js'
import { currentReturnTo, joinHref } from './joinDestination.js'

function JoinLink({ returnTo = currentReturnTo(), children, onClick, ...props }) {
  const { openJoin } = useRecruitment()

  function handleClick(event) {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.target && props.target !== '_self') || props.download !== undefined) return
    event.preventDefault()
    openJoin(returnTo)
  }

  return <a {...props} href={joinHref(returnTo)} onClick={handleClick}>{children}</a>
}

export default JoinLink
