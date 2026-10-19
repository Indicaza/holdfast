import { useEffect } from 'react'

const githubUrl = 'https://github.com/Indicaza/holdfast'
const siteName = 'Guildweaver'

function upsertMeta(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`)

  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }

  element.setAttribute('content', content)
}

function upsertCanonical(href) {
  let element = document.head.querySelector('link[rel="canonical"]')

  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }

  element.setAttribute('href', href)
}

function upsertStructuredData(data) {
  let element = document.head.querySelector('#holdfast-structured-data')

  if (!element) {
    element = document.createElement('script')
    element.id = 'holdfast-structured-data'
    element.type = 'application/ld+json'
    document.head.appendChild(element)
  }

  element.textContent = JSON.stringify(data)
}

// home marks the site's front page (WebSite + Guildweaver organization);
// organization names a guild whose home page this is.
function SEO({ title, description, path, robots, home = false, organization = null }) {
  useEffect(() => {
    const origin = window.location.origin
    const url = new URL(path, origin).href
    const homeUrl = new URL('/', origin).href
    const websiteId = `${homeUrl}#website`
    const organizationId = `${homeUrl}#organization`

    document.title = title

    upsertMeta('name', 'description', description)
    upsertMeta('name', 'robots', robots)
    upsertMeta('name', 'googlebot', robots)

    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:site_name', siteName)
    upsertMeta('property', 'og:title', title)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:url', url)

    upsertMeta('name', 'twitter:card', 'summary')
    upsertMeta('name', 'twitter:title', title)
    upsertMeta('name', 'twitter:description', description)

    upsertCanonical(url)

    const webPage = {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: title,
      description,
      isPartOf: {
        '@id': websiteId,
      },
      inLanguage: 'en-US',
    }

    const graph = [webPage]

    if (home) {
      graph.unshift(
        {
          '@type': 'WebSite',
          '@id': websiteId,
          url: homeUrl,
          name: siteName,
          description,
          publisher: {
            '@id': organizationId,
          },
          inLanguage: 'en-US',
        },
        {
          '@type': 'Organization',
          '@id': organizationId,
          name: siteName,
          url: homeUrl,
          description,
          sameAs: [githubUrl],
        },
      )
    } else if (organization) {
      graph.push({
        '@type': 'Organization',
        '@id': `${url}#organization`,
        name: organization,
        url,
        description,
      })
    }

    upsertStructuredData({
      '@context': 'https://schema.org',
      '@graph': graph,
    })
  }, [description, home, organization, path, robots, title])

  return null
}

export default SEO
