export async function runAuthenticatedMutation({
  request,
  refresh,
  reauthenticate,
}) {
  try {
    return await request()
  } catch (error) {
    if (error?.status !== 401) {
      throw error
    }

    const refreshed = await refresh()

    if (refreshed?.authenticated) {
      try {
        return await request()
      } catch (retryError) {
        if (retryError?.status !== 401) {
          throw retryError
        }
      }
    } else if (refreshed?.status !== 'ready') {
      throw error
    }

    reauthenticate()
    return null
  }
}
