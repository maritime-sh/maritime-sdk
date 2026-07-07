/**
 * Mint a narrowly-scoped key for a subsystem that only needs part of the API.
 *
 * A background worker that only chats to existing agents needs `deploy` — not
 * `provision`, `secrets`, or `manage`. If that key leaks, the blast radius is
 * limited to what `deploy` allows (no creating/deleting agents, no reading
 * secrets, no minting more keys).
 *
 * The key you run THIS with must itself carry `manage` (minting keys is gated).
 *
 *   export MARITIME_API_KEY=mk_your_full_key
 *   npx tsx scoped-key.ts
 */
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

const worker = await maritime.keys.create({
  name: 'chat-worker',
  scopes: ['deploy'], // chat/start/stop only — cannot create, delete, or read secrets
})

console.log('worker key (shown once — store it now):', worker.rawKey)
console.log('scopes:', worker.scopes)

// Hand `worker.rawKey` to your worker process as its MARITIME_API_KEY.
// It can chat to agents but a leak can't drain your account or delete agents.
