/**
 * The core loop: give every one of YOUR users their own Maritime agent.
 *
 * `provision` is idempotent on `externalId` — it returns the existing agent if
 * there is one, otherwise creates a new one. Safe to call on every sign-in.
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

  console.log(`agent ${agent.id} is ${agent.status} for ${user.name}`)

  // Talk to it. Sleeping agents wake automatically; the call waits for the reply.
  // chat() resolves with { response, error? } — a delivery failure (agent still
  // deploying, LLM error) lands in `error` rather than throwing, so check it.
  const { response, error } = await maritime.agents.chat(agent.id, 'Say hi to your new user in one line.')
  if (error) throw new Error(`chat failed: ${error}`)
  console.log('agent says:', response)

  // Find it again later by YOUR id — no need to store Maritime's id.
  const [same] = await maritime.agents.list({ externalId: `customer_${user.id}` })
  console.log('looked up by externalId:', same?.id)
}

onSignup().catch((err) => {
  console.error('provisioning failed:', err.message)
  process.exit(1)
})
