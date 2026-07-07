/**
 * The core loop: give every one of YOUR users their own Maritime agent when
 * they sign up.
 *
 * `provision` is idempotent on `externalId` — it returns the existing agent if
 * there is one, otherwise creates a new one. Safe to call on every sign-in.
 * The agent boots in the background; talk to it when your user sends a message
 * (see express-chat-api.ts / nextjs-route.ts).
 *
 *   export MARITIME_API_KEY=mk_xxxxxxxxxxxx
 *   npx tsx provision-on-signup.ts
 */
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

// Pretend this is your user record.
const user = { id: 'user_8842', name: 'Ada' }

async function onSignup() {
  const agent = await maritime.agents.provision({
    externalId: `customer_${user.id}`, // your id — how you find this agent later
    name: `assistant-${user.id}`,
    template: 'openclaw',
    instructions: `You are a friendly personal assistant for ${user.name}.`,
  })
  console.log(`provisioned agent ${agent.id} (${agent.status}) for ${user.name}`)

  // Find it again later by YOUR id — no need to store Maritime's id.
  const [same] = await maritime.agents.list({ externalId: `customer_${user.id}` })
  console.log('looked up by externalId:', same?.id)
}

onSignup().catch((err) => {
  console.error('provisioning failed:', err.message)
  process.exit(1)
})
