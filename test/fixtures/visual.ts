import type { VisualDefinitionV1, VisualDefinitionV2 } from '../../src/shared/visual.js'
export const visualFixture: VisualDefinitionV1 = {
  version: 1, title: 'How attention builds context', summary: 'A word borrows information from other words according to their relevance.',
  steps: [
    { title: 'Start with a word', caption: 'The same word can mean different things in different sentences.', explanation: 'The word bank needs context to distinguish a financial institution from the edge of a river.', basis: 'illustration', referenceIds: [],
      scene: { height: 280, elements: [
        { type: 'node', id: 'bank', x: 20, y: 90, width: 130, height: 80, label: 'bank', color: 'indigo', shape: 'box', detail: 'The token being updated. Its color stays indigo in every step.' },
        { type: 'node', id: 'river', x: 210, y: 90, width: 130, height: 80, label: 'river', color: 'teal', shape: 'box', detail: 'A nearby word can help disambiguate bank.' },
      ] } },
    { title: 'Give relevant context more weight', caption: 'A larger attention weight means a stronger contribution to the update.', explanation: 'Attention scores depend on learned query and key representations. Softmax turns these scores into nonnegative weights that sum to one for this query. The connection is illustrative, not a measured weight.', basis: 'illustration', referenceIds: [],
      scene: { height: 280, elements: [
        { type: 'node', id: 'bank', x: 20, y: 90, width: 130, height: 80, label: 'bank', color: 'indigo', shape: 'box', detail: 'Bank receives a weighted combination of value vectors.' },
        { type: 'node', id: 'river', x: 210, y: 90, width: 130, height: 80, label: 'river', color: 'teal', shape: 'box', detail: 'This context suggests the edge of a river.' },
        { type: 'arrow', id: 'context', x1: 208, y1: 130, x2: 153, y2: 130, label: '', color: 'teal' },
      ] } },
    { title: 'Update the representation', caption: 'The result represents bank in this sentence, rather than bank in isolation.', explanation: 'A head combines value vectors using its attention weights. This is a simplified view of a head, not the whole transformer block. Residual connections, normalization, multiple heads and feed-forward layers add further processing.', basis: 'background', referenceIds: [],
      scene: { height: 280, elements: [
        { type: 'node', id: 'bank', x: 20, y: 90, width: 130, height: 80, label: 'bank', color: 'indigo', shape: 'box', detail: 'The identity of the word is retained while its representation changes.' },
        { type: 'node', id: 'meaning', x: 210, y: 90, width: 130, height: 80, label: 'in context', color: 'indigo', shape: 'ellipse', detail: 'The output is a vector, not a dictionary definition.' },
        { type: 'arrow', id: 'update', x1: 153, y1: 130, x2: 207, y2: 130, label: '', color: 'indigo' },
      ] } },
  ], takeaways: ['Attention mixes information using learned, context-dependent weights.', 'The diagram illustrates a mechanism; it does not establish an explanation of a specific model decision.'],
}

/** The same explanation in format 2, as an assistant would now answer it. */
export const visualFixtureV2: VisualDefinitionV2 = {
  version: 2, title: 'How attention builds context', summary: 'A word borrows information from other words according to their relevance.',
  scenes: [
    { kind: 'flow', title: 'Start with a word', direction: 'right', beats: [{ caption: 'The same word can mean different things in different sentences.', explanation: 'The word bank needs context to distinguish a financial institution from the edge of a river.', basis: 'illustration', referenceIds: [] }],
      nodes: [{ id: 'bank', label: 'bank', tone: 'primary', detail: 'The token being updated. It keeps the primary tone in every figure.' }, { id: 'river', label: 'river', tone: 'secondary', detail: 'A nearby word can help disambiguate bank.' }], edges: [] },
    { kind: 'bars', title: 'Give relevant context more weight', label: 'Attention weight from bank', beats: [{ caption: 'A larger attention weight means a stronger contribution to the update.', explanation: 'Softmax turns scores into nonnegative weights that sum to one for this query. The values are illustrative, not measured.', basis: 'illustration', referenceIds: [] }],
      items: [{ id: 'river', label: 'river', value: 0.6, tone: 'secondary' }, { id: 'the', label: 'the', value: 0.1 }, { id: 'muddy', label: 'muddy', value: 0.3 }] },
    { kind: 'flow', title: 'Update the representation', direction: 'right', beats: [{ caption: 'The result represents bank in this sentence, rather than bank in isolation.', explanation: 'A head combines value vectors using its attention weights. This is a simplified view of one head.', basis: 'background', referenceIds: [] }],
      nodes: [{ id: 'bank', label: 'bank', tone: 'primary' }, { id: 'meaning', label: 'bank in context', shape: 'pill', tone: 'accent', detail: 'The output is a vector, not a dictionary definition.' }], edges: [{ from: 'bank', to: 'meaning', label: 'weighted mix' }] },
  ],
  takeaways: ['Attention mixes information using learned, context-dependent weights.', 'The figure illustrates a mechanism; it does not explain a specific model decision.'],
}
