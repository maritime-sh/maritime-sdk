import type { HttpClient } from '../http.js'
import type { ApiKey, CreatedApiKey, CreateApiKeyParams } from '../types.js'

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

  /** Mint a new key. The raw key is returned once — store it immediately. */
  async create(params: CreateApiKeyParams): Promise<CreatedApiKey> {
    return this.http.request<CreatedApiKey>({
      method: 'POST',
      path: '/api/v1/keys',
      body: {
        name: params.name,
        scopes: params.scopes ?? ['provision', 'deploy', 'secrets', 'manage'],
        expires_in_days: params.expiresInDays,
      },
    })
  }

  /** List the caller's keys (raw values are never returned again). */
  async list(): Promise<ApiKey[]> {
    return this.http.request<ApiKey[]>({ method: 'GET', path: '/api/v1/keys' })
  }

  /** Revoke a key by id. */
  async revoke(keyId: string): Promise<void> {
    await this.http.request<void>({ method: 'DELETE', path: `/api/v1/keys/${encodeURIComponent(keyId)}` })
  }
}
