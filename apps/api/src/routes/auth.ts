import type { FastifyInstance, FastifyReply, preHandlerHookHandler } from "fastify";
import { resolveClerkUser } from "../auth/clerk.js";
import { extractBearerToken } from "../auth/keys.js";
import { createSessionToken, createSessionTokenForIdentity } from "../auth/session.js";
import { verifySiweMessage } from "../auth/siwe.js";
import type { ApiKeyRecord, ApiKeyStore } from "../auth/store.js";
import {
  parseOptionalEnvironment,
  parseRequiredEnvironment,
  type ApiKeyEnvironment,
} from "../auth/environment.js";
import {
  normalizeProjectName,
  parseOptionalKeyName,
  parseOptionalProjectId,
} from "../auth/projects.js";
import {
  validatePublicCreateKeyBody,
  WALLET_VERIFICATION_REQUIRED,
} from "../auth/public-key-body.js";
import { normalizeWalletAddress } from "../auth/wallet.js";
import type { WalletNonceStore } from "../auth/wallet-nonce.js";
import type { CreditStore } from "../credits/store.js";
import { roundCredits } from "../credits/pricing.js";
import { notifyAccountCreated } from "../notify/events.js";
import { queueWelcomeNotification } from "../notifications/welcome.js";
import { getClientIpForRateLimit } from "../client-ip.js";
import type { RateLimitResult } from "../rate-limit.js";
import type { UsageStore } from "../usage/store.js";

interface AuthRouteDeps {
  store: ApiKeyStore;
  authenticate: preHandlerHookHandler;
  keyGenRateLimit: (key: string) => RateLimitResult;
  creditStore: CreditStore;
  usageStore: UsageStore;
  initialCreditBalance: number;
  sessionSecret: string;
  sessionTtlMs: number;
  clerkSecretKey?: string;
  walletNonceStore: WalletNonceStore;
  siwe: {
    domain: string;
    uri: string;
    chainId: number;
  };
}

interface RevokeKeyBody {
  id?: string;
}

interface UpdateKeyBody {
  id?: string;
  environment?: ApiKeyEnvironment;
  projectId?: string;
  name?: string;
}

interface AuthenticatedCreateKeyBody {
  environment?: ApiKeyEnvironment;
  projectId?: string;
  name?: string;
}

interface CreateProjectBody {
  name: string;
}

interface UpdateProjectBody {
  id: string;
  name: string;
}

interface DeleteProjectBody {
  id: string;
}

interface WalletNonceBody {
  address?: string;
}

interface WalletVerifyBody {
  message?: string;
  signature?: string;
}

function validateWalletNonceBody(body: unknown): WalletNonceBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  if (typeof b.address !== "string" || b.address.trim() === "") {
    return "Field 'address' must be a non-empty string";
  }
  return { address: b.address.trim() };
}

function validateWalletVerifyBody(body: unknown): WalletVerifyBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  if (typeof b.message !== "string" || b.message.trim() === "") {
    return "Field 'message' must be a non-empty string";
  }
  if (typeof b.signature !== "string" || b.signature.trim() === "") {
    return "Field 'signature' must be a non-empty string";
  }
  return { message: b.message, signature: b.signature };
}

function validateRevokeKeyBody(body: unknown): RevokeKeyBody | string {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;
  if (b.id === undefined) {
    return {};
  }

  if (typeof b.id !== "string" || b.id.trim() === "") {
    return "Field 'id' must be a non-empty string";
  }

  return { id: b.id.trim() };
}

function validateAuthenticatedCreateKeyBody(
  body: unknown,
): AuthenticatedCreateKeyBody | string {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;
  const environment = parseOptionalEnvironment(b.environment);
  if (!environment.ok) {
    return environment.error;
  }

  const projectId = parseOptionalProjectId(b.project_id);
  if (!projectId.ok) {
    return projectId.error;
  }

  const name = parseOptionalKeyName(b.name);
  if (!name.ok) {
    return name.error;
  }

  const result: AuthenticatedCreateKeyBody = {};
  if (b.environment !== undefined && b.environment !== null) {
    result.environment = environment.value;
  }
  if (projectId.value) {
    result.projectId = projectId.value;
  }
  if (name.value) {
    result.name = name.value;
  }
  return result;
}

function validateUpdateKeyBody(body: unknown): UpdateKeyBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const b = body as Record<string, unknown>;
  const hasEnvironment = b.environment !== undefined && b.environment !== null;
  const hasProjectId = b.project_id !== undefined && b.project_id !== null && b.project_id !== "";
  const name = parseOptionalKeyName(b.name);
  if (!name.ok) {
    return name.error;
  }

  if (!hasEnvironment && !hasProjectId && !name.value) {
    return "Provide 'environment', 'project_id', and/or 'name'";
  }

  const result: UpdateKeyBody = {};

  if (hasEnvironment) {
    const environment = parseRequiredEnvironment(b.environment);
    if (!environment.ok) {
      return environment.error;
    }
    result.environment = environment.value;
  }

  if (hasProjectId) {
    const projectId = parseOptionalProjectId(b.project_id);
    if (!projectId.ok) {
      return projectId.error;
    }
    if (!projectId.value) {
      return "Field 'project_id' must be a non-empty string";
    }
    result.projectId = projectId.value;
  }

  if (name.value) {
    result.name = name.value;
  }

  if (b.id === undefined) {
    return result;
  }

  if (typeof b.id !== "string" || b.id.trim() === "") {
    return "Field 'id' must be a non-empty string";
  }

  result.id = b.id.trim();
  return result;
}

function validateCreateProjectBody(body: unknown): CreateProjectBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  const name = normalizeProjectName(b.name);
  if (!name.ok) {
    return name.error;
  }
  return { name: name.value };
}

function validateUpdateProjectBody(body: unknown): UpdateProjectBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.trim() === "") {
    return "Field 'id' must be a non-empty string";
  }
  const name = normalizeProjectName(b.name);
  if (!name.ok) {
    return name.error;
  }
  return { id: b.id.trim(), name: name.value };
}

function validateDeleteProjectBody(body: unknown): DeleteProjectBody | string {
  if (body === undefined || body === null || typeof body !== "object") {
    return "Request body must be a JSON object";
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || b.id.trim() === "") {
    return "Field 'id' must be a non-empty string";
  }
  return { id: b.id.trim() };
}

function serializeKey(record: {
  id: string;
  email?: string;
  wallet?: string;
  environment: ApiKeyEnvironment;
  projectId?: string;
  name?: string;
  createdAt: string;
  lastUsedAt?: string;
}, projectName?: string | null) {
  return {
    object: "api_key",
    id: record.id,
    name: record.name ?? null,
    email: record.email ?? null,
    wallet: record.wallet ?? null,
    environment: record.environment,
    project_id: record.projectId ?? null,
    project_name: projectName ?? null,
    created_at: record.createdAt,
    last_used_at: record.lastUsedAt ?? null,
  };
}

function serializeProject(
  project: {
    id: string;
    name: string;
    isDefault: boolean;
    createdAt: string;
  },
  extras?: { keyCount?: number; balance?: number },
) {
  return {
    object: "project",
    id: project.id,
    name: project.name,
    is_default: project.isDefault,
    created_at: project.createdAt,
    ...(extras?.keyCount !== undefined ? { key_count: extras.keyCount } : {}),
    ...(extras?.balance !== undefined ? { balance: extras.balance, currency: "USD" } : {}),
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps,
): Promise<void> {
  app.get<{ Querystring: { email?: string; wallet?: string } }>(
    "/v1/auth/account",
    async (request, reply) => {
      const email = request.query.email?.trim();
      const wallet = request.query.wallet?.trim();

      if (email && wallet) {
        return reply.status(400).send({
          error: {
            message: "Provide either 'email' or 'wallet', not both",
            type: "invalid_request_error",
          },
        });
      }

      if (email) {
        const exists = await deps.store.emailHasAccount(email);
        return { object: "account", email, exists };
      }

      if (wallet) {
        let normalized: string;
        try {
          normalized = normalizeWalletAddress(wallet);
        } catch {
          return reply.status(400).send({
            error: {
              message: "Invalid wallet address",
              type: "invalid_request_error",
            },
          });
        }
        const exists = await deps.store.walletHasAccount(normalized);
        return { object: "account", wallet: normalized, exists };
      }

      return reply.status(400).send({
        error: {
          message: "Query parameter 'email' or 'wallet' is required",
          type: "invalid_request_error",
        },
      });
    },
  );

  app.post("/v1/auth/clerk", async (request, reply) => {
    if (!deps.clerkSecretKey) {
      return reply.status(503).send({
        error: {
          message: "Clerk authentication is not configured on the server",
          type: "configuration_error",
        },
      });
    }

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply.status(401).send({
        error: {
          message: "Missing Authorization header. Use: Bearer <clerk_session_token>",
          type: "authentication_error",
        },
      });
    }

    let clerkUser;
    try {
      clerkUser = await resolveClerkUser(deps.clerkSecretKey, token);
    } catch {
      return reply.status(401).send({
        error: {
          message: "Invalid or expired Clerk session",
          type: "authentication_error",
        },
      });
    }

    let record = await deps.store.findPrimaryKeyForEmail(clerkUser.email);
    let createdAccount = false;
    if (!record) {
      const created = await deps.store.create({ email: clerkUser.email });
      record = created.record;
      await deps.creditStore.credit(record.id, deps.initialCreditBalance, {
        source: "initial",
      });
      createdAccount = true;
      notifyAccountCreated({
        apiKeyId: record.id,
        source: "clerk",
        email: clerkUser.email,
        isNewAccount: true,
      });
      queueWelcomeNotification({
        apiKeyId: record.id,
        email: record.email ?? clerkUser.email,
        wallet: record.wallet,
      });
    }

    const sessionToken = createSessionToken(
      record.id,
      clerkUser.email,
      deps.sessionSecret,
      deps.sessionTtlMs,
    );

    return reply.status(200).send({
      object: "session",
      session_token: sessionToken,
      email: clerkUser.email,
      wallet: record.wallet ?? null,
      api_key_id: record.id,
      created_account: createdAccount,
    });
  });

  app.post<{ Body: unknown }>("/v1/auth/wallet/nonce", async (request, reply) => {
    const clientIp = getClientIpForRateLimit(request);
    const limit = deps.keyGenRateLimit(clientIp);

    if (!limit.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(limit.retryAfterSec ?? 60))
        .send({
          error: {
            message: `Rate limit exceeded. Try again in ${limit.retryAfterSec}s.`,
            type: "rate_limit_error",
          },
        });
    }

    const validated = validateWalletNonceBody(request.body);
    if (typeof validated === "string") {
      return reply.status(400).send({
        error: { message: validated, type: "invalid_request_error" },
      });
    }

    let address: string;
    try {
      address = normalizeWalletAddress(validated.address!);
    } catch {
      return reply.status(400).send({
        error: { message: "Invalid wallet address", type: "invalid_request_error" },
      });
    }

    const issued = await deps.walletNonceStore.issue(address);

    return reply.status(200).send({
      object: "wallet_nonce",
      address: issued.address,
      nonce: issued.nonce,
      expires_at: issued.expiresAt.toISOString(),
      chain_id: deps.siwe.chainId,
      domain: deps.siwe.domain,
      uri: deps.siwe.uri,
    });
  });

  app.post<{ Body: unknown }>("/v1/auth/wallet/verify", async (request, reply) => {
    const clientIp = getClientIpForRateLimit(request);
    const limit = deps.keyGenRateLimit(clientIp);

    if (!limit.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(limit.retryAfterSec ?? 60))
        .send({
          error: {
            message: `Rate limit exceeded. Try again in ${limit.retryAfterSec}s.`,
            type: "rate_limit_error",
          },
        });
    }

    const validated = validateWalletVerifyBody(request.body);
    if (typeof validated === "string") {
      return reply.status(400).send({
        error: { message: validated, type: "invalid_request_error" },
      });
    }

    let address: string;
    let nonce: string;
    try {
      const verified = await verifySiweMessage(
        validated.message!,
        validated.signature!,
        deps.siwe,
      );
      address = verified.address;
      nonce = verified.nonce;
    } catch {
      return reply.status(401).send({
        error: {
          message: "Invalid or expired wallet signature",
          type: "authentication_error",
        },
      });
    }

    const nonceValid = await deps.walletNonceStore.consume(address, nonce);
    if (!nonceValid) {
      return reply.status(401).send({
        error: {
          message: "Invalid or expired wallet signature",
          type: "authentication_error",
        },
      });
    }

    let record = await deps.store.findPrimaryKeyForWallet(address);
    let createdAccount = false;
    if (!record) {
      const created = await deps.store.create({ wallet: address });
      record = created.record;
      await deps.creditStore.credit(record.id, deps.initialCreditBalance, {
        source: "initial",
      });
      createdAccount = true;
      notifyAccountCreated({
        apiKeyId: record.id,
        source: "siwe",
        wallet: address,
        isNewAccount: true,
      });
      queueWelcomeNotification({
        apiKeyId: record.id,
        email: record.email,
        wallet: record.wallet ?? address,
      });
    }

    const sessionToken = createSessionTokenForIdentity(
      record.id,
      { wallet: address },
      deps.sessionSecret,
      deps.sessionTtlMs,
    );

    return reply.status(200).send({
      object: "session",
      session_token: sessionToken,
      wallet: address,
      api_key_id: record.id,
      created_account: createdAccount,
    });
  });

  app.post<{ Body: unknown }>("/v1/auth/key", async (request, reply) => {
    const clientIp = getClientIpForRateLimit(request);
    const limit = deps.keyGenRateLimit(clientIp);

    if (!limit.allowed) {
      return reply
        .status(429)
        .header("Retry-After", String(limit.retryAfterSec ?? 60))
        .send({
          error: {
            message: `Rate limit exceeded. Try again in ${limit.retryAfterSec}s.`,
            type: "rate_limit_error",
          },
        });
    }

    const validated = validatePublicCreateKeyBody(request.body);

    if (typeof validated === "string") {
      if (validated === WALLET_VERIFICATION_REQUIRED) {
        return reply.status(400).send({
          error: {
            message:
              "Wallet-linked keys require SIWE verification. Use POST /v1/auth/wallet/nonce and POST /v1/auth/wallet/verify, or sign in and use POST /v1/auth/keys.",
            type: "invalid_request_error",
            code: "wallet_verification_required",
          },
        });
      }

      return reply.status(400).send({
        error: { message: validated, type: "invalid_request_error" },
      });
    }

    const { record, plainKey } = await deps.store.create(validated);
    await deps.creditStore.credit(record.id, deps.initialCreditBalance, {
      source: "initial",
    });
    const balance = await deps.creditStore.getBalance(record.id);

    notifyAccountCreated({
      apiKeyId: record.id,
      source: "public_key",
      email: record.email,
      wallet: record.wallet,
      isNewAccount: true,
    });
    queueWelcomeNotification({
      apiKeyId: record.id,
      email: record.email,
      wallet: record.wallet,
    });

    return reply.status(201).send({
      object: "api_key",
      api_key: plainKey,
      id: record.id,
      name: record.name ?? null,
      email: record.email ?? null,
      wallet: record.wallet ?? null,
      environment: record.environment,
      project_id: record.projectId ?? null,
      created_at: record.createdAt,
      balance: roundCredits(balance),
      currency: "USD",
    });
  });

  app.post<{ Body: unknown }>(
    "/v1/auth/keys",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const owner = request.apiKey!;

      if (!owner.email && !owner.wallet) {
        return reply.status(400).send({
          error: {
            message:
              "This session is not linked to an email or wallet — sign in again before creating keys",
            type: "invalid_request_error",
          },
        });
      }

      const validated = validateAuthenticatedCreateKeyBody(request.body);
      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const input =
        owner.email !== undefined
          ? {
              email: owner.email,
              environment: validated.environment,
              projectId: validated.projectId,
              name: validated.name,
            }
          : {
              wallet: owner.wallet!,
              environment: validated.environment,
              projectId: validated.projectId,
              name: validated.name,
            };

      if (validated.projectId) {
        const project = await deps.store.findProjectForOwner(validated.projectId, owner);
        if (!project) {
          return reply.status(404).send({
            error: {
              message: "Project not found",
              type: "invalid_request_error",
            },
          });
        }
      }

      const { record, plainKey } = await deps.store.create(input);
      await deps.creditStore.credit(record.id, deps.initialCreditBalance, {
        source: "initial",
      });
      const balance = await deps.creditStore.getBalance(record.id);

      notifyAccountCreated({
        apiKeyId: record.id,
        source: "authenticated_key",
        email: record.email,
        wallet: record.wallet,
        isNewAccount: false,
      });

      return reply.status(201).send({
        object: "api_key",
        api_key: plainKey,
        id: record.id,
        name: record.name ?? null,
        email: record.email ?? null,
        wallet: record.wallet ?? null,
        environment: record.environment,
        project_id: record.projectId ?? null,
        created_at: record.createdAt,
        balance: roundCredits(balance),
        currency: "USD",
      });
    },
  );

  app.get<{ Querystring: { project_id?: string } }>(
    "/v1/auth/keys",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const owner = request.apiKey!;
      const projects = await deps.store.listProjectsForRecord(owner);
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));

      const projectId = request.query.project_id?.trim();
      if (projectId && !projects.some((project) => project.id === projectId)) {
        return reply.status(404).send({
          error: {
            message: "Project not found",
            type: "invalid_request_error",
          },
        });
      }

      const records = await deps.store.listForRecord(
        owner,
        projectId ? { projectId } : undefined,
      );
      const currentId = owner.id;
      const keyIds = records.map((record) => record.id);
      const [usageByKey, balances] = await Promise.all([
        deps.usageStore.getUsageForKeys(keyIds),
        deps.creditStore.getBalances(keyIds),
      ]);

      const data = records.map((record) => {
        const usage = usageByKey.get(record.id);
        const balance = balances.get(record.id) ?? 0;

        return {
          ...serializeKey(
            record,
            record.projectId ? projectNames.get(record.projectId) ?? null : null,
          ),
          balance: roundCredits(balance),
          currency: "USD",
          is_current: record.id === currentId,
          usage: {
            requests: usage?.requestCount ?? 0,
            prompt_tokens: usage?.promptTokens ?? 0,
            completion_tokens: usage?.completionTokens ?? 0,
            total_tokens: usage?.totalTokens ?? 0,
            last_request_at: usage?.lastRequestAt ?? null,
          },
        };
      });

      return {
        object: "list",
        data,
      };
    },
  );

  app.patch<{ Body: unknown }>(
    "/v1/auth/key",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const validated = validateUpdateKeyBody(request.body);

      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const targetId = validated.id ?? request.apiKey!.id;
      const updated = await deps.store.updateKey(targetId, request.apiKey!, {
        environment: validated.environment,
        projectId: validated.projectId,
        name: validated.name,
      });

      if (!updated) {
        return reply.status(404).send({
          error: {
            message: "API key not found or already revoked",
            type: "invalid_request_error",
          },
        });
      }

      const project = updated.projectId
        ? await deps.store.findProjectForOwner(updated.projectId, request.apiKey!)
        : null;

      return reply.status(200).send(serializeKey(updated, project?.name ?? null));
    },
  );

  async function sendRevokeResponse(
    targetId: string,
    owner: ApiKeyRecord,
    reply: FastifyReply,
  ) {
    const revoked = await deps.store.revoke(targetId, owner);

    if (!revoked) {
      return reply.status(404).send({
        error: {
          message: "API key not found or already revoked",
          type: "invalid_request_error",
        },
      });
    }

    return reply.status(200).send({
      object: "api_key.deleted",
      id: targetId,
      deleted: true,
    });
  }

  app.delete<{ Params: { id: string } }>(
    "/v1/auth/keys/:id",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const targetId = request.params.id.trim();
      if (!targetId) {
        return reply.status(400).send({
          error: {
            message: "Key id is required",
            type: "invalid_request_error",
          },
        });
      }

      return sendRevokeResponse(targetId, request.apiKey!, reply);
    },
  );

  app.delete<{ Body: unknown }>(
    "/v1/auth/key",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const validated = validateRevokeKeyBody(request.body);

      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const targetId = validated.id ?? request.apiKey!.id;
      return sendRevokeResponse(targetId, request.apiKey!, reply);
    },
  );

  app.get(
    "/v1/auth/projects",
    { preHandler: deps.authenticate },
    async (request) => {
      const owner = request.apiKey!;
      if (!owner.email && !owner.wallet) {
        return { object: "list", data: [] };
      }

      const projects = await deps.store.listProjectsForRecord(owner);
      const keys = await deps.store.listForRecord(owner);
      const balances = await deps.creditStore.getBalances(keys.map((key) => key.id));

      const data = projects.map((project) => {
        const projectKeys = keys.filter((key) => key.projectId === project.id);
        const balance = projectKeys.reduce(
          (sum, key) => sum + (balances.get(key.id) ?? 0),
          0,
        );
        return serializeProject(project, {
          keyCount: projectKeys.length,
          balance: roundCredits(balance),
        });
      });

      return { object: "list", data };
    },
  );

  app.post<{ Body: unknown }>(
    "/v1/auth/projects",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const owner = request.apiKey!;
      if (!owner.email && !owner.wallet) {
        return reply.status(400).send({
          error: {
            message:
              "This session is not linked to an email or wallet — sign in again before creating projects",
            type: "invalid_request_error",
          },
        });
      }

      const validated = validateCreateProjectBody(request.body);
      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const created = await deps.store.createProject(owner, validated.name);
      if (!created) {
        return reply.status(409).send({
          error: {
            message: "A project with this name already exists",
            type: "invalid_request_error",
            code: "project_name_taken",
          },
        });
      }

      return reply.status(201).send(
        serializeProject(created, { keyCount: 0, balance: 0 }),
      );
    },
  );

  app.patch<{ Body: unknown }>(
    "/v1/auth/projects",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const validated = validateUpdateProjectBody(request.body);
      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const updated = await deps.store.renameProject(
        validated.id,
        request.apiKey!,
        validated.name,
      );
      if (!updated) {
        return reply.status(404).send({
          error: {
            message: "Project not found, or a project with this name already exists",
            type: "invalid_request_error",
          },
        });
      }

      return reply.status(200).send(serializeProject(updated));
    },
  );

  app.delete<{ Body: unknown }>(
    "/v1/auth/projects",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const validated = validateDeleteProjectBody(request.body);
      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      const deleted = await deps.store.deleteProject(validated.id, request.apiKey!);
      if (!deleted.ok) {
        const status = deleted.code === "default_project" ? 400 : 404;
        return reply.status(status).send({
          error: {
            message: deleted.message,
            type: "invalid_request_error",
            code: deleted.code,
          },
        });
      }

      return reply.status(200).send({
        object: "project.deleted",
        id: validated.id,
        deleted: true,
        moved_keys: deleted.movedKeyCount,
      });
    },
  );

  app.post<{ Body: unknown }>(
    "/v1/auth/wallet/link",
    { preHandler: deps.authenticate },
    async (request, reply) => {
      const owner = request.apiKey!;
      if (!owner.email?.trim()) {
        return reply.status(400).send({
          error: {
            message:
              "Linking a funding wallet requires an email (Clerk) session. Sign in with email first, or use wallet sign-in directly.",
            type: "invalid_request_error",
            code: "email_required",
          },
        });
      }

      const validated = validateWalletVerifyBody(request.body);
      if (typeof validated === "string") {
        return reply.status(400).send({
          error: { message: validated, type: "invalid_request_error" },
        });
      }

      let address: string;
      let nonce: string;
      try {
        const verified = await verifySiweMessage(
          validated.message!,
          validated.signature!,
          deps.siwe,
        );
        address = verified.address;
        nonce = verified.nonce;
      } catch {
        return reply.status(401).send({
          error: {
            message: "Invalid or expired wallet signature",
            type: "authentication_error",
          },
        });
      }

      const nonceValid = await deps.walletNonceStore.consume(address, nonce);
      if (!nonceValid) {
        return reply.status(401).send({
          error: {
            message: "Invalid or expired wallet signature",
            type: "authentication_error",
          },
        });
      }

      const linked = await deps.store.linkWallet(owner.id, address);
      if (!linked.ok) {
        const status =
          linked.code === "wallet_taken" || linked.code === "wallet_already_linked"
            ? 409
            : 400;
        return reply.status(status).send({
          error: {
            message: linked.message,
            type: "invalid_request_error",
            code: linked.code,
          },
        });
      }

      return reply.status(200).send({
        object: "wallet_link",
        wallet: linked.record.wallet!,
        email: linked.record.email ?? null,
        api_key_id: linked.record.id,
        note: "Wallet linked for USDC funding. Send deposits from this address to credit your account.",
      });
    },
  );
}
