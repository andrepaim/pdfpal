// A stand-in for src/core/sense-worker.ts that speaks the same messages
// without a model. workerData.fake controls its timing and answers:
//   loadMs, scoreMs     how long loading and each score take
//   fail                report this load failure code instead of becoming ready
//   crashOnScore        exit as soon as a score is requested
//   rejectCode          reject every score with this code
//   prefer              definitions containing this text get the highest logit
//   none                the "none of the above" logit (default -5)
import { parentPort, workerData } from 'node:worker_threads'

const fake = workerData.fake ?? {}
const letters = Array.from({ length: 128 }, (_, i) => String.fromCharCode(0x400 + i))
const format = { letters, nota_index: 127, none_text: 'none of the above', separator: '[unused0]', mask_token: '[MASK]', max_length: 2048, temperature: 1 }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

let queue = Promise.resolve()
parentPort.on('message', message => {
  if (message.type === 'close') process.exit(0)
  if (message.type !== 'score') return
  if (fake.crashOnScore) process.exit(3)
  queue = queue.then(async () => {
    await sleep(fake.scoreMs ?? 0)
    if (fake.rejectCode) return parentPort.postMessage({ type: 'rejected', id: message.id, code: fake.rejectCode })
    const choices = message.prompt.split('\n').slice(1, -2)
    const logits = new Float32Array(128).fill(-50)
    choices.forEach((line, i) => { logits[i] = fake.prefer && line.includes(fake.prefer) ? 5 : 0 })
    logits[127] = fake.none ?? -5
    parentPort.postMessage({ type: 'scored', id: message.id, logits })
  })
})

await sleep(fake.loadMs ?? 0)
if (fake.fail) parentPort.postMessage({ type: 'failed', code: fake.fail })
else parentPort.postMessage({ type: 'ready', format, revision: 'fake' })
