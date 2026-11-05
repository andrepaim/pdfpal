import { createHmac } from 'node:crypto'
import type { RuntimeIdentity } from './cli-protocol.js'

export const identityProof = (secret: string, challenge: string, identity: RuntimeIdentity) =>
  createHmac('sha256', secret).update(JSON.stringify([identity.protocol, identity.instance, identity.library, challenge])).digest('hex')
