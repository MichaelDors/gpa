import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

/**
 * Generates a random hexadecimal salt or token
 */
function randomHex(length = 32) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Securely hashes a password with salt using SHA-256
 */
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const data = enc.encode(password + '::gpa_salt::' + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper to get a valid user from session token
 */
export async function getUserFromSession(ctx, sessionToken) {
  if (!sessionToken) return null;
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_token", q => q.eq("token", sessionToken))
    .first();

  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  const user = await ctx.db.get(session.userId);
  return user;
}

/**
 * Register a new user with username and password
 */
export const register = mutation({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const cleanUsername = args.username.trim().toLowerCase();
    if (cleanUsername.length < 2) {
      throw new Error("Username must be at least 2 characters.");
    }
    if (args.password.length < 4) {
      throw new Error("Password must be at least 4 characters.");
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_username", q => q.eq("username", cleanUsername))
      .first();

    if (existingUser) {
      throw new Error("Username already taken. Please choose another or log in.");
    }

    const salt = randomHex(16);
    const passwordHash = await hashPassword(args.password, salt);
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      username: cleanUsername,
      passwordHash,
      salt,
      createdAt: now,
      lastLoginAt: now,
    });

    const token = randomHex(32);
    const expiresAt = now + 1000 * 60 * 60 * 24 * 90; // 90 days

    await ctx.db.insert("sessions", {
      userId,
      token,
      expiresAt,
      createdAt: now,
    });

    return {
      token,
      username: cleanUsername,
      userId,
    };
  },
});

/**
 * Log in an existing user with username and password
 */
export const login = mutation({
  args: {
    username: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const cleanUsername = args.username.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", q => q.eq("username", cleanUsername))
      .first();

    if (!user) {
      throw new Error("Invalid username or password.");
    }

    const computedHash = await hashPassword(args.password, user.salt);
    if (computedHash !== user.passwordHash) {
      throw new Error("Invalid username or password.");
    }

    const now = Date.now();
    await ctx.db.patch(user._id, { lastLoginAt: now });

    const token = randomHex(32);
    const expiresAt = now + 1000 * 60 * 60 * 24 * 90; // 90 days

    await ctx.db.insert("sessions", {
      userId: user._id,
      token,
      expiresAt,
      createdAt: now,
    });

    return {
      token,
      username: user.username,
      userId: user._id,
    };
  },
});

/**
 * Log out and invalidate current session
 */
export const logout = mutation({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", q => q.eq("token", args.sessionToken))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }
    return { success: true };
  },
});

/**
 * Get the current authenticated user info
 */
export const getCurrentUser = query({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromSession(ctx, args.sessionToken);
    if (!user) return null;

    return {
      username: user.username,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  },
});
