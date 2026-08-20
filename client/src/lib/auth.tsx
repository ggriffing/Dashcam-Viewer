import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth as useClerkAuth, useClerk, useUser } from "@clerk/react";
import { apiRequest, getQueryFn } from "./queryClient";
import { queryClient } from "./queryClient";

export interface AuthUser {
  id: string;
  username: string;
}

interface AuthResponse {
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (username: string, password: string) => Promise<AuthUser>;
  signUp: (username: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const authQueryKey = ["/api/auth/me"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded: isClerkLoaded, isSignedIn } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut: clerkSignOut } = useClerk();
  const { data, isLoading: isLocalLoading } = useQuery<AuthResponse | null>({
    queryKey: authQueryKey,
    queryFn: getQueryFn<AuthResponse | null>({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
    enabled: isClerkLoaded && !isSignedIn,
  });

  useEffect(() => {
    const clearSession = () => queryClient.setQueryData(authQueryKey, null);
    window.addEventListener("auth:unauthorized", clearSession);
    return () => window.removeEventListener("auth:unauthorized", clearSession);
  }, []);

  async function authenticate(endpoint: string, username: string, password: string) {
    const response = await apiRequest("POST", endpoint, { username, password });
    const result = (await response.json()) as AuthResponse;
    queryClient.setQueryData<AuthResponse>(authQueryKey, result);
    return result.user;
  }

  async function signOut() {
    if (isSignedIn) {
      // Clear a legacy username/password session too. A browser can have both
      // session types after a user tries social sign-in, and leaving the local
      // session active would immediately sign them back into the viewer.
      await apiRequest("POST", "/api/auth/signout");
      queryClient.setQueryData(authQueryKey, null);
      await clerkSignOut({ redirectUrl: "/" });
      return;
    }
    await apiRequest("POST", "/api/auth/signout");
    queryClient.setQueryData(authQueryKey, null);
  }

  const socialUser = clerkUser
    ? {
        id: clerkUser.id,
        username:
          clerkUser.username ||
          clerkUser.firstName ||
          clerkUser.primaryEmailAddress?.emailAddress.split("@")[0] ||
          "Tesla driver",
      }
    : null;

  return (
    <AuthContext.Provider
      value={{
        user: socialUser ?? data?.user ?? null,
        isLoading: !isClerkLoaded || (!isSignedIn && isLocalLoading),
        signIn: (username, password) => authenticate("/api/auth/signin", username, password),
        signUp: (username, password) => authenticate("/api/auth/signup", username, password),
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}