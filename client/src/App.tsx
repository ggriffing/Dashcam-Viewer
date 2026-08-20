import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from "wouter";
import { ClerkProvider, SignIn, SignUp } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashcamViewer from "@/pages/DashcamViewer";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import { AuthProvider, useAuth } from "@/lib/auth";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: "top" as const,
  },
  variables: {
    colorPrimary: "#e82127",
    colorForeground: "#ffffff",
    colorMutedForeground: "#a3a3a3",
    colorDanger: "#ff6262",
    colorBackground: "#171717",
    colorInput: "#0d0d0d",
    colorInputForeground: "#ffffff",
    colorNeutral: "#4a4a4a",
    fontFamily: "Roboto, system-ui, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "w-[440px] max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#171717] shadow-2xl",
    card: "!bg-transparent !border-0 !shadow-none",
    footer: "!bg-transparent !border-0 !shadow-none",
    headerTitle: "text-white",
    headerSubtitle: "text-neutral-400",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-neutral-300",
    footerActionLink: "text-[#ff5a60]",
    footerActionText: "text-neutral-400",
    dividerText: "text-neutral-500",
    identityPreviewEditButton: "text-[#ff5a60]",
    formFieldSuccessText: "text-green-300",
    alertText: "text-white",
    socialButtonsBlockButton: "border-neutral-700 bg-neutral-900 hover:bg-neutral-800",
    formButtonPrimary: "bg-[#e82127] hover:bg-[#c91c22]",
    formFieldInput: "border-neutral-700 bg-black text-white",
    footerAction: "border-t border-neutral-800",
    dividerLine: "bg-neutral-700",
    alert: "bg-red-950/50 text-white",
    otpCodeFieldInput: "border-neutral-700 bg-black text-white",
    formFieldRow: "gap-2",
    main: "gap-5",
  },
};

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

function ClerkSignInPage() {
  return (
    <div className="min-h-screen bg-[#090909] flex items-center justify-center px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function ClerkSignUpPage() {
  return (
    <div className="min-h-screen bg-[#090909] flex items-center justify-center px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ProtectedDashcamViewer() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090909] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#e82127]" />
      </div>
    );
  }
  return user ? <DashcamViewer /> : <Redirect to="/" />;
}

function Home() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090909] flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#e82127]" />
      </div>
    );
  }
  return user ? <Redirect to="/viewer" /> : <AuthPage />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/auth">
        <Redirect to="/" />
      </Route>
      <Route path="/sign-in/*?" component={ClerkSignInPage} />
      <Route path="/sign-up/*?" component={ClerkSignUpPage} />
      <Route path="/viewer" component={ProtectedDashcamViewer} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back",
            subtitle: "Sign in to access your dashcam viewer",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Set up secure viewer access",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <AppRoutes />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
