/**
 * A Next.js App Router route handler. Drop this at `app/api/assistant/route.ts`.
 *
 * The Maritime client lives on the server (your API key never reaches the
 * browser). Each request provisions-or-reuses the caller's agent and chats.
 *
 *   export MARITIME_API_KEY=mk_xxxxxxxxxxxx   # in .env.local
 */
import { Maritime } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })

export async function POST(req: Request) {
  const { userId, message } = (await req.json()) as { userId: string; message: string }

  // Get-or-create this user's agent, then chat. One round trip each.
  const agent = await maritime.agents.provision({
    externalId: `customer_${userId}`,
    name: `assistant-${userId}`,
    template: 'openclaw',
  })

  // chat() resolves with { response, error? } and does not throw on a delivery
  // failure — return a 502 instead of a silent { reply: null }.
  const { response, error } = await maritime.agents.chat(agent.id, message)
  if (error || response == null) {
    return Response.json({ error: error ?? 'chat failed' }, { status: 502 })
  }
  return Response.json({ reply: response })
}
