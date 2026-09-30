import type { HttpClient } from '../http.js'
import type { ApiKey, CreatedApiKey, CreateApiKeyParams } from '../types.js'

/** Raw /api/v1/keys response — this endpoint serializes snake_case (unlike the
 * rest of the API, which is camelCase). We normalize it below so the SDK
 * presents one consistent camelCase shape. */
interface RawApiKey {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  project_id?: string | null
  is_active: boolean
  last_used_at: string | null
  expires_at: string | null
  created_at: string
  raw_key?: string
}

function normalize(k: RawApiKey): CreatedApiKey {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    scopes: k.scopes,
    projectId: k.project_id ?? null,
    isActive: k.is_active,
    lastUsedAt: k.last_used_at,
    expiresAt: k.expires_at,
    createdAt: k.created_at,
    rawKey: k.raw_key as string,
  }
}

/**
 * Manage API keys (`mk_...`) programmatically. Access via `maritime.keys`.
 *
 * Minting a key requires the caller's own key to carry the `manage` scope (or
 * be a dashboard session). Hand a narrower-scoped key to a subsystem that only
 * needs part of the surface — e.g. a `deploy`-scoped key for a worker that only
 * chats to agents.
 */
export class KeysResource {
  constructor(private readonly http: HttpClient) {}

  /** Mint a new key. The raw key (`rawKey`) is returned once — store it now. */
  async create(params: CreateApiKeyParams): Promise<CreatedApiKey> {
    const raw = await this.http.request<RawApiKey>({
      method: 'POST',
      path: '/api/v1/keys',
      body: {
        name: params.name,
        scopes: params.scopes ?? ['provision', 'deploy', 'secrets', 'manage'],
        expires_in_days: params.expiresInDays,
        project_id: params.projectId,
      },
    })
    return normalize(raw)
  }

  /** List the caller's keys (raw values are never returned again). */
  async list(): Promise<ApiKey[]> {
    const raw = await this.http.request<RawApiKey[]>({ method: 'GET', path: '/api/v1/keys' })
    return raw.map(normalize)
  }

  /** Revoke a key by id. */
  async revoke(keyId: string): Promise<void> {
    await this.http.request<void>({ method: 'DELETE', path: `/api/v1/keys/${encodeURIComponent(keyId)}` })
  }
}
