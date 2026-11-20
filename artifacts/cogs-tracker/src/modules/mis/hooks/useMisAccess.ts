import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useMisGetCurrentAccess } from "@workspace/api-client-react";

const cacheOwners = new WeakMap<QueryClient, string>();

/** User-keyed, fail-closed access check shared by both application shells. */
export function useMisAccess() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? "";
  useEffect(() => {
    if (cacheOwners.get(queryClient) === userId) return;
    cacheOwners.set(queryClient, userId);
    // Do not carry another signed-in user's MIS data into this session.
    queryClient.removeQueries({
      predicate: ({ queryKey }) =>
        queryKey.some((key) => typeof key === "string" && key.includes("/api/mis")) &&
        !(queryKey[0] === "/api/mis/me" && queryKey[1] === userId),
    });
  }, [queryClient, userId]);
  return useMisGetCurrentAccess({
    query: {
      queryKey: ["/api/mis/me", userId],
      enabled: Boolean(userId),
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: "always",
      refetchInterval: 15_000,
      retry: false,
    },
  });
}