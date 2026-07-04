#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { paths, root } from './lib/project.js'
import { dateInTimeZone, reportDate, validateReportDate } from './lib/time.js'
import {
  canonicalUrl,
  deduplicatePosts,
  postMatchesSource,
  redditAccessToken,
  redditListing
} from './lib/reddit.js'

function parseArgs (argv) {
  const options = { date: reportDate(), maxClusters: 15 }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--date') options.date = validateReportDate(argv[++index])
    else if (value === '--max-clusters') options.maxClusters = Number(argv[++index])
    else if (value === '--help' || value === '-h') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!Number.isInteger(options.maxClusters) || options.maxClusters < 1 || options.maxClusters > 100) {
    throw new Error('--max-clusters must be a whole number from 1 to 100.')
  }
  return options
}

function credentials () {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim()
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim()
  const userAgent = process.env.REDDIT_USER_AGENT?.trim()
  if (!clientId || !clientSecret || !userAgent) {
    throw new Error('Reddit credentials are missing. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT after Reddit approves Data API access.')
  }
  return { clientId, clientSecret, userAgent }
}

function safeSlug (value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
}

function markdownForCluster (cluster, date) {
  const primary = cluster.primary
  const subreddits = [...new Set(cluster.items.map(item => `r/${item.subreddit}`))]
  const appearances = cluster.items
    .map(item => `- r/${item.subreddit}: ${item.permalink}`)
    .join('\n')
  return `# ${primary.title}

## Source information

- **Channel:** Reddit (${subreddits.join(', ')})
- **Published:** ${date}
- **Caption source:** reddit-headline-and-post-metadata
- **Source type:** reddit
- **Video:** ${primary.permalink}
- **Video ID:** reddit-${primary.id}
- **Outbound URL:** ${primary.outboundUrl || 'none'}

> **Evidence restriction:** This record contains Reddit post headlines and metadata only. No comments or linked webpages were collected. Treat the headline as an unverified signal unless another gathered source independently confirms it.

## Reddit appearances

${appearances}

## Post content

**Headline:** ${primary.title}

${primary.selftext ? `**Self-post text:** ${primary.selftext}` : 'No self-post text was collected.'}
`
}

async function collectSource (source, date, token, userAgent) {
  const posts = []
  let after = null
  for (let page = 0; page < 10; page += 1) {
    const payload = await redditListing({ subreddit: source.subreddit, after, token, userAgent })
    const children = payload?.data?.children || []
    if (!children.length) break
    let reachedOlder = false
    for (const child of children) {
      const post = child.data
      const postDate = dateInTimeZone(new Date(Number(post.created_utc) * 1000))
      if (postDate < date) {
        reachedOlder = true
        continue
      }
      if (postDate !== date || !postMatchesSource(post, source)) continue
      posts.push({
        id: post.id,
        title: post.title,
        selftext: source.externalOnly ? '' : String(post.selftext || '').trim(),
        subreddit: post.subreddit,
        flair: post.link_flair_text || '',
        createdUtc: post.created_utc,
        score: post.score || 0,
        outboundUrl: canonicalUrl(post.url_overridden_by_dest || ''),
        permalink: `https://www.reddit.com${post.permalink}`
      })
    }
    after = payload?.data?.after
    if (reachedOlder || !after) break
  }
  return posts
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node ./src/sync_reddit.js [--date YYYY-MM-DD] [--max-clusters 15]')
    return
  }
  const auth = credentials()
  const sources = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
    .filter(source => source.type === 'reddit')
  if (!sources.length) {
    console.log('No Reddit sources are configured in sources.json.')
    return
  }

  const token = await redditAccessToken(auth)
  const collected = []
  const failures = []
  for (const source of sources) {
    try {
      const posts = await collectSource(source, options.date, token, auth.userAgent)
      collected.push(...posts)
      console.log(`r/${source.subreddit}: ${posts.length} same-day factual candidate(s).`)
    } catch (error) {
      failures.push({ source: source.name, error: error.message })
      console.error(`r/${source.subreddit}: ${error.message}`)
    }
  }

  const clusters = deduplicatePosts(collected)
    .sort((a, b) => b.items.length - a.items.length || b.score - a.score)
    .slice(0, options.maxClusters)
  const rawFolder = resolve(paths.rawText, 'reddit', options.date)
  const runFolder = resolve(paths.dailyBundles, options.date)
  await mkdir(rawFolder, { recursive: true })
  await mkdir(runFolder, { recursive: true })
  const created = []
  const packets = new Map(sources.map(source => [source.slug, []]))

  for (const cluster of clusters) {
    const id = `reddit-${cluster.primary.id}`
    const destination = join(rawFolder, `${safeSlug(cluster.title)}-${id}.md`)
    const markdown = markdownForCluster(cluster, options.date)
    await writeFile(destination, markdown, 'utf8')
    const record = {
      id,
      source: `Reddit (${[...new Set(cluster.items.map(item => `r/${item.subreddit}`))].join(', ')})`,
      sourceSlug: 'reddit',
      sourceType: 'reddit',
      title: cluster.title,
      url: cluster.primary.permalink,
      published: options.date,
      transcript: destination
    }
    created.push(record)
    for (const item of cluster.items) {
      const source = sources.find(candidate => candidate.subreddit.toLowerCase() === item.subreddit.toLowerCase())
      if (source) packets.get(source.slug).push(markdown)
    }
  }

  for (const source of sources) {
    const items = [...new Set(packets.get(source.slug))]
    if (!items.length) continue
    await writeFile(join(runFolder, `${source.slug}-source.md`), [
      `# Reddit daily source packet - ${options.date}`,
      '',
      'Reddit is a cross-check source. Headlines are unverified unless confirmed by another gathered source. Comments and linked webpages were not collected.',
      '',
      ...items.flatMap(item => ['---', '', item, ''])
    ].join('\n'), 'utf8')
  }

  const summary = join(runFolder, 'reddit-sync-summary.json')
  await writeFile(summary, JSON.stringify({
    date: options.date,
    generatedAt: new Date().toISOString(),
    collected: collected.length,
    clusters: clusters.length,
    created,
    failures
  }, null, 2), 'utf8')
  console.log(`Reddit sync summary: ${summary}`)
  if (failures.length) process.exitCode = 1
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
