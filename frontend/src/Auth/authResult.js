// What to tell a player when Discord sign-in did not simply succeed. auth
// codes come from the server's OAuth callback (backend/src/Auth/
// discordAuth.js); sessionStatus is the session check that followed.
export function authResultMessage(authCode, sessionStatus = 'ready') {
  if (authCode === 'connected') {
    return sessionStatus === 'error'
      ? { title: 'We could not reach Guildweaver.', intro: 'Discord signed you in, but the website did not answer. Check your connection and try again.', retry: 'Try again' }
      : { title: 'Sign-in did not stick.', intro: 'Discord signed you in, but no session was saved. Your browser may be blocking cookies for this site.', retry: 'Sign in again' }
  }
  if (authCode === 'cancelled') {
    return { title: 'Sign-in cancelled.', intro: 'Nothing changed. Sign in whenever you are ready.', retry: 'Sign in with Discord' }
  }
  if (authCode === 'invalid-state') {
    return { title: 'That sign-in link expired.', intro: 'Sign-in links last ten minutes and work once. Start again to continue.', retry: 'Sign in with Discord' }
  }
  return { title: 'Discord sign-in failed.', intro: 'Discord did not finish signing you in. Nothing changed; you can try again.', retry: 'Try again' }
}
