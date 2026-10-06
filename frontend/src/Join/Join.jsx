import Guildweaver from '../Guildweaver/Guildweaver.jsx'
import Home from '../Home/Home.jsx'
import { safeReturnTo } from './joinDestination.js'

function Join() {
  const params = new URLSearchParams(window.location.search)

  if (params.get('auth') === 'connected') {
    return (
      <Guildweaver
        welcome
        autoOnly
        returnTo={safeReturnTo(params.get('returnTo'))}
      />
    )
  }

  return <Home />
}

export default Join
