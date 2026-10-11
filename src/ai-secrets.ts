import type { FinanceAiConfig } from "./ai";

export interface AiSecretStorage {
  getSecret(id: string): string | null;
  setSecret(id: string, value: string): void;
}

interface AiSecretSettings {
  financeAiEndpoint: string;
  financeAiModel: string;
  financeAiSecretId?: string;
}

// SecretComponent can emit null when its selection is cleared, despite its typings.
export function normalizeAiSecretId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function newSecretId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `ledger-statistics-ai-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Never remove the legacy value from disk until the keychain value is verified. */
export function migrateAiSecret(data: Record<string, unknown>, storage: AiSecretStorage | undefined, createId = newSecretId): { data: Record<string, unknown>; changed: boolean } {
  const { financeAiApiKey: legacyValue, ...clean } = data;
  let id = normalizeAiSecretId(clean.financeAiSecretId);
  const legacy = typeof legacyValue === "string" ? legacyValue.trim() : "";
  if (legacy) {
    try {
      if (!storage) throw new Error();
      if (!id) id = createId();
      const existing = storage.getSecret(id);
      // Preserve an existing device credential rather than overwrite it with a synced value.
      if (existing && existing !== legacy) id = createId();
      if (storage.getSecret(id) !== legacy) storage.setSecret(id, legacy);
      if (storage.getSecret(id) !== legacy) throw new Error();
    } catch {
      throw new Error("API 密钥迁移失败，原数据文件已保留。请检查 Obsidian 钥匙串后重新启用插件。");
    }
  }
  return {
    data: { ...clean, financeAiSecretId: id },
    changed: Object.prototype.hasOwnProperty.call(data, "financeAiApiKey") || data.financeAiSecretId !== id
  };
}

/** Defense in depth: old fields received from another device must never be saved again. */
export function withoutLegacyAiSecret<T extends object>(settings: T): Omit<T, "financeAiApiKey"> {
  const { financeAiApiKey: _legacy, ...clean } = settings as T & { financeAiApiKey?: unknown };
  return clean;
}

export function financeAiConfig(settings: AiSecretSettings, app?: { secretStorage?: AiSecretStorage }): FinanceAiConfig {
  const config: FinanceAiConfig = { endpoint: settings.financeAiEndpoint, model: settings.financeAiModel, apiKey: "" };
  const id = normalizeAiSecretId(settings.financeAiSecretId);
  if (!id) return config; // Local endpoints can intentionally have no credential.
  try {
    const value = app?.secretStorage?.getSecret(id);
    if (!value?.trim()) config.credentialError = "本机钥匙串缺少所选 API 密钥，请在设置中配置同名密钥。";
    else config.apiKey = value.trim();
  } catch {
    config.credentialError = "无法读取 Obsidian 钥匙串，请检查本机密钥设置。";
  }
  return config;
}
