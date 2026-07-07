/**
 * Receive Maritime lifecycle events (agent.deployed, agent.error, ...) instead
 * of polling — and verify the HMAC-SHA256 signature so you can trust the body.
 *
 * Two parts:
 *   1. register a subscription once (run with `register` as the first arg)
 *   2. an Express endpoint that verifies + handles deliveries
 *
 *   export MARITIME_API_KEY=mk_xxxxxxxxxxxx
 *   npx tsx webhook-receiver.ts register https://your-app.com/maritime/webhook
 *   # → prints the signing secret; put it in MARITIME_WEBHOOK_SECRET
 *   MARITIME_WEBHOOK_SECRET=whsec_xxx npx tsx webhook-receiver.ts
 */
import crypto from 'node:crypto'
import express from 'express'
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

// --- 1. one-time registration ---------------------------------------------
if (process.argv[2] === 'register') {
  const url = process.argv[3]
  if (!url) throw new Error('usage: webhook-receiver.ts register <https-url>')
  const hook = await maritime.webhooks.create({
    url,
    events: ['agent.deployed', 'agent.error'], // omit for all events
  })
  console.log('subscription:', hook.id)
  console.log('signing secret (store as MARITIME_WEBHOOK_SECRET):', hook.secret)
  await maritime.webhooks.test(hook.id) // deliver a synthetic ping to confirm
  process.exit(0)
}

// --- 2. the receiver -------------------------------------------------------
// Fail closed: never verify against an empty secret (an attacker could forge a
// matching signature over the empty key).
const SECRET = process.env.MARITIME_WEBHOOK_SECRET
if (!SECRET) throw new Error('MARITIME_WEBHOOK_SECRET is required to verify signatures')

const app = express()

// Use the RAW body — the signature is computed over the exact bytes we sent.
app.post('/maritime/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const raw = req.body as Buffer
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  const sig = req.header('x-maritime-signature') ?? ''
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).send('bad signature')
  }

  const event = JSON.parse(raw.toString())
  // { event: 'agent.error', agent_id, external_id, timestamp, data: {...} }
  switch (event.event) {
    case 'agent.error':
      console.log(`agent for ${event.external_id} errored — notify the customer`)
      break
    case 'agent.deployed':
      console.log(`agent for ${event.external_id} is ready`)
      break
    default:
      console.log('event:', event.event, 'for', event.external_id)
  }
  res.status(200).send('ok')
})

app.listen(3000, () => console.log('webhook receiver on http://localhost:3000/maritime/webhook'))
