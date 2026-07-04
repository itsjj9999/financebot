const TRACKING_PARAMETERS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'ref', 'referrer', 'source', 'share'
])

export function canonicalUrl (value = '') {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    return url.toString()
  } catch {
    return ''
  }
}

export function normalizeTitle (value = '') {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(?:breaking|update|live|analysis|opinion)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleTokens (value) {
  return new Set(normalizeTitle(value).split(' ').filter(token => token.length > 2))
}

export function titleSimilarity (left, right) {
  const a = titleTokens(left)
  const b = titleTokens(right)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / new Set([...a, ...b]).size
}

export function postMatchesSource (post, source) {
  if (!post?.id || !post?.title || post.stickied) return false
  if (source.externalOnly && (post.is_self || !post.url_overridden_by_dest)) return false
  const flair = String(post.link_flair_text || '').trim().toLowerCase()
  if (source.allowedFlairs?.length && !source.allowedFlairs.some(item => item.toLowerCase() === flair)) return false
  const title = normalizeTitle(post.title)
  return !(source.skipTitleKeywords || []).some(keyword => title.includes(normalizeTitle(keyword)))
}

export function deduplicatePosts (posts, threshold = 0.72) {
  const clusters = []
  for (const post of posts) {
    const url = canonicalUrl(post.outboundUrl)
    const match = clusters.find(cluster =>
      cluster.ids.has(post.id) ||
      (url && cluster.urls.has(url)) ||
      titleSimilarity(cluster.title, post.title) >= threshold
    )
    if (match) {
      match.items.push(post)
      match.ids.add(post.id)
      if (url) match.urls.add(url)
      if ((post.score || 0) > (match.score || 0)) {
        match.title = post.title
        match.score = post.score || 0
        match.primary = post
      }
      continue
    }
    clusters.push({
      title: post.title,
      score: post.score || 0,
      primary: post,
      items: [post],
      ids: new Set([post.id]),
      urls: new Set(url ? [url] : [])
    })
  }
  return clusters
}

export async function redditAccessToken ({ clientId, clientSecret, userAgent, fetchImpl = fetch }) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const response = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent
    },
    body: 'grant_type=client_credentials'
  })
  if (!response.ok) throw new Error(`Reddit OAuth failed with HTTP ${response.status}.`)
  const payload = await response.json()
  if (!payload.access_token) throw new Error('Reddit OAuth returned no access token.')
  return payload.access_token
}

function sleep (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function redditListing ({ subreddit, after, token, userAgent, fetchImpl = fetch }) {
  const url = new URL(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new`)
  url.searchParams.set('limit', '100')
  url.searchParams.set('raw_json', '1')
  if (after) url.searchParams.set('after', after)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent': userAgent
      }
    })
    if (response.ok) return response.json()
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === 3) {
      throw new Error(`Reddit r/${subreddit} request failed with HTTP ${response.status}.`)
    }
    const retryAfter = Number(response.headers.get('retry-after'))
    const fallbackSeconds = [1, 3, 10][attempt]
    const seconds = Number.isFinite(retryAfter) ? Math.min(retryAfter, 30) : fallbackSeconds
    await sleep(seconds * 1000)
  }
}
