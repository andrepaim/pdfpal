// Sample cards for /dev/share-cards and test/unit/share-card-layout.test.ts, ported from DistillPod's
// ShareCardRendererTest, and a made-up paper page for the Page and Headline frames. Pure data.
import type { CardContent, CardSize, HighlightColor, PageRect, ShareCardSource } from '../../../../src/shared/share-card'
import type { SlideSpec, Stat } from './slides'

export type Sample = { name: string; card: CardContent; source: ShareCardSource }

const base = { quoteEdited: false, style: 'quote', look: 'ink', crop: null, set: null, takeaway: '', paper: null } as const
const takeaways = (...items: Array<[string, string]>) => items.map(([title, detail]) => ({ title, detail }))
const source = (card: CardContent, extra: Partial<ShareCardSource>): ShareCardSource => ({
  version: 1, kind: 'highlight', region: null, items: [], passage: `${card.quote} ${card.pull}`.trim(), page: 4, rects: [{ x1: 0.12, y1: 0.3, x2: 0.88, y2: 0.33 }], color: 'yellow',
  context: '', title: 'Learning from feedback', credit: 'Ericsson and Pool, 2016', url: '', ...extra,
})

export const english: CardContent = {
  ...base,
  quote: 'Feedback is useful when it helps you see the gap between what you tried and what happened.',
  emphasis: 'the gap',
  headline: 'More feedback isn\'t better feedback.',
  pull: 'A specific observation gives you something to change on the next attempt.',
  topic: 'Feedback',
  takeawaysTitle: 'Feedback that actually helps',
  takeaways: takeaways(['Show the gap', 'Between what you tried and what happened.'], ['Be specific', 'Give one thing to change next time.'],
    ['More isn\'t better', 'Timing and the task decide if it lands.']),
}

export const portuguese: CardContent = {
  ...base,
  quote: 'Mas uma interrupção também pode ser necessária: a prioridade deve considerar o trabalho e as outras pessoas, não apenas proteger o foco.',
  emphasis: 'as outras pessoas',
  headline: 'Foco é meio, não fim.',
  pull: 'Agrupar tarefas semelhantes pode reduzir essas transições.',
  topic: 'Foco no trabalho',
  takeawaysTitle: 'Foco a serviço do trabalho',
  takeaways: takeaways(['Agrupe tarefas parecidas', 'Menos trocas de contexto, menos tempo para retomar o ritmo.'],
    ['Algumas pausas são necessárias', 'O trabalho e as outras pessoas também contam.'],
    ['Combine critérios', 'Decida antes o que justifica interromper um período de foco.']),
}

/** Every field at its contract limit, written with long real words rather than filler. */
export const longPortuguese: CardContent = {
  ...base,
  quote: 'A responsabilidade compartilhada é central: quando as organizações convertem reuniões intermináveis em comunicação assíncrona, documentada e auditável, as equipes reconquistam concentração, autonomia e previsibilidade no trabalho cotidiano.',
  emphasis: 'responsabilidade compartilhada é central',
  headline: 'Responsabilidade compartilhada exige comunicação documentada, clara e auditável.',
  pull: 'Quando as organizações documentam claramente decisões, as equipes recuperam concentração, autonomia e previsibilidade no trabalho cotidiano.',
  topic: 'Documentação e confiança',
  takeawaysTitle: 'Responsabilidade compartilhada, sem interrupções',
  takeaways: takeaways(['Documentação assíncrona primeiro', 'Registre decisões importantes para que ninguém dependa de mais reuniões.'],
    ['Interrupções só intencionalmente', 'Combine antecipadamente que situações justificam interromper os colegas.'],
    ['Previsibilidade e transparência!', 'Compartilhe prioridades semanalmente, evitando surpresas desnecessárias.']),
}

export const longEnglish: CardContent = {
  ...base,
  quote: 'Counterproductive feedback usually arrives as uncharacteristically enthusiastic praise, while what people really need is a specific, actionable observation about the distance between their intentions and the consequences of their decisions.',
  emphasis: 'uncharacteristically enthusiastic praise',
  headline: 'Counterproductive feedback quietly undermines organisational learning and trust.',
  pull: 'What people actually need is a specific, actionable observation about the distance between their intentions and their eventual consequences.',
  topic: 'Organisational learning!',
  takeawaysTitle: 'Counterproductive feedback and how to replace it',
  takeaways: takeaways(['Acknowledge the measurable gaps.', 'Describe the distance between intentions and consequences, specifically.'],
    ['Recommend one concrete change...', 'Uncharacteristically enthusiastic generalisations rarely help teammates.'],
    ['Synchronise timing with the task', 'Feedback delivered immediately after an important attempt is remembered.']),
}

/** Contract-valid text with one word wider than the column at the 60% floor in some sizes. */
export const longWordPortuguese: CardContent = {
  ...longPortuguese,
  headline: 'Reuniões desproporcionalmente longas custam o foco da equipe',
  takeawaysTitle: 'Desproporcionalmente: três ideias para reuniões.',
  takeaways: [{ title: 'Desproporcionalmente demoradas', detail: longPortuguese.takeaways[0]!.detail }, ...longPortuguese.takeaways.slice(1)],
}

export const longWordEnglish: CardContent = {
  ...longEnglish,
  headline: 'Pseudopseudohypoparathyroidism is rarer than people suspect.',
  takeawaysTitle: 'Pseudopseudohypoparathyroidism, briefly put',
  takeaways: [{ title: 'A pseudopseudohypoparathyroidism', detail: longEnglish.takeaways[0]!.detail }, ...longEnglish.takeaways.slice(1)],
}

export const minimal: CardContent = {
  ...base, quote: 'Rest more.', emphasis: '', headline: 'Less is more.', pull: '', topic: '', takeawaysTitle: 'Three notes',
  takeaways: takeaways(['Rest', 'Sleep well.'], ['Walk', 'Every day.'], ['Read', 'A little.']),
}

export const LONG_TITLE = 'The Extraordinarily Long-Running Conversation About Organisational Psychology and Leadership in Distributed Teams'
export const LONG_CREDIT = 'Anastasia Konstantinopoulou-Vanderbilt, Bartholomew Featherstonehaugh and colleagues, 2026'

export const SAMPLES: Sample[] = [
  { name: 'en', card: english, source: source(english, {}) },
  { name: 'pt', card: portuguese, source: source(portuguese, { title: 'Atenção no trabalho', credit: 'Silva e Souza, 2024', color: 'pink' }) },
  { name: 'max-en', card: longEnglish, source: source(longEnglish, { title: LONG_TITLE, credit: LONG_CREDIT, page: 1234, color: 'green' }) },
  { name: 'max-pt', card: longPortuguese, source: source(longPortuguese, { title: LONG_TITLE, credit: LONG_CREDIT, page: 87, color: 'blue' }) },
  { name: 'longword-en', card: longWordEnglish, source: source(longWordEnglish, { color: 'blue' }) },
  { name: 'longword-pt', card: longWordPortuguese, source: source(longWordPortuguese, { title: 'Atenção no trabalho', credit: '', color: 'green' }) },
  { name: 'min', card: minimal, source: source(minimal, { title: '', credit: '', page: 1 }) },
]

// ── Page and Headline frames ───────────────────────────────────────────────────────────────────────────────────────
// The samples page draws SAMPLE_PAGE on a canvas, in one column or two, finds each mark's phrase in it, and crops it
// as pageCrop crops a PDF page, its lines given as text runs as pdf.js gives them. The paper, its authors and its
// numbers are invented.

export const SAMPLE_PAGE = {
  /** US Letter, in points. */
  width: 612, height: 792, margin: 72,
  journal: 'Journal of Practice Research · 2025 · Vol. 14, No. 3',
  title: 'Specific feedback speeds up skill learning: a field study of 1,204 practice sessions',
  authors: 'Claire Moreau¹, Jonas Lindqvist², Ana Ribeiro¹',
  affiliations: '¹Institute for Learning Research · ²Department of Psychology',
  sections: [
    { heading: 'Abstract', text: 'Practice improves performance only when learners can see what to change. We followed 312 music and language students over one semester and recorded 1,204 practice sessions, each ending with either general praise or a specific observation about the gap between the attempt and its result. Students who received specific feedback improved 41% more on blind-rated tests than those who received praise, and the difference grew over the semester. More feedback was not better: beyond three comments per session, gains levelled off and students reported lower motivation. Timing mattered as well; feedback given within ten minutes of an attempt was remembered twice as often a week later. The effect held across instruments, languages and prior skill levels.' },
    { heading: '1  Introduction', text: 'Feedback is among the most studied influences on learning, yet its effects vary widely. Reviews report average gains, but a large share of feedback interventions lower performance. One explanation is that much feedback describes the learner rather than the task: it praises, encourages or grades without pointing to anything that could be done differently. In this study we ask whether the content of feedback, rather than its amount, explains who improves. We compare two kinds of comment that teachers give every day and measure their effect on skill, memory and motivation over a full semester of ordinary practice.' },
    { heading: '2  Method', text: 'Students were recruited from four schools and assigned at random to teachers trained in one of the two styles. Each session was recorded, transcribed and coded by two raters who did not know the condition. Skill was measured at the start, the middle and the end of the semester by judges who heard anonymous recordings.' },
    { heading: '3  Results', text: 'Both groups practised for about the same time each week, and attendance did not differ between the conditions. By the middle of the semester the students who heard specific comments had already pulled ahead, and the gap widened in the second half. Teachers in the specific condition gave fewer comments per session than those in the praise condition, yet their students recalled more of them a week later. Students with the least prior skill gained the most, which suggests that a clear pointer to the next change matters most when there is the most to change.' },
  ],
} as const

export type FrameMark = { phrase: string; color: HighlightColor }
export type PageFrame = {
  name: string
  /** The page in two columns, the sections after the first two in the right one. */
  columns?: 2
  style: 'page' | 'headline'
  size: CardSize
  extraLines: 0 | 1 | 3
  /** The reader's crop, as page fractions; null means automatic. */
  crop: PageRect | null
  /** Every highlight on the page; the first is the post's own. */
  marks: FrameMark[]
  card: CardContent
  source: Omit<ShareCardSource, 'rects' | 'color'>
}

const OWN: FrameMark = { phrase: 'Students who received specific feedback improved 41% more on blind-rated tests than those who received praise', color: 'yellow' }
const RIGHT: FrameMark = { phrase: 'coded by two raters who did not know the condition', color: 'yellow' }
const OTHERS: FrameMark[] = [
  { phrase: 'More feedback was not better', color: 'green' },
  { phrase: 'within ten minutes of an attempt', color: 'blue' },
  { phrase: 'a large share of feedback interventions lower performance', color: 'pink' },
]
const pageCard = (headline: string, topic = 'Learning science'): CardContent => ({ ...english, quote: `${OWN.phrase}.`, emphasis: '', headline, topic, pull: '' })
const pageSource: PageFrame['source'] = {
  version: 1, kind: 'highlight', region: null, items: [], passage: `${OWN.phrase}.`, page: 1, context: SAMPLE_PAGE.sections.map(section => section.text).join(' '),
  title: 'Specific feedback speeds up skill learning', credit: 'Moreau, Lindqvist and Ribeiro, 2025', url: '',
}
/** The title, authors and abstract, as people crop them for LinkedIn and Instagram. */
const ABSTRACT: PageRect = { x1: 0.07, y1: 0.065, x2: 0.93, y2: 0.5 }
const WHOLE: PageRect = { x1: 0, y1: 0, x2: 1, y2: 1 }
const headline = 'Specific feedback beat praise by 41%.'

export const PAGE_FRAMES: PageFrame[] = [
  { name: 'page-fit-x', style: 'page', size: 'fit', extraLines: 1, crop: null, marks: [OTHERS[0]!, OWN, OTHERS[1]!], card: pageCard(headline), source: pageSource },
  { name: 'page-fit-linkedin', style: 'page', size: 'fit', extraLines: 3, crop: null, marks: [OWN, ...OTHERS], card: pageCard(headline), source: pageSource },
  { name: 'page-fit-abstract', style: 'page', size: 'fit', extraLines: 3, crop: ABSTRACT, marks: [OWN, ...OTHERS], card: pageCard(headline), source: pageSource },
  { name: 'page-fit-whole', style: 'page', size: 'fit', extraLines: 3, crop: WHOLE, marks: [OWN, ...OTHERS], card: pageCard(headline, ''), source: { ...pageSource, title: LONG_TITLE, credit: LONG_CREDIT, page: 1234 } },
  { name: 'page-feed', style: 'page', size: 'feed', extraLines: 3, crop: null, marks: [OWN, ...OTHERS], card: pageCard(headline), source: pageSource },
  { name: 'page-story', style: 'page', size: 'story', extraLines: 3, crop: null, marks: [OWN, ...OTHERS], card: pageCard(headline), source: pageSource },
  { name: 'headline-feed', style: 'headline', size: 'feed', extraLines: 3, crop: null, marks: [OWN, ...OTHERS], card: pageCard(headline), source: pageSource },
  { name: 'headline-story', style: 'headline', size: 'story', extraLines: 3, crop: null, marks: [OWN, ...OTHERS], card: pageCard(headline), source: pageSource },
  { name: 'headline-feed-abstract-max', style: 'headline', size: 'feed', extraLines: 3, crop: ABSTRACT, marks: [OWN, ...OTHERS], card: pageCard(longEnglish.headline, longEnglish.topic), source: pageSource },
  { name: 'headline-story-abstract-max', style: 'headline', size: 'story', extraLines: 3, crop: ABSTRACT, marks: [OWN, ...OTHERS], card: pageCard(longPortuguese.headline, longPortuguese.topic), source: { ...pageSource, title: LONG_TITLE, credit: LONG_CREDIT } },
  { name: 'headline-feed-whole-min', style: 'headline', size: 'feed', extraLines: 0, crop: WHOLE, marks: [OWN], card: pageCard(minimal.headline, ''), source: { ...pageSource, title: '', credit: '' } },
  { name: 'page-fit-x-columns', columns: 2, style: 'page', size: 'fit', extraLines: 1, crop: null, marks: [OTHERS[0]!, OWN, OTHERS[1]!], card: pageCard(headline), source: pageSource },
  { name: 'headline-feed-columns', columns: 2, style: 'headline', size: 'feed', extraLines: 3, crop: null, marks: [RIGHT, OTHERS[0]!], card: { ...pageCard(headline), quote: `${RIGHT.phrase}.` }, source: { ...pageSource, passage: `${RIGHT.phrase}.` } },
  { name: 'headline-feed-word', style: 'headline', size: 'feed', extraLines: 0, crop: null, marks: [OWN, OTHERS[0]!], card: pageCard(longWordEnglish.headline), source: pageSource },
]

// ── Carousels ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Slides for one post made from several highlights on SAMPLE_PAGE: the longest texts the contract allows, and short
// ones. Points crop the page around their highlight: automatically, a short reader's crop and a tall one.

export type CarouselSample = {
  name: string
  slides: SlideSpec[]
  /**
   * One per point, in order: the highlight on the made-up page and the reader's crop: null for automatic, 'tight' for
   * a reader's crop of just the highlight's lines across the column (a short strip).
   */
  items: Array<{ mark: FrameMark; crop: PageRect | 'tight' | null }>
  source: PageFrame['source']
}

const CAROUSEL_ITEMS: CarouselSample['items'] = [
  { mark: OWN, crop: null },
  { mark: OTHERS[0]!, crop: 'tight' },
  { mark: OTHERS[1]!, crop: { x1: 0.08, y1: 0.06, x2: 0.92, y2: 0.62 } },
]
const carouselSlides = (topic: string, text: { cover: string; study: string; points: string[]; takeaway: string; limitations: string }): SlideSpec[] => [
  { kind: 'cover', kicker: topic, headline: text.cover },
  { kind: 'study', kicker: 'The study', text: text.study },
  ...text.points.map((headline, item): SlideSpec => ({ kind: 'point', kicker: topic, headline, item })),
  { kind: 'takeaway', kicker: 'The takeaway', text: text.takeaway },
  { kind: 'limitations', kicker: 'Limits', text: text.limitations },
]

/** Every text at its limit: cover 80, study 160, a point's claim 70, takeaway 140, limitations 160. */
export const CAROUSEL_MAX: CarouselSample = {
  name: 'carousel-max', items: CAROUSEL_ITEMS, source: { ...pageSource, title: LONG_TITLE, credit: LONG_CREDIT },
  slides: carouselSlides('Organisational learning!', {
    cover: longEnglish.headline,
    study: 'Over one semester, 312 music and language students were followed through 1,204 recorded practice sessions, each one ending in broad praise or a specific remark.',
    points: ['Specific comments lifted blind-rated test scores 41% more than praise.', 'Beyond three comments in one session, the gains levelled off entirely.',
      'Feedback given within ten minutes was remembered twice as often later.'],
    takeaway: 'Give fewer comments, and make each one point at the gap between what the learner tried and what then happened, soon after each attempt ends.',
    limitations: 'Students came from four schools in a single country; their teachers knew which style they had been trained in, and motivation was only self-reported at the end.',
  }),
}

export const CAROUSEL_SHORT: CarouselSample = {
  name: 'carousel-short', items: CAROUSEL_ITEMS, source: pageSource,
  slides: carouselSlides('Learning science', {
    cover: 'Praise feels good. Specifics teach.',
    study: '312 students, 1,204 practice sessions.',
    points: ['41% more gain.', 'More is not better.', 'Sooner sticks.'],
    takeaway: 'Fewer, specific comments, soon.',
    limitations: 'One country; self-reported motivation.',
  }),
}

// ── Three cards for one highlight (the Carousel style) ─────────────────────────────────────────────────────────────

export type PostCarouselSample = {
  name: string
  slides: SlideSpec[]
  /** The post's own highlight on the made-up page. */
  mark: FrameMark
  /** The page slide's crops: automatic, a short reader's crop of the highlight's lines, and the whole page. */
  crops: Record<'auto' | 'short' | 'tall', PageRect | 'tight' | null>
  source: PageFrame['source']
}

/** The other highlights on the made-up page, drawn as marks around the post's own. */
export const OTHERS_ON_PAGE: FrameMark[] = OTHERS

/** Cover, the page with the highlight, and the takeaway; the page slide's fallback is a quote at its longest. */
export const POST_CAROUSEL: PostCarouselSample = {
  name: 'post-carousel', mark: OWN, source: pageSource,
  crops: { auto: null, short: 'tight', tall: WHOLE },
  slides: [
    { kind: 'cover', kicker: 'Learning science', headline },
    { kind: 'page', kicker: 'Learning science', fallback: longEnglish.quote },
    { kind: 'takeaway', kicker: 'The takeaway', text: 'Point at the gap between what the learner tried and what happened, not at the learner.' },
  ],
}

// ── Share the paper ────────────────────────────────────────────────────────────────────────────────────────────────

export type PaperCarouselSample = {
  name: string
  slides: SlideSpec[]
  /** The lead's crop of the made-up page: its title, authors and abstract. */
  crop: PageRect
  source: PageFrame['source']
}

/** Lead, question, method, two results and the takeaway, every text at its limit. */
export const PAPER_CAROUSEL: PaperCarouselSample = {
  name: 'paper-carousel', crop: ABSTRACT, source: { ...pageSource, title: LONG_TITLE, credit: LONG_CREDIT },
  slides: [
    { kind: 'lead', kicker: 'Organisational learning!', headline: longEnglish.headline, fallback: longEnglish.headline },
    { kind: 'question', kicker: 'The question', text: 'Does a specific comment about the gap between an attempt and its result help music and language learners improve more than general praise does, over a semester?' },
    { kind: 'method', kicker: 'The method', text: 'Over one semester, 312 music and language students were followed through 1,204 recorded practice sessions, each one ending in broad praise or a specific remark.' },
    { kind: 'result', kicker: 'Result 1', text: '41% higher gains on blind-rated tests for the students who heard specific comments; the gap between the groups also widened during the term.', item: 0 },
    { kind: 'result', kicker: 'Result 2', text: 'Feedback given within ten minutes of an attempt was remembered twice as often a week later as feedback that came at the very end of lessons.', item: 1 },
    { kind: 'takeaway', kicker: 'The takeaway', text: 'Give fewer comments, and make each one point at the gap between what the learner tried and what then happened, soon after each attempt ends.' },
  ],
}

/** One result, short texts: five slides. */
export const PAPER_CAROUSEL_FIVE: PaperCarouselSample = {
  name: 'paper-carousel-five', crop: ABSTRACT, source: pageSource,
  slides: [
    { kind: 'lead', kicker: 'Learning science', headline: 'Specific feedback beat praise by 41%.', fallback: 'Specific feedback beat praise by 41%.' },
    { kind: 'question', kicker: 'The question', text: 'Does specific feedback beat praise?' },
    { kind: 'method', kicker: 'The method', text: '312 students, 1,204 sessions, one semester.' },
    { kind: 'result', kicker: 'The result', text: '41% higher test gains with specific comments.', item: 0 },
    { kind: 'takeaway', kicker: 'The takeaway', text: 'Fewer, specific comments, soon.' },
  ],
}

// ── Decks: numbers as numbers (stage 6) ────────────────────────────────────────────────────────────────────────────
// The same three kinds of post twice: with the numbers their text gives, and without any, so both can be judged.
// Picture slides (page, point, lead) are drawn from the made-up page as above. `items` say which highlight each
// point slide shows; a page or lead slide shows the post's own highlight.

export type DeckSample = { name: string; slides: SlideSpec[]; source: PageFrame['source']; items: FrameMark[] }

const TOPIC = 'Learning science'
const strip = (slides: SlideSpec[]): SlideSpec[] => slides.map(slide => {
  const { stat: _stat, stats: _stats, rows: _rows, ...rest } = slide as SlideSpec & { stat?: unknown; stats?: unknown; rows?: unknown }
  return rest as SlideSpec
})
const STUDY_STATS: Stat[] = [{ value: '312', label: 'music and language students' }, { value: '1,204', label: 'recorded practice sessions' }, { value: '1 semester', label: 'of ordinary weekly lessons' }]
const COVER_STAT: Stat = { value: '41%', label: 'higher gains on blind-rated tests than praise' }

/** A highlight post's three cards: the hook with its key number, the page, the takeaway. */
export const DECK_POST: DeckSample = {
  name: 'deck-post', source: pageSource, items: [OWN],
  slides: [
    { kind: 'cover', kicker: TOPIC, headline: 'Specific feedback beats praise, and the gap keeps growing', stat: COVER_STAT },
    { kind: 'page', kicker: TOPIC, fallback: `${OWN.phrase}.` },
    { kind: 'takeaway', kicker: 'The takeaway', text: 'Point at the gap between what the learner tried and what happened, not at the learner.' },
  ],
}

/** A carousel of three highlights: cover with its number, the study in tiles, three points, takeaway, limits. */
export const DECK_SET: DeckSample = {
  name: 'deck-set', source: pageSource, items: [OWN, OTHERS[0]!, OTHERS[1]!],
  slides: [
    { kind: 'cover', kicker: TOPIC, headline: 'What makes feedback work: three findings from one field study', stat: COVER_STAT },
    { kind: 'study', kicker: 'The study', text: 'Students were followed for a semester; each session ended with general praise or one specific comment.', stats: STUDY_STATS },
    { kind: 'point', kicker: TOPIC, headline: 'Specific comments beat praise on blind-rated tests.', item: 0 },
    { kind: 'point', kicker: TOPIC, headline: 'More than three comments a session stopped helping.', item: 1 },
    { kind: 'point', kicker: TOPIC, headline: 'Feedback within ten minutes was remembered twice as often.', item: 2 },
    { kind: 'takeaway', kicker: 'The takeaway', text: 'Fewer comments, each one specific, given soon after the attempt.' },
    { kind: 'limitations', kicker: 'Limits', text: 'One country, teachers who knew their condition, and motivation that was self-reported.' },
  ],
}

/** A paper's deck: lead, question, method in tiles, a comparison, one key number, takeaway. */
export const DECK_PAPER: DeckSample = {
  name: 'deck-paper', source: pageSource, items: [OWN],
  slides: [
    { kind: 'lead', kicker: TOPIC, headline: 'Specific feedback speeds up skill learning', fallback: 'Specific feedback speeds up skill learning' },
    { kind: 'question', kicker: 'The question', text: 'Does a specific comment help learners improve more than general praise?' },
    { kind: 'method', kicker: 'The method', text: 'Teachers were trained in one style each; judges rated anonymous recordings at the start, middle and end of the term.',
      stats: [{ value: '312', label: 'music and language students' }, { value: '1,204', label: 'recorded practice sessions' }, { value: '4', label: 'schools' }, { value: '1 semester', label: 'of ordinary weekly lessons' }] },
    { kind: 'result', kicker: 'Result 1', text: 'Specific comments given right away produced the largest gains on blind-rated tests.', item: 0,
      stat: { value: '41%', label: 'gain' }, rows: [{ label: 'Specific, right away', value: '41%' }, { label: 'Specific, end of lesson', value: '29%' }, { label: 'Praise, right away', value: '12%' }, { label: 'Praise, end of lesson', value: '9%' }] },
    { kind: 'result', kicker: 'Result 2', text: 'Feedback given within ten minutes of an attempt was remembered twice as often a week later.', item: 1,
      stat: { value: '2x', label: 'as often remembered a week later' }, rows: [] },
    { kind: 'takeaway', kicker: 'The takeaway', text: 'Fewer comments, each one specific, given soon after the attempt.' },
  ],
}

/** The same three decks without a single number to show. */
export const DECK_POST_PLAIN: DeckSample = { ...DECK_POST, name: 'deck-post-plain', slides: strip(DECK_POST.slides) }
export const DECK_SET_PLAIN: DeckSample = { ...DECK_SET, name: 'deck-set-plain', slides: strip(DECK_SET.slides) }
export const DECK_PAPER_PLAIN: DeckSample = { ...DECK_PAPER, name: 'deck-paper-plain', slides: strip(DECK_PAPER.slides) }

/** Every new layout at the contract's limits, and the edge cases: one stat, a headline that holds its number. */
export const DECK_LIMITS: SlideSpec[] = [
  { kind: 'method', kicker: 'The method', text: PAPER_CAROUSEL.slides[2]!.kind === 'method' ? PAPER_CAROUSEL.slides[2]!.text : '',
    stats: [{ value: '12,345.67 ms', label: 'music and language students in four city schools' }, { value: '19,876.54 ms', label: 'recorded practice sessions, over one entire term' },
      { value: '11,024.00 ms', label: 'teachers, each one trained in one feedback style' }, { value: '10,998.76 ms', label: 'of ordinary weekly practice, rated blind by jury' }] },
  { kind: 'result', kicker: 'Result 1', text: PAPER_CAROUSEL.slides[3]!.kind === 'result' ? PAPER_CAROUSEL.slides[3]!.text : '', item: 0, stat: null,
    rows: [{ label: 'Specific comment, right away', value: '12,345.67 ms' }, { label: 'Specific comments at the end', value: '19,876.54 ms' },
      { label: 'Praise only, right after it.', value: '11,024.00 ms' }, { label: 'Praise only, at lesson’s end', value: '10,998.76 ms' }] },
  { kind: 'result', kicker: 'Result 2', text: PAPER_CAROUSEL.slides[4]!.kind === 'result' ? PAPER_CAROUSEL.slides[4]!.text : '', item: 1,
    stat: { value: '12,345.67 ms', label: 'higher gain on blind-rated tests than praise did' }, rows: [] },
  { kind: 'cover', kicker: 'Organisational learning!', headline: 'Specific feedback beat praise by a wide margin over a semester of real practice.',
    stat: { value: '12,345.67 ms', label: 'higher gain on blind-rated tests than praise did' } },
  { kind: 'study', kicker: 'The study', text: CAROUSEL_MAX.slides[1]!.kind === 'study' ? CAROUSEL_MAX.slides[1]!.text : '', stats: [{ value: '1,204', label: 'recorded practice sessions, over one entire term' }] },
  { kind: 'cover', kicker: TOPIC, headline: 'Specific feedback lifted test gains by 41% over praise', stat: { value: '41%', label: 'higher gains' } },
  { kind: 'result', kicker: 'Result 1', text: 'Specific comments, given right away, gave the largest gains.', item: 0, stat: { value: '41%', label: 'gain' },
    rows: [{ label: 'Specific', value: '41%' }, { label: 'Praise', value: '9–12%' }, { label: 'None', value: '−2%' }] },
]
