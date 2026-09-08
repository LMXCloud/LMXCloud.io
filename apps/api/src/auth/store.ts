import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  DEFAULT_API_KEY_ENVIRONMENT,
  isApiKeyEnvironment,
  type ApiKeyEnvironment,
} from "./environment.js";
import { generateApiKey, hashApiKey } from "./keys.js";
import { DEFAULT_PROJECT_NAME } from "./projects.js";
import { normalizeWalletAddress } from "./wallet.js";

export type { ApiKeyEnvironment } from "./environment.js";
export { DEFAULT_PROJECT_NAME } from "./projects.js";

export interface ProjectRecord {
  id: string;
  name: string;
  email?: string;
  wallet?: string;
  isDefault: boolean;
  createdAt: string;
}

export type DeleteProjectResult =
  | { ok: true; movedKeyCount: number }
  | {
      ok: false;
      code: "not_found" | "default_project";
      message: string;
    };

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  email?: string;
  wallet?: string;
  environment: ApiKeyEnvironment;
  projectId?: string;
  name?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface CreateApiKeyInput {
  email?: string;
  wallet?: string;
  environment?: ApiKeyEnvironment;
  projectId?: string;
  name?: string;
}

export type UpdateApiKeyPatch = {
  environment?: ApiKeyEnvironment;
  projectId?: string;
  name?: string;
};

export type LinkWalletResult =
  | { ok: true; record: ApiKeyRecord }
  | {
      ok: false;
      code: "email_required" | "wallet_taken" | "wallet_already_linked" | "not_found";
      message: string;
    };

export interface ApiKeyStore {
  create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plainKey: string }>;
  findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null>;
  findById(id: string): Promise<ApiKeyRecord | null>;
  findPrimaryKeyForEmail(email: string): Promise<ApiKeyRecord | null>;
  findPrimaryKeyForWallet(wallet: string): Promise<ApiKeyRecord | null>;
  /** Attach a verified wallet to an email account (all active keys). */
  linkWallet(apiKeyId: string, wallet: string): Promise<LinkWalletResult>;
  touchLastUsed(id: string): Promise<void>;
  listForRecord(
    record: ApiKeyRecord,
    options?: { projectId?: string },
  ): Promise<ApiKeyRecord[]>;
  updateEnvironment(
    id: string,
    owner: ApiKeyRecord,
    environment: ApiKeyEnvironment,
  ): Promise<ApiKeyRecord | null>;
  updateKey(
    id: string,
    owner: ApiKeyRecord,
    patch: UpdateApiKeyPatch,
  ): Promise<ApiKeyRecord | null>;
  revoke(id: string, owner: ApiKeyRecord): Promise<boolean>;
  emailHasAccount(email: string): Promise<boolean>;
  walletHasAccount(wallet: string): Promise<boolean>;
  listProjectsForRecord(record: ApiKeyRecord): Promise<ProjectRecord[]>;
  ensureDefaultProject(owner: ApiKeyRecord): Promise<ProjectRecord | null>;
  findProjectForOwner(id: string, owner: ApiKeyRecord): Promise<ProjectRecord | null>;
  createProject(owner: ApiKeyRecord, name: string): Promise<ProjectRecord | null>;
  renameProject(id: string, owner: ApiKeyRecord, name: string): Promise<ProjectRecord | null>;
  deleteProject(id: string, owner: ApiKeyRecord): Promise<DeleteProjectResult>;
}

function sameAccount(
  a: { email?: string; wallet?: string },
  b: { email?: string; wallet?: string },
): boolean {
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) {
    return true;
  }
  if (
    a.wallet &&
    b.wallet &&
    a.wallet.trim().toLowerCase() === b.wallet.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

export class FileApiKeyStore implements ApiKeyStore {
  private records: ApiKeyRecord[] = [];
  private projects: ProjectRecord[] = [];
  private loaded = false;

  constructor(private readonly filePath: string) {}

  private projectsPath(): string {
    const parsed = path.parse(this.filePath);
    return path.join(parsed.dir, `${parsed.name}.projects.json`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Array<Partial<ApiKeyRecord>>;
      let mutated = false;
      this.records = parsed.map((entry) => {
        const projectId =
          typeof entry.projectId === "string" && entry.projectId.trim()
            ? entry.projectId
            : undefined;
        if (isApiKeyEnvironment(entry.environment)) {
          return { ...entry, projectId } as ApiKeyRecord;
        }
        mutated = true;
        return {
          ...entry,
          environment: DEFAULT_API_KEY_ENVIRONMENT,
          projectId,
        } as ApiKeyRecord;
      });
      this.loaded = true;
      await this.loadProjects();
      if (mutated) {
        await this.persist();
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.records = [];
    }

    this.loaded = true;
    await this.loadProjects();
  }

  private async loadProjects(): Promise<void> {
    try {
      const raw = await fs.readFile(this.projectsPath(), "utf-8");
      const parsed = JSON.parse(raw) as Array<Partial<ProjectRecord>>;
      this.projects = parsed
        .filter((entry) => typeof entry.id === "string" && typeof entry.name === "string")
        .map((entry) => ({
          id: entry.id as string,
          name: entry.name as string,
          email: entry.email,
          wallet: entry.wallet,
          isDefault: Boolean(entry.isDefault),
          createdAt: typeof entry.createdAt === "string"
            ? entry.createdAt
            : new Date().toISOString(),
        }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
      this.projects = [];
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.records, null, 2), "utf-8");
    await fs.writeFile(
      this.projectsPath(),
      JSON.stringify(this.projects, null, 2),
      "utf-8",
    );
  }

  private projectsForOwner(owner: ApiKeyRecord): ProjectRecord[] {
    return this.projects
      .filter((project) => sameAccount(project, owner))
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async create(input: CreateApiKeyInput): Promise<{ record: ApiKeyRecord; plainKey: string }> {
    await this.ensureLoaded();

    const ownerHint: ApiKeyRecord = {
      id: "pending",
      keyHash: "",
      email: input.email,
      wallet: input.wallet ? normalizeWalletAddress(input.wallet) : undefined,
      environment: input.environment ?? DEFAULT_API_KEY_ENVIRONMENT,
      createdAt: new Date().toISOString(),
    };

    let projectId = input.projectId;
    if (projectId) {
      const project = this.projectsForOwner(ownerHint).find((entry) => entry.id === projectId);
      if (!project) {
        projectId = undefined;
      }
    }
    if (!projectId && (ownerHint.email || ownerHint.wallet)) {
      const fallback = await this.ensureDefaultProject(ownerHint);
      projectId = fallback?.id;
    }

    const plainKey = generateApiKey();
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      keyHash: hashApiKey(plainKey),
      email: input.email,
      wallet: input.wallet ? normalizeWalletAddress(input.wallet) : undefined,
      environment: input.environment ?? DEFAULT_API_KEY_ENVIRONMENT,
      projectId,
      name: input.name,
      createdAt: new Date().toISOString(),
    };

    this.records.push(record);
    await this.persist();

    return { record, plainKey };
  }

  async findByPlainKey(plainKey: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const keyHash = hashApiKey(plainKey);
    const record = this.records.find(
      (entry) => entry.keyHash === keyHash && !entry.revokedAt,
    );
    return record ?? null;
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const record = this.records.find((entry) => entry.id === id && !entry.revokedAt);
    return record ?? null;
  }

  async findPrimaryKeyForEmail(email: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const normalized = email.trim().toLowerCase();
    const matches = this.records
      .filter(
        (entry) =>
          !entry.revokedAt && entry.email?.trim().toLowerCase() === normalized,
      )
      .sort((a, b) => {
        const aUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
        const bUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
        if (bUsed !== aUsed) return bUsed - aUsed;
        return b.createdAt.localeCompare(a.createdAt);
      });

    return matches[0] ?? null;
  }

  async findPrimaryKeyForWallet(wallet: string): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const normalized = wallet.trim().toLowerCase();
    const matches = this.records
      .filter(
        (entry) =>
          !entry.revokedAt && entry.wallet?.trim().toLowerCase() === normalized,
      )
      .sort((a, b) => {
        const aUsed = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
        const bUsed = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
        if (bUsed !== aUsed) return bUsed - aUsed;
        return b.createdAt.localeCompare(a.createdAt);
      });

    return matches[0] ?? null;
  }

  async linkWallet(apiKeyId: string, wallet: string): Promise<LinkWalletResult> {
    await this.ensureLoaded();
    const owner = this.records.find((entry) => entry.id === apiKeyId && !entry.revokedAt);
    if (!owner) {
      return { ok: false, code: "not_found", message: "API key not found" };
    }
    if (!owner.email?.trim()) {
      return {
        ok: false,
        code: "email_required",
        message: "Only email accounts can link a funding wallet from this session",
      };
    }

    const normalized = normalizeWalletAddress(wallet);
    if (owner.wallet) {
      if (owner.wallet === normalized) {
        return { ok: true, record: owner };
      }
      return {
        ok: false,
        code: "wallet_already_linked",
        message: "This account already has a different funding wallet linked",
      };
    }

    const email = owner.email.trim().toLowerCase();
    const conflict = this.records.find(
      (entry) =>
        !entry.revokedAt &&
        entry.wallet === normalized &&
        entry.email?.trim().toLowerCase() !== email,
    );
    if (conflict) {
      return {
        ok: false,
        code: "wallet_taken",
        message: "This wallet is already linked to another LMX account",
      };
    }

    const now = new Date().toISOString();
    for (const entry of this.records) {
      if (entry.revokedAt) continue;
      if (entry.email?.trim().toLowerCase() !== email) continue;
      entry.wallet = normalized;
      entry.lastUsedAt = now;
    }
    for (const project of this.projects) {
      if (project.email?.trim().toLowerCase() !== email) continue;
      project.wallet = normalized;
    }
    await this.persist();

    const updated = this.records.find((entry) => entry.id === apiKeyId && !entry.revokedAt);
    return updated
      ? { ok: true, record: updated }
      : { ok: false, code: "not_found", message: "API key not found" };
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.ensureLoaded();
    const record = this.records.find((entry) => entry.id === id);
    if (!record || record.revokedAt) return;

    record.lastUsedAt = new Date().toISOString();
    await this.persist();
  }

  async listForRecord(
    record: ApiKeyRecord,
    options?: { projectId?: string },
  ): Promise<ApiKeyRecord[]> {
    await this.ensureLoaded();
    const active = this.records.filter((entry) => !entry.revokedAt);

    let matches: ApiKeyRecord[];
    if (record.email) {
      matches = active.filter((entry) => entry.email === record.email);
    } else if (record.wallet) {
      matches = active.filter((entry) => entry.wallet === record.wallet);
    } else {
      const current = active.find((entry) => entry.id === record.id);
      matches = current ? [current] : [];
    }

    if (options?.projectId) {
      matches = matches.filter((entry) => entry.projectId === options.projectId);
    }

    return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateEnvironment(
    id: string,
    owner: ApiKeyRecord,
    environment: ApiKeyEnvironment,
  ): Promise<ApiKeyRecord | null> {
    return this.updateKey(id, owner, { environment });
  }

  async updateKey(
    id: string,
    owner: ApiKeyRecord,
    patch: UpdateApiKeyPatch,
  ): Promise<ApiKeyRecord | null> {
    await this.ensureLoaded();
    const allowed = await this.listForRecord(owner);
    if (!allowed.some((entry) => entry.id === id)) {
      return null;
    }

    const record = this.records.find((entry) => entry.id === id);
    if (!record || record.revokedAt) {
      return null;
    }

    if (patch.projectId) {
      const project = this.projectsForOwner(owner).find((entry) => entry.id === patch.projectId);
      if (!project) {
        return null;
      }
      record.projectId = project.id;
    }

    if (patch.environment) {
      record.environment = patch.environment;
    }

    if (patch.name !== undefined) {
      record.name = patch.name;
    }

    await this.persist();
    return record;
  }

  async revoke(id: string, owner: ApiKeyRecord): Promise<boolean> {
    await this.ensureLoaded();
    const allowed = await this.listForRecord(owner);
    if (!allowed.some((entry) => entry.id === id)) {
      return false;
    }

    const record = this.records.find((entry) => entry.id === id);
    if (!record || record.revokedAt) {
      return false;
    }

    record.revokedAt = new Date().toISOString();
    await this.persist();
    return true;
  }

  async emailHasAccount(email: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = email.trim().toLowerCase();
    return this.records.some(
      (entry) =>
        !entry.revokedAt &&
        entry.email?.trim().toLowerCase() === normalized,
    );
  }

  async walletHasAccount(wallet: string): Promise<boolean> {
    await this.ensureLoaded();
    const normalized = wallet.trim().toLowerCase();
    return this.records.some(
      (entry) =>
        !entry.revokedAt &&
        entry.wallet?.trim().toLowerCase() === normalized,
    );
  }

  async listProjectsForRecord(record: ApiKeyRecord): Promise<ProjectRecord[]> {
    await this.ensureLoaded();
    await this.ensureDefaultProject(record);
    return this.projectsForOwner(record);
  }

  async ensureDefaultProject(owner: ApiKeyRecord): Promise<ProjectRecord | null> {
    await this.ensureLoaded();
    if (!owner.email && !owner.wallet) {
      return null;
    }

    let existing = this.projectsForOwner(owner).find((project) => project.isDefault);
    let mutated = false;
    if (!existing) {
      existing = {
        id: crypto.randomUUID(),
        name: DEFAULT_PROJECT_NAME,
        email: owner.email,
        wallet: owner.wallet,
        isDefault: true,
        createdAt: new Date().toISOString(),
      };
      this.projects.push(existing);
      mutated = true;
    }

    for (const entry of this.records) {
      if (entry.projectId) continue;
      if (!sameAccount(entry, owner)) continue;
      entry.projectId = existing.id;
      mutated = true;
    }

    if (mutated) {
      await this.persist();
    }

    return existing;
  }

  async findProjectForOwner(id: string, owner: ApiKeyRecord): Promise<ProjectRecord | null> {
    await this.ensureLoaded();
    return this.projectsForOwner(owner).find((project) => project.id === id) ?? null;
  }

  async createProject(owner: ApiKeyRecord, name: string): Promise<ProjectRecord | null> {
    await this.ensureLoaded();
    if (!owner.email && !owner.wallet) {
      return null;
    }

    await this.ensureDefaultProject(owner);
    const duplicate = this.projectsForOwner(owner).some(
      (project) => project.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      return null;
    }

    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      name,
      email: owner.email,
      wallet: owner.wallet,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };
    this.projects.push(project);
    await this.persist();
    return project;
  }

  async renameProject(
    id: string,
    owner: ApiKeyRecord,
    name: string,
  ): Promise<ProjectRecord | null> {
    await this.ensureLoaded();
    const project = this.projectsForOwner(owner).find((entry) => entry.id === id);
    if (!project) {
      return null;
    }

    const duplicate = this.projectsForOwner(owner).some(
      (entry) => entry.id !== id && entry.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      return null;
    }

    project.name = name;
    await this.persist();
    return project;
  }

  async deleteProject(id: string, owner: ApiKeyRecord): Promise<DeleteProjectResult> {
    await this.ensureLoaded();
    const project = this.projectsForOwner(owner).find((entry) => entry.id === id);
    if (!project) {
      return { ok: false, code: "not_found", message: "Project not found" };
    }
    if (project.isDefault) {
      return {
        ok: false,
        code: "default_project",
        message: "The Default project cannot be deleted",
      };
    }

    const fallback = await this.ensureDefaultProject(owner);
    if (!fallback) {
      return { ok: false, code: "not_found", message: "Project not found" };
    }

    let movedKeyCount = 0;
    for (const entry of this.records) {
      if (entry.projectId !== project.id) continue;
      if (!sameAccount(entry, owner)) continue;
      entry.projectId = fallback.id;
      if (!entry.revokedAt) movedKeyCount += 1;
    }

    this.projects = this.projects.filter((entry) => entry.id !== project.id);
    await this.persist();
    return { ok: true, movedKeyCount };
  }
}
