import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { db, pool } from "../server/db";
import { users } from "../shared/schema";
import { like } from "drizzle-orm";

type JsonResponse = {
  status: number;
  headers: Headers;
  body: any;
};

const testPrefix = `at${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const port = 10_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
let serverProcess: ChildProcess;

function testUsername(suffix: string): string {
  return `${testPrefix}_${suffix}`;
}

function cookieFrom(response: JsonResponse): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "expected the response to establish a session cookie");
  return setCookie.split(";")[0];
}

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    ip?: string;
  } = {},
): Promise<JsonResponse> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.ip) headers.set("x-forwarded-for", options.ip);

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, headers: response.headers, body };
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/me`);
      if (response.status > 0) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(`Timed out waiting for the test server: ${String(lastError)}`);
}

before(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run authentication integration tests");
  }
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required to run authentication integration tests");
  }

  const tsxCli = resolve("node_modules/.bin/tsx");
  assert.ok(existsSync(tsxCli), "tsx must be installed to run the test server");

  serverProcess = spawn(process.execPath, [tsxCli, "server/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  serverProcess.stdout?.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  serverProcess.stderr?.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  serverProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      serverOutput += `\nserver exited with code ${code}`;
    } else if (signal) {
      serverOutput += `\nserver exited with signal ${signal}`;
    }
  });

  try {
    await waitForServer();
  } catch (error) {
    serverProcess.kill();
    throw new Error(`${String(error)}\n${serverOutput}`);
  }
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }

  await db.delete(users).where(like(users.username, `${testPrefix}%`));
  await pool.end();
});

describe("local authentication API", () => {
  it("rejects invalid sign-up input without returning a password", async () => {
    const response = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.10",
      body: { username: "no", password: "short" },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /at least 3 characters/i);
    assert.equal("password" in response.body, false);
  });

  it("creates users with normalized usernames and hashed passwords", async () => {
    const username = testUsername("new_user");
    const password = "correct horse battery staple";
    const response = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.11",
      body: { username: ` ${username.toUpperCase()} `, password },
    });

    assert.equal(response.status, 201);
    assert.deepEqual(response.body.user.username, username);
    assert.equal("password" in response.body.user, false);
    assert.equal("passwordHash" in response.body.user, false);

    const [storedUser] = await db
      .select({ username: users.username, passwordHash: users.passwordHash })
      .from(users)
      .where(like(users.username, `${username}%`));
    assert.equal(storedUser?.username, username);
    assert.notEqual(storedUser?.passwordHash, password);
    assert.match(storedUser?.passwordHash || "", /^scrypt\$\d+\$\d+\$\d+\$/);
  });

  it("rejects duplicate usernames without exposing credentials", async () => {
    const username = testUsername("duplicate");
    const body = { username, password: "duplicate password" };
    const first = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.12",
      body,
    });
    const duplicate = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.13",
      body: { ...body, username: username.toUpperCase() },
    });

    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.message, /already in use/i);
    assert.equal("password" in duplicate.body, false);
  });

  it("supports failed and successful sign-in with a persistent session", async () => {
    const username = testUsername("signin");
    const password = "a secure sign-in password";
    const signup = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.14",
      body: { username, password },
    });
    assert.equal(signup.status, 201);

    const failed = await request("/api/auth/signin", {
      method: "POST",
      ip: "198.51.100.15",
      body: { username, password: "wrong password" },
    });
    assert.equal(failed.status, 401);
    assert.match(failed.body.message, /invalid username or password/i);
    assert.equal("password" in failed.body, false);

    const signedIn = await request("/api/auth/signin", {
      method: "POST",
      ip: "198.51.100.15",
      body: { username, password },
    });
    assert.equal(signedIn.status, 200);
    assert.deepEqual(signedIn.body.user, { id: signup.body.user.id, username });
    assert.equal("password" in signedIn.body.user, false);
    const cookie = cookieFrom(signedIn);

    const currentUser = await request("/api/auth/me", { cookie });
    assert.equal(currentUser.status, 200);
    assert.deepEqual(currentUser.body.user, { id: signup.body.user.id, username });
    assert.equal("passwordHash" in currentUser.body.user, false);
  });

  it("protects Maps routes and clears the session on sign-out", async () => {
    const username = testUsername("protected");
    const signup = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.16",
      body: { username, password: "protected route password" },
    });
    const cookie = cookieFrom(signup);

    const unauthenticatedAvailability = await request("/api/map-available", {
      ip: "198.51.100.17",
    });
    const unauthenticatedProxy = await request(
      "/api/map-proxy?center=40.7,-74&zoom=10&path=enc:test&size=400x300",
      { ip: "198.51.100.17" },
    );
    assert.equal(unauthenticatedAvailability.status, 401);
    assert.equal(unauthenticatedProxy.status, 401);

    const authenticatedAvailability = await request("/api/map-available", { cookie });
    assert.equal(authenticatedAvailability.status, 200);
    assert.equal(typeof authenticatedAvailability.body.available, "boolean");

    const signedOut = await request("/api/auth/signout", {
      method: "POST",
      cookie,
    });
    assert.equal(signedOut.status, 204);

    const afterSignOut = await request("/api/auth/me", { cookie });
    assert.equal(afterSignOut.status, 401);
    const mapsAfterSignOut = await request("/api/map-available", { cookie });
    assert.equal(mapsAfterSignOut.status, 401);
  });

  it("rate-limits sign-up attempts and keeps the shared IP quota after success", async () => {
    const limitedIp = "198.51.100.18";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request("/api/auth/signup", {
        method: "POST",
        ip: limitedIp,
        body: { username: "x", password: "short" },
      });
      assert.equal(response.status, 400);
    }

    const blocked = await request("/api/auth/signup", {
      method: "POST",
      ip: limitedIp,
      body: { username: "x", password: "short" },
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));

    const retentionIp = "198.51.100.19";
    const invalidUsername = testUsername("invalid");
    const successful = await request("/api/auth/signup", {
      method: "POST",
      ip: retentionIp,
      body: { username: testUsername("rate_retention"), password: "rate limit password" },
    });
    assert.equal(successful.status, 201);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request("/api/auth/signup", {
        method: "POST",
        ip: retentionIp,
        body: { username: invalidUsername, password: "short" },
      });
      assert.equal(response.status, 400);
    }

    const blockedAfterSuccess = await request("/api/auth/signup", {
      method: "POST",
      ip: retentionIp,
      body: { username: invalidUsername, password: "short" },
    });
    assert.equal(blockedAfterSuccess.status, 429);
  });

  it("rate-limits sign-in attempts and keeps the shared IP quota after success", async () => {
    const username = testUsername("rate_signin");
    const password = "rate limit sign-in password";
    const signup = await request("/api/auth/signup", {
      method: "POST",
      ip: "198.51.100.20",
      body: { username, password },
    });
    assert.equal(signup.status, 201);

    const limitedIp = "198.51.100.21";
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await request("/api/auth/signin", {
        method: "POST",
        ip: limitedIp,
        body: { username, password: "wrong password" },
      });
      assert.equal(response.status, 401);
    }

    const successful = await request("/api/auth/signin", {
      method: "POST",
      ip: limitedIp,
      body: { username, password },
    });
    assert.equal(successful.status, 200);

    const blocked = await request("/api/auth/signin", {
      method: "POST",
      ip: limitedIp,
      body: { username, password },
    });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));
  });
});