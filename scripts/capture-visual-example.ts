// Run: npx tsx scripts/capture-visual-example.ts
// Authored demo content, rendered by pdfpal's real HTML exporter.
// Inspired by https://github.com/anthropics/claude-plugins-community/blob/main/eli5/skills/eli5/SKILL.md
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { visualDefinition, type VisualElement, type VisualRecord } from '../src/shared/visual.js'
import { visualHtml } from '../frontend/src/lib/visual-html.js'

type Color = VisualElement['color']
const path = (id: string, color: Color, pairs: number[][], closed = false): VisualElement => ({ type: 'path', id, color, points: pairs.map(([x,y]) => ({x,y})), closed })
const text = (id: string, x: number, y: number, label: string, color: Color, size = 18): VisualElement => ({ type:'text', id, x, y, text:label, color, size })
const node = (id: string, x: number, y: number, width: number, label: string, color: Color, detail: string): VisualElement => ({type:'node',id,x,y,width,height:42,label,color,shape:'box',detail})
const arrow = (id: string,x1: number,y1: number,x2: number,y2: number,color: Color): VisualElement => ({type:'arrow',id,x1,y1,x2,y2,color})

function worlds(): VisualElement[] {
  return [
    // A classical bank, with columns, steps, a coin and a roof.
    path('roof','amber',[[28,159],[90,121],[152,159]],true),
    path('lintel','amber',[[35,167],[145,167]]),
    ...[45,76,107,134].map((x,i)=>path(`column${i}`,'amber',[[x,174],[x,231]])),
    path('base','amber',[[31,238],[149,238],[153,247],[27,247]],true),
    path('step','amber',[[21,256],[159,256]]),
    text('dollar',90,155,'$','amber',24),
    // A meandering river with a small sailboat and a tree on its bank.
    path('riverShape','teal',[[249,129],[272,143],[281,164],[270,188],[251,207],[250,223],[267,244],[292,261],[329,261],[300,236],[285,218],[288,201],[305,183],[314,160],[300,140],[278,129]],true),
    path('ripple1','teal',[[279,164],[293,160],[302,163]]),
    path('ripple2','teal',[[264,218],[274,222]]),
    path('boat','indigo',[[257,186],[291,186],[284,196],[265,196]],true),
    path('mast','indigo',[[275,151],[275,185]]),
    path('sail','indigo',[[271,156],[257,180],[271,180]],true),
    path('tree','teal',[[214,180],[214,213]]),
    path('leaves','teal',[[214,142],[196,179],[232,179]],true),
    path('shore','teal',[[200,229],[216,224],[232,228]]),
    text('money',90,285,'Money','amber'),
    text('water',270,285,'Water','teal'),
  ]
}
const definition = visualDefinition.parse({
  version:1,
  title:'One word. Two worlds.',
  summary:'How attention uses context to help a model represent meaning.',
  steps:[
    {title:'What does “bank” mean?',basis:'illustration',referenceIds:[],
      caption:'The word alone leaves a question. The surrounding words offer clues.',
      explanation:'Bank can name a financial institution or the edge of a river. These pictures are a simple analogy for ambiguity, not a literal view inside a model. Click the word to explore the idea.',
      scene:{height:310,elements:[
        node('bank',125,20,110,'bank','indigo','A token starts with a representation. Its context helps the model build a more useful representation for this occurrence.'),
        path('leftBranch','amber',[[155,70],[155,88],[90,88],[90,110]]),
        path('rightBranch','teal',[[205,70],[205,88],[270,88],[270,110]]),
        ...worlds(),
      ]}},
    {title:'Let the sentence supply the clues',basis:'illustration',referenceIds:[],
      caption:'“We sat by the river bank.” River is a useful clue to the meaning of bank.',
      explanation:'In self-attention, a query for one token is compared with keys from the other available tokens. Those learned scores become weights. River is a useful human-readable clue here; actual attention weights depend on the trained model, layer and head. This is not a measured attention map.',
      scene:{height:310,elements:[
        node('river',20,20,120,'river','teal','A contextual clue. In the model, learned key and value vectors represent information about this token.'),
        node('bank',220,20,120,'bank','indigo','For this query, attention scores determine how much each available value vector contributes.'),
        arrow('clue',146,41,213,41,'teal'),
        ...worlds(),
        text('sentence',180,101,'We sat by the river bank.','slate',18),
      ]}},
    {title:'Mix the context into the word',basis:'illustration',referenceIds:[],
      caption:'Attention blends information from other tokens into a context-aware representation.',
      explanation:'Softmax turns query–key scores into nonnegative weights summing to one. The head uses these weights to sum value vectors. The result is a vector, not a dictionary definition or a hard choice between two pictures. Multiple heads, residual connections and other layers add further processing.',
      scene:{height:310,elements:[
        node('sat',14,20,90,'sat','amber','Each available token can contribute a value vector.'),
        node('river',130,20,100,'river','teal','Relevant context may receive a larger weight; no specific numerical weights are claimed here.'),
        node('bank',256,20,90,'bank','indigo','A token can also attend to itself.'),
        arrow('satMix',59,72,152,144,'amber'),arrow('riverMix',180,72,180,144,'teal'),arrow('bankMix',301,72,208,144,'indigo'),
        node('mix',100,154,160,'Weighted mix','teal','An attention head computes a weighted sum of value vectors.'),
        arrow('output',180,204,180,245,'teal'),
        node('context',50,256,260,'bank, in context','indigo','A contextual vector becomes part of the next computation in the model.'),
      ]}},
  ],
  takeaways:['Context helps distinguish different uses of the same word.','Attention combines value vectors using learned weights.','This is an illustrative analogy, not a measured attention map.'],
})
const record: VisualRecord = {id:'attention-demo',project_id:'demo',question:'Explain attention with big pictures and few words.',status:'complete',definition,references:[],error:null,note_id:null,created_at:'2026-11-01T00:00:00Z'}
const htmlPath = resolve('screenshots/9-visual-explanation.html')
await writeFile(htmlPath, visualHtml(record))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({viewport:{width:1000,height:1160},deviceScaleFactor:1})
  await page.goto(pathToFileURL(htmlPath).href)
  await page.getByRole('heading',{name:'One word. Two worlds.'}).waitFor()
  await page.getByRole('button',{name:'bank',exact:true}).click()
  if (!await page.locator('#detail').isVisible()) throw new Error('Click detail failed')
  await page.getByRole('button',{name:'Next',exact:true}).click()
  if (await page.locator('#counter').textContent() !== '2 / 3') throw new Error('Next failed')
  await page.getByRole('button',{name:'Next',exact:true}).click()
  if (!await page.getByRole('button',{name:'Next',exact:true}).isDisabled()) throw new Error('Final step failed')
  await page.getByRole('button',{name:'Previous',exact:true}).click()
  await page.getByRole('button',{name:'Previous',exact:true}).click()
  const figure = await page.locator('.v-export-step:not([hidden]) figure').boundingBox()
  await page.screenshot({path:'screenshots/9-visual-explanation.png',clip:{x:100,y:0,width:800,height:Math.ceil(figure!.y+figure!.height+8)}})
  console.log('Validated all three scenes and captured the actual HTML export.')
} finally { await browser.close() }
