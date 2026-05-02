import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(),
  hasAnyAuthProfileStoreSource: vi.fn(),
  listProfilesForProvider: vi.fn(
    (store: { profiles: Record<string, { provider: string }> }, provider: string) =>
      Object.entries(store.profiles)
        .filter(([, credential]) => credential.provider === provider)
        .map(([id]) => id),
  ),
}));

vi.mock("../auth-profiles.js", () => authMocks);

import { hasAuthForProvider, withAuthProviderResolutionCache } from "./model-config.helpers.js";

const TEST_AGENT_DIR = "/tmp/openclaw-tool-model-auth-cache";

function authStore() {
  return {
    version: 1,
    profiles: {
      configured: {
        type: "api_key",
        provider: "cached-provider",
        key: "test-key",
      },
    },
  };
}

describe("withAuthProviderResolutionCache", () => {
  beforeEach(() => {
    authMocks.ensureAuthProfileStore.mockReset();
    authMocks.hasAnyAuthProfileStoreSource.mockReset();
    authMocks.listProfilesForProvider.mockClear();
    authMocks.hasAnyAuthProfileStoreSource.mockReturnValue(true);
    authMocks.ensureAuthProfileStore.mockReturnValue(authStore());
  });

  it("reuses the auth store while resolving tool providers", () => {
    const results = withAuthProviderResolutionCache(() => [
      hasAuthForProvider({ provider: "cached-provider", agentDir: TEST_AGENT_DIR }),
      hasAuthForProvider({ provider: "missing-provider", agentDir: TEST_AGENT_DIR }),
      hasAuthForProvider({ provider: "cached-provider", agentDir: TEST_AGENT_DIR }),
    ]);

    expect(results).toEqual([true, false, true]);
    expect(authMocks.ensureAuthProfileStore).toHaveBeenCalledTimes(1);
    expect(authMocks.listProfilesForProvider).toHaveBeenCalledTimes(2);
  });
});
