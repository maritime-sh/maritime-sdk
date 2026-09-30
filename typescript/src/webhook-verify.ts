/**
 * Verify a Maritime webhook delivery's `X-Maritime-Signature` header.
 *
 * Uses Web Crypto (Node 18+, Bun, Deno, browsers, edge) and a constant-time
 * comparison. Pass the RAW request body bytes/string — re-serializing parsed
 * JSON will not match the signature.
 *
 * ```ts
 * app.post('/maritime/webhook', async (req, res) => {
 *   const ok = await verifyWebhookSignature({
 *     secret: process.env.MARITIME_WEBHOOK_SECRET!,
 *     body: req.rawBody,
 *     signature: req.headers['x-maritime-signature'],
 *   })
 *   if (!ok) return res.status(401).end()
 *   const event = JSON.parse(req.rawBody)
 *   if (event.event === 'message.reply') { ... }
 * })
 * ```
 */
export async function verifyWebhookSignature(params: {
  /** The subscription's signing secret (`whsec_...`), returned once at create. */
  secret: string
  /** The raw request body, exactly as received. */
  body: string | Uint8Array
  /** The `X-Maritime-Signature` header value (`sha256=<hex>`). */
  signature: string | null | undefined
}): Promise<boolean> {
  const { secret, body, signature } = params
  if (!signature || !signature.startsWith('sha256=')) return false

  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto unavailable: verifyWebhookSignature needs Node 18+/Bun/Deno/edge.')
  }
  const encoder = new TextEncoder()
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const data = typeof body === 'string' ? encoder.encode(body) : body
  const mac = new Uint8Array(await subtle.sign('HMAC', key, data as BufferSource))

  const expected = 'sha256=' + toHex(mac)
  return timingSafeEqual(encoder.encode(expected), encoder.encode(signature))
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
