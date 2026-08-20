export interface GoogleMapsRuntime {
  google?: {
    maps?: unknown;
  };
  gm_authFailure?: () => void;
  __dashcamGoogleMapsInit?: () => void;
}

export interface GoogleMapsScript {
  src: string;
  async: boolean;
  defer: boolean;
  onerror: (() => void) | null;
  remove: () => void;
}

export interface GoogleMapsDocument {
  createElement: (tagName: string) => GoogleMapsScript;
  head: {
    appendChild: (script: GoogleMapsScript) => void;
  };
}

interface GoogleMapsLoaderOptions {
  timeoutMs?: number;
  setTimeoutFn?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeoutFn?: (timer: unknown) => void;
}

export interface GoogleMapsLoader {
  load: (apiKey: string) => Promise<void>;
  subscribeToAuthFailure: (listener: (message: string) => void) => () => void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const AUTH_FAILURE_MESSAGE = "Google Maps rejected the configured API key";

export function createGoogleMapsLoader(
  runtime: GoogleMapsRuntime,
  document: GoogleMapsDocument,
  options: GoogleMapsLoaderOptions = {},
): GoogleMapsLoader {
  const setTimer: (handler: () => void, timeoutMs: number) => unknown =
    options.setTimeoutFn ?? ((handler, timeoutMs) => setTimeout(handler, timeoutMs));
  const clearTimer: (timer: unknown) => void =
    options.clearTimeoutFn ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let googleMapsLoadPromise: Promise<void> | null = null;
  const authFailureListeners = new Set<(message: string) => void>();
  let previousAuthFailure: (() => void) | undefined;
  let isAuthFailureHandlerInstalled = false;

  function subscribeToAuthFailure(listener: (message: string) => void) {
    if (!isAuthFailureHandlerInstalled) {
      previousAuthFailure = runtime.gm_authFailure;
      runtime.gm_authFailure = () => {
        previousAuthFailure?.();
        authFailureListeners.forEach((notify) => notify(AUTH_FAILURE_MESSAGE));
      };
      isAuthFailureHandlerInstalled = true;
    }

    authFailureListeners.add(listener);

    return () => {
      authFailureListeners.delete(listener);
      if (authFailureListeners.size > 0 || !isAuthFailureHandlerInstalled) return;

      if (previousAuthFailure) {
        runtime.gm_authFailure = previousAuthFailure;
      } else {
        delete runtime.gm_authFailure;
      }
      previousAuthFailure = undefined;
      isAuthFailureHandlerInstalled = false;
    };
  }

  function load(apiKey: string): Promise<void> {
    if (runtime.google?.maps) return Promise.resolve();
    if (googleMapsLoadPromise) return googleMapsLoadPromise;

    const loader = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      let timer: unknown;
      let unsubscribeFromAuthFailure: () => void = () => {};

      const init = () => {
        if (settled) return;
        if (!runtime.google?.maps) {
          fail("Google Maps did not initialize");
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const cleanup = () => {
        if (timer !== undefined) {
          clearTimer(timer);
        }
        unsubscribeFromAuthFailure();
        if (runtime.__dashcamGoogleMapsInit === init) {
          delete runtime.__dashcamGoogleMapsInit;
        }
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        script.remove();
        reject(new Error(message));
      };

      timer = setTimer(
        () => fail("Google Maps took too long to load"),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      unsubscribeFromAuthFailure = subscribeToAuthFailure((message) => fail(message));

      runtime.__dashcamGoogleMapsInit = init;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__dashcamGoogleMapsInit`;
      script.async = true;
      script.defer = true;
      script.onerror = () => fail("Google Maps script failed to load");
      document.head.appendChild(script);
    }).catch((error) => {
      googleMapsLoadPromise = null;
      throw error;
    });

    googleMapsLoadPromise = loader;
    return loader;
  }

  return { load, subscribeToAuthFailure };
}

let browserLoader: GoogleMapsLoader | null = null;

function getBrowserLoader(): GoogleMapsLoader {
  if (!browserLoader) {
    browserLoader = createGoogleMapsLoader(
      window as unknown as GoogleMapsRuntime,
      document as unknown as GoogleMapsDocument,
    );
  }
  return browserLoader;
}

export function loadGoogleMapsApi(apiKey: string): Promise<void> {
  return getBrowserLoader().load(apiKey);
}

export function subscribeToGoogleMapsAuthFailure(
  listener: (message: string) => void,
): () => void {
  return getBrowserLoader().subscribeToAuthFailure(listener);
}