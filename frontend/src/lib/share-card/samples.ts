// Sample cards for /dev/share-cards and test/unit/share-card-layout.test.ts, ported from DistillPod's
// ShareCardRendererTest, and a made-up paper page for the Page and Headline frames. Pure data.
import type { CardContent, CardSize, HighlightColor, PageRect, ShareCardSource } from '../../../../src/shared/share-card'

export type Sample = { name: string; card: CardContent; source: ShareCardSource }

const base = { quoteEdited: false, style: 'quote', look: 'ink', crop: null } as const
const takeaways = (...items: Array<[string, string]>) => items.map(([title, detail]) => ({ title, detail }))
const source = (card: CardContent, extra: Partial<ShareCardSource>): ShareCardSource => ({
  version: 1, passage: `${card.quote} ${card.pull}`.trim(), page: 4, rects: [{ x1: 0.12, y1: 0.3, x2: 0.88, y2: 0.33 }], color: 'yellow',
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
  version: 1, passage: `${OWN.phrase}.`, page: 1, context: SAMPLE_PAGE.sections.map(section => section.text).join(' '),
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
