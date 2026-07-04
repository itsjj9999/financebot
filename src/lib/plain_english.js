const REPLACEMENTS = [
  [/\bAI capex and chip supplier rally\b/gi, 'AI data-center spending and chip supplier rally'],
  [/\bhyperscaler capex cut\b/gi, 'big cloud companies spend less on data centers'],
  [/\bhyperscaler capex\b/gi, 'big cloud company spending on data centers'],
  [/\bmemory price rollover\b/gi, 'memory prices start falling'],
  [/\bhyperscalers\b/gi, 'big cloud companies'],
  [/\bhyperscaler\b/gi, 'big cloud company'],
  [/\bcapex\b/gi, 'spending on data centers and equipment'],
  [/\broll over\b/gi, 'start falling'],
  [/\brolled over\b/gi, 'started falling'],
  [/\brollover\b/gi, 'price drop'],
  [/\bmarket color\b/gi, 'background noise'],
  [/\bsector rotation\b/gi, 'money moving from one group of stocks to another'],
  [/\brisk appetite\b/gi, 'willingness to take risk'],
  [/\brisk-off\b/gi, 'investors getting scared'],
  [/\brisk-on\b/gi, 'investors taking more risk'],
  [/\bprice action\b/gi, 'price moves'],
  [/\bvaluation drawdowns\b/gi, 'falling stock prices'],
  [/\bthesis change\b/gi, 'reason to rethink the stock'],
  [/\binvalidation\b/gi, 'what would prove this wrong'],
  [/\bconfirmation\b/gi, 'proof'],
  [/\bmaterial\b/gi, 'important'],
  [/\bdurable\b/gi, 'lasting'],
  [/\bpotentially lasting\b/gi, 'maybe lasting'],
  [/\bheadwind(s)?\b/gi, 'problem$1'],
  [/\btailwind(s)?\b/gi, 'helpful force$1'],
  [/\bexposure\b/gi, 'money at risk'],
  [/\bcredit spread(s)?\b/gi, 'extra yield$1'],
  [/\bbond spread(s)?\b/gi, 'bond extra yield$1'],
  [/\bextra spread\b/gi, 'extra yield'],
  [/\bwide spreads\b/gi, 'high extra yields'],
  [/\bwider spreads\b/gi, 'higher extra yields'],
  [/\bliquidity\b/gi, 'available cash'],
  [/\bfree cash flow\b/gi, 'cash left after spending'],
  [/\bleverage\b/gi, 'debt or bargaining power'],
  [/\bprofit margins\b/gi, 'profit margins'],
  [/\bprofit margin\b/gi, 'profit margin'],
  [/\bmargin pressure\b/gi, 'profit pressure'],
  [/\bguidance\b/gi, 'company forecast'],
  [/\bmultiple(s)?\b/gi, 'valuation$1'],
  [/\bbreadth\b/gi, 'how many stocks are moving'],
  [/\bvolatile\b/gi, 'jumpy'],
  [/\bvolatility\b/gi, 'jumpiness'],
  [/\bcredit-market conditions\b/gi, 'how easy it is to borrow money'],
  [/\bsource claims\b/gi, 'what the video says'],
  [/\blong-term investor\b/gi, 'long-term investor']
]

const FILLER_PATTERNS = [
  /\baccording to the transcript\b/gi,
  /\bthe transcript says\b/gi,
  /\bthe segment argues that\b/gi,
  /\bthe speaker says\b/gi,
  /\bthe video discusses\b/gi,
  /\bthe (?:report|raport) is built from\b/gi,
  /\bthe transcript centers on\b/gi,
  /\bbloomberg hosts describe\b/gi,
  /\buseful signal:?\b/gi,
  /\bthe main signal is\b/gi,
  /\bthe clearest long-term signals are\b/gi,
  /\bfor a long-term investor,?\b/gi
]

export function plainEnglish (value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim()
  for (const pattern of FILLER_PATTERNS) text = text.replace(pattern, '')
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement)
  text = text
    .replace(/\bheavy negative cash left after spending\b/gi, 'heavy cash burn')
    .replace(/\bnegative cash left after spending\b/gi, 'cash burn')
    .replace(/\bcash left after spending improving or worsening\b/gi, 'cash burn improving or worsening')
    .replace(/\bavailable cash, cash\b/gi, 'cash')
    .replace(/\bhigh credit ratings can be defended by\b/gi, 'the bond rating depends on')
    .replace(/\bThe central thesis is that\b/gi, '')
    .replace(/\bA big cloud companies spend less on data centers\b/g, 'Big cloud companies spend less on data centers')
    .replace(/\ba memory prices start falling\b/gi, 'memory prices start falling')
    .replace(/\bfaster-than-expected new supply\b/gi, 'new supply arrives sooner than expected')
    .replace(/,\s*or new supply arrives sooner than expected would change the story\b/gi, ', or new supply arrives sooner than expected')
    .replace(/^for\b/i, 'This matters for')
    .replace(/^this is more\b/i, 'This is more')
    .replace(/\.\./g, '.')
  return text
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[:,.\s-]+/, '')
    .trim()
}

export function plainClean (value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function tidyTruncated (text) {
  let tidied = text
    .trim()
  let previous
  do {
    previous = tidied
    tidied = tidied
      .replace(/\b(the|a|an|was|were|is|are|be|been|being|likely|with|into|from|because|and|or|but|to|of|in|on|by|for|despite|while|which|than|as|if|when|where|relatively)$/i, '')
      .replace(/[,:;.\s-]+$/g, '')
      .trim()
  } while (tidied && tidied !== previous)
  return tidied
}

function wordsOf (text) {
  return text.split(/\s+/).filter(Boolean)
}

function firstSentence (text) {
  const protectedText = text
    .replaceAll('U.S.', 'US_ABBR')
    .replaceAll('U.K.', 'UK_ABBR')
    .replaceAll('U.N.', 'UN_ABBR')
  const sentence = protectedText.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim() || ''
  return sentence
    .replaceAll('US_ABBR', 'U.S.')
    .replaceAll('UK_ABBR', 'U.K.')
    .replaceAll('UN_ABBR', 'U.N.')
}

function truncateAtCleanBoundary (words, maxWords) {
  const clipped = words.slice(0, maxWords).join(' ')
  const boundary = Math.max(
    clipped.lastIndexOf('.'),
    clipped.lastIndexOf('!'),
    clipped.lastIndexOf('?'),
    clipped.lastIndexOf(';')
  )
  if (boundary > -1) return clipped.slice(0, boundary + 1).trim()
  return tidyTruncated(clipped)
}

function shortenComplete (text, maxWords, fallback) {
  if (!text) return fallback
  const words = wordsOf(text)
  if (words.length <= maxWords) return text

  const sentence = firstSentence(text)
  if (sentence) {
    const sentenceWords = wordsOf(sentence)
    if (sentenceWords.length <= Math.max(maxWords + 8, Math.ceil(maxWords * 2.5))) return sentence
  }

  const shortened = truncateAtCleanBoundary(words, maxWords)
  if (shortened && !/\b(the|a|an|was|were|is|are|be|been|being|likely|with|into|from|because|and|or|but|to|of|in|on|by|for|despite|while|which|than|as|if|when|where)$/i.test(shortened)) {
    return /[.!?]$/.test(shortened) ? shortened : `${shortened}.`
  }
  return fallback
}

export function shortClean (value, maxWords = 18, fallback = 'Not clear from the videos.') {
  const text = plainEnglish(value)
  return shortenComplete(text, maxWords, fallback)
}

export function shortPlain (value, maxWords = 18, fallback = 'Not clear from the videos.') {
  const text = plainEnglish(value)
  return shortenComplete(text, maxWords, fallback)
}
