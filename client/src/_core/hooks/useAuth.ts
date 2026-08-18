import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppRouter } from "../../../../server/routers";

const AUTH_CACHE_KEY = "nginx-gateway-owner-session";
const THREE_DAYS_MS = 1000 * 60 * 60 * 24 * 3;

type AuthUser = NonNullable<inferRouterOutputs<AppRouter>["auth"]["me"]>;
type CachedAuth = { user: AuthUser; expiresAt: number };

function readCachedAuth(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedAuth;
    if (!cached || cached.expiresAt <= Date.now() || !cached.user) {
      localStorage.removeItem(AUTH_CACHE_KEY);
      return null;
    }
    return cached.user;
  } catch {
    return null;
  }
}

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // Login is started via startLogin() in the effect below, only when we actually
  // navigate — never during render. startLogin() mints a one-time nonce + writes
  // the state cookie, so calling it per render would overwrite the cookie and
  // desync it from an in-flight login's `state`.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();
  const [cachedUser] = useState<AuthUser | null>(() => readCachedAuth());
  const cachedQueryState = cachedUser
    ? { initialData: cachedUser, initialDataUpdatedAt: Date.now() }
    : {};

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: THREE_DAYS_MS,
    gcTime: THREE_DAYS_MS,
    ...cachedQueryState,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Clear the Preview auto-login token mirrored into sessionStorage, so
      // header-based sessions (Safari ITP / WebView) are logged out too. The
      // backend cookie is cleared by the logout mutation.
      try {
        sessionStorage.removeItem("manus-cookie");
        localStorage.removeItem(AUTH_CACHE_KEY);
      } catch {}
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  useEffect(() => {
    if (!meQuery.isFetchedAfterMount) return;
    try {
      if (meQuery.data) {
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ user: meQuery.data, expiresAt: Date.now() + THREE_DAYS_MS }));
      } else if (!meQuery.isFetching) {
        localStorage.removeItem(AUTH_CACHE_KEY);
      }
    } catch {}
  }, [meQuery.data, meQuery.isFetchedAfterMount, meQuery.isFetching]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Navigate at this moment only. startLogin() mints the nonce + cookie itself.
    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      startLogin();
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
