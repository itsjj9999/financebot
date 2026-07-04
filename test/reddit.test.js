import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalUrl, deduplicatePosts, postMatchesSource, titleSimilarity } from '../src/lib/reddit.js'

test('canonicalUrl removes tracking parameters', () => {
  assert.equal(
    canonicalUrl('https://www.reuters.com/world/story/?utm_source=reddit&x=1'),
    'https://reuters.com/world/story?x=1'
  )
})

test('deduplication clusters matching links and similar headlines', () => {
  const clusters = deduplicatePosts([
    { id: 'a', title: 'Fed holds rates steady after meeting', outboundUrl: 'https://example.com/a?utm_source=x', score: 5 },
    { id: 'b', title: 'Fed holds rates steady after its meeting', outboundUrl: 'https://example.com/a', score: 8 }
  ])
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].items.length, 2)
  assert.ok(titleSimilarity(clusters[0].items[0].title, clusters[0].items[1].title) > 0.7)
})

test('source filtering excludes comments-adjacent discussion formats and self posts', () => {
  const source = { externalOnly: true, allowedFlairs: ['News'], skipTitleKeywords: ['daily discussion'] }
  assert.equal(postMatchesSource({ id: '1', title: 'Daily discussion', link_flair_text: 'News', is_self: false, url_overridden_by_dest: 'https://example.com' }, source), false)
  assert.equal(postMatchesSource({ id: '2', title: 'Company reports earnings', link_flair_text: 'News', is_self: true }, source), false)
  assert.equal(postMatchesSource({ id: '3', title: 'Company reports earnings', link_flair_text: 'News', is_self: false, url_overridden_by_dest: 'https://example.com' }, source), true)
})
