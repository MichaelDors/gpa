import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    username: v.string(),
    passwordHash: v.string(),
    salt: v.string(),
    createdAt: v.number(),
    lastLoginAt: v.optional(v.number()),
  }).index("by_username", ["username"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  snapshots: defineTable({
    userId: v.id("users"),
    clientSnapshotId: v.string(),
    name: v.string(),
    courses: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        scale: v.string(),
        credits: v.number(),
        grade: v.string(),
        year: v.string(),
      })
    ),
    metrics: v.optional(
      v.object({
        weightedGpa: v.number(),
        unweightedGpa: v.number(),
        totalCredits: v.number(),
        validCoursesCount: v.number(),
        totalCoursesCount: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_client_id", ["userId", "clientSnapshotId"]),

  snapshotVersions: defineTable({
    userId: v.id("users"),
    clientSnapshotId: v.string(),
    versionNumber: v.number(),
    name: v.string(),
    note: v.optional(v.string()),
    courses: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        scale: v.string(),
        credits: v.number(),
        grade: v.string(),
        year: v.string(),
      })
    ),
    metrics: v.optional(
      v.object({
        weightedGpa: v.number(),
        unweightedGpa: v.number(),
        totalCredits: v.number(),
        validCoursesCount: v.number(),
        totalCoursesCount: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
  })
    .index("by_snapshot", ["clientSnapshotId"])
    .index("by_user_snapshot", ["userId", "clientSnapshotId"]),

  userPreferences: defineTable({
    userId: v.id("users"),
    activeSnapshotId: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
});
