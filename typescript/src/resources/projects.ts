import type { HttpClient } from '../http.js'
import type {
  Project,
  ProjectMessage,
  ProjectUser,
  SendMessageParams,
  UpdateProjectParams,
} from '../types.js'

/**
 * The HTTP front door — run one agent per end-user of YOUR product. Access via
 * `maritime.projects`.
 *
 * Every agent belongs to a project (created automatically with the agent; the
 * agent's `projectId` names it). Configure the project once, then route your
 * end-users' messages through {@link message}: Maritime binds each
 * `externalUserId` to its own agent (warm pool → spawn), wakes it, delivers,
 * and returns the reply.
 *
 * ```ts
 * const agent = await maritime.agents.create({ name: 'support', template: 'openclaw' })
 * await maritime.projects.update(agent.projectId, {
 *   newChatPolicy: 'spawn',   // one dedicated agent per end-user
 *   warmPoolSize: 3,          // pre-built spares — new users bind in ~1s
 * })
 *
 * const msg = await maritime.projects.message(agent.projectId, {
 *   externalUserId: `user_${theirUserId}`,
 *   message: 'What does my dashboard say?',
 * })
 * if (msg.status === 'replied') console.log(msg.reply)
 * // else: 'queued' | 'provisioning' — poll getMessage() or subscribe to the
 * // 'message.reply' webhook event.
 * ```
 */
export class ProjectsResource {
  constructor(private readonly http: HttpClient) {}

  /** Fetch a project. */
  async get(projectId: string): Promise<Project> {
    return this.http.request<Project>({ method: 'GET', path: `/api/projects/${enc(projectId)}` })
  }

  /** Update routing policy / instance cap / warm pool. */
  async update(projectId: string, params: UpdateProjectParams): Promise<Project> {
    return this.http.request<Project>({
      method: 'PATCH',
      path: `/api/projects/${enc(projectId)}`,
      body: {
        name: params.name,
        newChatPolicy: params.newChatPolicy,
        maxInstances: params.maxInstances,
        warmPoolSize: params.warmPoolSize,
      },
    })
  }

  /**
   * Send an end-user's message to their agent (get-or-create + wake + deliver).
   *
   * Resolves with `status: 'replied'` and the reply inline when the agent
   * answers within `wait` seconds — the common case for warm agents. A cold
   * first contact resolves earlier with `status: 'provisioning' | 'queued'`;
   * the reply then arrives via the `message.reply` webhook (or poll
   * {@link getMessage}). Pass `idempotencyKey` if you retry sends.
   */
  async message(projectId: string, params: SendMessageParams): Promise<ProjectMessage> {
    return this.http.request<ProjectMessage>({
      method: 'POST',
      path: `/api/v1/projects/${enc(projectId)}/messages`,
      body: {
        externalUserId: params.externalUserId,
        message: params.message,
        wait: params.wait,
        claimCode: params.claimCode,
        displayName: params.displayName,
        metadata: params.metadata,
      },
      headers: params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : undefined,
      // With a dedupe key the server makes retries safe.
      idempotent: params.idempotencyKey !== undefined,
    })
  }

  /** Poll a message's state (the fallback when you skip webhooks). */
  async getMessage(projectId: string, messageId: string): Promise<ProjectMessage> {
    return this.http.request<ProjectMessage>({
      method: 'GET',
      path: `/api/v1/projects/${enc(projectId)}/messages/${enc(messageId)}`,
    })
  }

  /** List the project's end-users (every bound `externalUserId`). */
  async users(projectId: string): Promise<ProjectUser[]> {
    return this.http.request<ProjectUser[]>({
      method: 'GET',
      path: `/api/v1/projects/${enc(projectId)}/users`,
    })
  }

  /** Fetch one end-user's binding + agent status. */
  async getUser(projectId: string, externalUserId: string): Promise<ProjectUser> {
    return this.http.request<ProjectUser>({
      method: 'GET',
      path: `/api/v1/projects/${enc(projectId)}/users/${enc(externalUserId)}`,
    })
  }

  /**
   * Unbind an end-user. Their instance stays and rejoins the project's warm
   * pool; to destroy it, `maritime.agents.delete(user.agentId)` first.
   */
  async unbindUser(projectId: string, externalUserId: string): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: `/api/v1/projects/${enc(projectId)}/users/${enc(externalUserId)}`,
    })
  }
}

const enc = encodeURIComponent
