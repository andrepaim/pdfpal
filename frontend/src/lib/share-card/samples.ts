// Sample cards for /dev/share-cards and test/unit/share-card-layout.test.ts, ported from DistillPod's
// ShareCardRendererTest. Pure data.
import type { CardContent, ShareCardSource } from '../../../../src/shared/share-card'

export type Sample = { name: string; card: CardContent; source: ShareCardSource }

const base = { quoteEdited: false, style: 'quote', look: 'ink' } as const
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
  headline: 'Responsabilidade compartilhada exige comunicação documentada',
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
  headline: 'Counterproductive feedback undermines organisational growth.',
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
