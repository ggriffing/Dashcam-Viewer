import { FormEvent, useEffect, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { ArrowRight, LockKeyhole, LogIn, UserRound, UserRoundPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/queryClient";
import { Link } from "wouter";

type AuthMode = "signin" | "signup";

function AuthLoading() {
  return (
    <div className="min-h-screen bg-[#090909] flex items-center justify-center text-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#e82127]" />
    </div>
  );
}

export default function AuthPage() {
  const { user, isLoading, signIn, signUp } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate("/viewer");
  }, [user, navigate]);

  if (isLoading) return <AuthLoading />;
  if (user) return <Redirect to="/viewer" />;

  const isSignUp = mode === "signup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    if (isSignUp && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await signUp(username, password);
      } else {
        await signIn(username, password);
      }
      navigate("/");
    } catch (submissionError) {
      setError(
        submissionError instanceof ApiError
          ? submissionError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setPassword("");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#090909] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(232,33,39,0.13),transparent_38%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-[#e82127]/50 bg-[#e82127]/10 shadow-[0_0_32px_rgba(232,33,39,0.18)]">
            <div className="h-4 w-4 rounded-full bg-[#e82127] shadow-[0_0_16px_rgba(232,33,39,0.8)]" />
          </div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.35em] text-[#e82127]">
            Tesla Dashcam
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {isSignUp ? "Create your viewer account" : "Welcome back"}
          </h1>
          <p className="mt-3 text-sm text-white/50">
            {isSignUp
              ? "Keep your dashcam viewer access secure."
              : "Sign in to continue to your dashcam viewer."}
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-6 shadow-2xl backdrop-blur-sm sm:p-8">
          <div className="mb-6">
            <Link
              href="/sign-in"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.07] text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/[0.12]"
            >
              Continue with Google or Apple
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-2 text-center text-xs text-white/40">
              Secure social sign-in opens in the next step.
            </p>
          </div>

          <div className="mb-6 flex items-center gap-3 text-xs uppercase tracking-wider text-white/35">
            <span className="h-px flex-1 bg-white/10" />
            or use username
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-lg bg-black/30 p-1">
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className={`rounded-md px-3 py-2 text-sm transition ${
                !isSignUp ? "bg-white/10 font-medium text-white" : "text-white/45 hover:text-white/70"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`rounded-md px-3 py-2 text-sm transition ${
                isSignUp ? "bg-white/10 font-medium text-white" : "text-white/45 hover:text-white/70"
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55">
                Username
              </span>
              <span className="relative block">
                <UserRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-white/35" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="h-11 w-full rounded-md border border-white/15 bg-black/25 pl-10 pr-3 text-sm outline-none transition placeholder:text-white/25 focus:border-[#e82127] focus:ring-1 focus:ring-[#e82127]"
                  placeholder="Enter your username"
                  autoComplete="username"
                  maxLength={32}
                  autoFocus
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55">
                Password
              </span>
              <span className="relative block">
                <LockKeyhole className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-white/35" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11 w-full rounded-md border border-white/15 bg-black/25 pl-10 pr-3 text-sm outline-none transition placeholder:text-white/25 focus:border-[#e82127] focus:ring-1 focus:ring-[#e82127]"
                  placeholder={isSignUp ? "At least 8 characters" : "Enter your password"}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  maxLength={128}
                />
              </span>
            </label>

            {error && (
              <p role="alert" className="rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="h-11 w-full bg-[#e82127] hover:bg-[#c91c22]">
              {isSubmitting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : isSignUp ? (
                <UserRoundPlus />
              ) : (
                <LogIn />
              )}
              {isSignUp ? "Create account" : "Sign in"}
            </Button>
          </form>
        </section>

        <p className="mt-6 text-center text-xs text-white/30">
          Local dashcam processing. Your video files stay in your browser.
        </p>
      </div>
    </main>
  );
}