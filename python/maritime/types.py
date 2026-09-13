"""Type definitions for the Maritime API SDK."""

from __future__ import annotations

from typing import List, Literal, NotRequired, Optional, TypedDict, Union

Template = Union[
    Literal[
        "openclaw",
        "openclaw_identity",
        "openclaw_browser",
        "maritime",
        "hermes",
        "hermes_identity",
        "zeroclaw",
    ],
    str,
]

Tier = Literal["smart", "extended", "always_on"]

AgentStatus = Literal["sleeping", "active", "deploying", "error", "stopped"]


class EnvVarInput(TypedDict):
    """One env var to seed at create time."""

    key: str
    value: str
    secret: NotRequired[bool]


class CreateAgentParams(TypedDict):
    name: str
    template: NotRequired[Template]
    externalId: NotRequired[str]
    description: NotRequired[str]
    instructions: NotRequired[str]
    tier: NotRequired[Tier]
    env: NotRequired[List[EnvVarInput]]
    memMb: NotRequired[int]
    vcpus: NotRequired[Union[int, float]]
    idleTtlSeconds: NotRequired[int]
    diskGb: NotRequired[Union[int, float]]
    githubRepo: NotRequired[str]
    imageName: NotRequired[str]


class Agent(TypedDict):
    id: str
    name: str
    description: Optional[str]
    externalId: Optional[str]
    framework: str
    tier: Tier
    status: AgentStatus
    publicUrl: NotRequired[Optional[str]]
    invocationCount: int
    totalComputeSeconds: Union[int, float]
    createdAt: str
    updatedAt: str


class EnvVar(TypedDict):
    key: str
    value: str
    isSecret: bool


class LogEntry(TypedDict):
    id: str
    level: str
    message: str
    source: NotRequired[Optional[str]]
    timestamp: Optional[str]


class ChatResult(TypedDict):
    response: Optional[str]
    error: NotRequired[str]


class ListAgentsParams(TypedDict, total=False):
    externalId: str
    name: str


class ChatOptions(TypedDict, total=False):
    conversationId: str


ApiKeyScope = Union[
    Literal["provision", "deploy", "secrets", "manage"],
    str,
]


class CreateApiKeyParams(TypedDict):
    name: str
    scopes: NotRequired[List[ApiKeyScope]]
    expiresInDays: NotRequired[int]


class ApiKey(TypedDict):
    id: str
    name: str
    keyPrefix: str
    scopes: List[str]
    isActive: bool
    lastUsedAt: Optional[str]
    expiresAt: Optional[str]
    createdAt: str


class CreatedApiKey(ApiKey):
    rawKey: str


WebhookEvent = Literal[
    "agent.deployed",
    "agent.error",
    "agent.sleeping",
    "agent.woken",
    "agent.restarted",
    "agent.stopped",
]


class CreateWebhookParams(TypedDict):
    url: str
    events: NotRequired[List[WebhookEvent]]


class Webhook(TypedDict):
    id: str
    url: str
    events: List[WebhookEvent]
    isActive: bool
    lastDeliveredAt: Optional[str]
    lastStatusCode: Optional[int]
    consecutiveFailures: int
    createdAt: str


class CreatedWebhook(Webhook):
    secret: str


class WebhookTestResult(TypedDict):
    delivered: bool
    statusCode: Optional[int]
    error: NotRequired[str]

