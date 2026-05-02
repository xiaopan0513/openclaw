import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
  resolveAgentModelTimeoutMsValue,
} from "../../config/model-input.js";
import type { AgentModelConfig } from "../../config/types.agents-shared.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  ensureAuthProfileStore,
  hasAnyAuthProfileStoreSource,
  listProfilesForProvider,
  type AuthProfileStore,
} from "../auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import { resolveEnvApiKey } from "../model-auth.js";
import { resolveConfiguredModelRef } from "../model-selection.js";

export type ToolModelConfig = { primary?: string; fallbacks?: string[]; timeoutMs?: number };

type AuthProviderResolutionCache = {
  storesByAgentDir: Map<string, AuthProfileStore | null>;
  resultsByProvider: Map<string, boolean>;
};

let activeAuthProviderResolutionCache: AuthProviderResolutionCache | undefined;

export function withAuthProviderResolutionCache<T>(fn: () => T): T {
  if (activeAuthProviderResolutionCache) {
    return fn();
  }
  activeAuthProviderResolutionCache = {
    storesByAgentDir: new Map(),
    resultsByProvider: new Map(),
  };
  try {
    return fn();
  } finally {
    activeAuthProviderResolutionCache = undefined;
  }
}

function resolveCachedAuthProfileStore(agentDir: string): AuthProfileStore | null {
  const cache = activeAuthProviderResolutionCache;
  if (!cache) {
    return ensureAuthProfileStore(agentDir, {
      allowKeychainPrompt: false,
    });
  }
  if (cache.storesByAgentDir.has(agentDir)) {
    return cache.storesByAgentDir.get(agentDir) ?? null;
  }
  const store = ensureAuthProfileStore(agentDir, {
    allowKeychainPrompt: false,
  });
  cache.storesByAgentDir.set(agentDir, store);
  return store;
}

export function hasToolModelConfig(model: ToolModelConfig | undefined): boolean {
  return Boolean(
    model?.primary?.trim() || (model?.fallbacks ?? []).some((entry) => entry.trim().length > 0),
  );
}

export function resolveDefaultModelRef(cfg?: OpenClawConfig): { provider: string; model: string } {
  if (cfg) {
    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });
    return { provider: resolved.provider, model: resolved.model };
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

export function hasAuthForProvider(params: { provider: string; agentDir?: string }): boolean {
  if (resolveEnvApiKey(params.provider)?.apiKey) {
    return true;
  }
  const agentDir = params.agentDir?.trim();
  if (!agentDir) {
    return false;
  }
  const cache = activeAuthProviderResolutionCache;
  const cacheKey = `${agentDir}\0${params.provider}`;
  if (cache?.resultsByProvider.has(cacheKey)) {
    return cache.resultsByProvider.get(cacheKey) ?? false;
  }
  if (!hasAnyAuthProfileStoreSource(agentDir)) {
    cache?.resultsByProvider.set(cacheKey, false);
    return false;
  }
  const store = resolveCachedAuthProfileStore(agentDir);
  const result = store ? listProfilesForProvider(store, params.provider).length > 0 : false;
  cache?.resultsByProvider.set(cacheKey, result);
  return result;
}

export function coerceToolModelConfig(model?: AgentModelConfig): ToolModelConfig {
  const primary = resolveAgentModelPrimaryValue(model);
  const fallbacks = resolveAgentModelFallbackValues(model);
  const timeoutMs = resolveAgentModelTimeoutMsValue(model);
  return {
    ...(primary?.trim() ? { primary: primary.trim() } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function buildToolModelConfigFromCandidates(params: {
  explicit: ToolModelConfig;
  agentDir?: string;
  candidates: Array<string | null | undefined>;
  isProviderConfigured?: (provider: string) => boolean;
}): ToolModelConfig | null {
  if (hasToolModelConfig(params.explicit)) {
    return params.explicit;
  }

  const deduped: string[] = [];
  for (const candidate of params.candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || !trimmed.includes("/")) {
      continue;
    }
    const provider = trimmed.slice(0, trimmed.indexOf("/")).trim();
    const providerConfigured =
      params.isProviderConfigured?.(provider) ??
      hasAuthForProvider({ provider, agentDir: params.agentDir });
    if (!provider || !providerConfigured) {
      continue;
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed);
    }
  }

  if (deduped.length === 0) {
    return null;
  }

  return {
    primary: deduped[0],
    ...(deduped.length > 1 ? { fallbacks: deduped.slice(1) } : {}),
    ...(params.explicit.timeoutMs !== undefined ? { timeoutMs: params.explicit.timeoutMs } : {}),
  };
}
