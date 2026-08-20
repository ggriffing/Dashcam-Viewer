import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { hashPassword } from "./password";
import { users, type InsertUser, type StoredUser, type User } from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserCredentials(username: string): Promise<StoredUser | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.username, normalizeUsername(username)))
      .limit(1);
    return user;
  }

  async getUserCredentials(username: string): Promise<StoredUser | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, normalizeUsername(username)))
      .limit(1);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const username = normalizeUsername(insertUser.username);
    const passwordHash = await hashPassword(insertUser.password);
    const [user] = await db
      .insert(users)
      .values({ id: randomUUID(), username, passwordHash })
      .returning({ id: users.id, username: users.username });
    return user;
  }
}

export const storage = new DatabaseStorage();