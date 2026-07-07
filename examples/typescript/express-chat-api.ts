/**
 * An Express API that gives each of your users their own agent and proxies
 * chat to it. `provision` is idempotent, so the same handler works for a brand-
 * new user and a returning one.
 *
 *   export MARITIME_API_KEY=mk_xxxxxxxxxxxx
 *   npm install && npx tsx express-chat-api.ts
 *   curl -s localhost:3000/chat -H 'content-type: application/json' \
 *     -d '{"userId":"user_42","message":"hello"}'
 */
import express from 'express'
import { Maritime, MaritimePaymentRequiredError } from 'maritime-sdk'

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY })
const app = express()
app.use(express.json())

app.post('/chat', async (req, res) => {
  const { userId, message } = req.body as { userId: string; message: string }
  if (!userId || !message) return res.status(400).json({ error: 'userId and message required' })

  try {
    const agent = await maritime.agents.provision({
      externalId: `customer_${userId}`,
      name: `assistant-${userId}`,
      template: 'openclaw',
    })
    const { response, error } = await maritime.agents.chat(agent.id, message)
    if (error) return res.status(502).json({ error })
    return res.json({ reply: response })
  } catch (err) {
    // Your Maritime wallet needs funding — surface it distinctly from other errors.
    if (err instanceof MaritimePaymentRequiredError) {
      return res.status(402).json({ error: 'agent hosting wallet is empty' })
    }
    console.error(err)
    return res.status(500).json({ error: 'internal error' })
  }
})

app.listen(3000, () => console.log('listening on http://localhost:3000'))
