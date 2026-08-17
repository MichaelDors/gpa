import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";
import { getUserFromSession } from "./auth.js";

const courseValidator = v.object({
  id: v.string(),
  name: v.string(),
  scale: v.string(),
  credits: v.number(),
  grade: v.string(),
  year: v.string(),
});

const metricsValidator = v.optional(
  v.object({
    weightedGpa: v.number(),
    unweightedGpa: v.number(),
    totalCredits: v.number(),
    validCoursesCount: v.number(),
    totalCoursesCount: v.optional(v.number()),
  })
);

/**
 * List all snapshot files for the current authenticated user
 */
export const listSnapshots = query({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromSession(ctx, args.sessionToken);
    if (!user) return [];

    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .collect();

    // Attach version count to each snapshot
    const results = await Promise.all(
      snapshots.map(async s => {
        const versions = await ctx.db
          .query("snapshotVersions")
          .withIndex("by_user_snapshot", q =>
            q.eq("userId", user._id).eq("clientSnapshotId", s.clientSnapshotId)
          )
          .collect();

        return {
          id: s.clientSnapshotId,
          name: s.name,
          courses: s.courses,
          metrics: s.metrics,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          versionCount: versions.length,
        };
      })
    );

    return results;
  },
});

/**
 * Save / Update a snapshot document and optionally record a version history entry
 */
export const saveSnapshot = mutation({
  args: {
    sessionToken: v.string(),
    clientSnapshotId: v.string(),
    name: v.string(),
    courses: v.array(courseValidator),
    metrics: metricsValidator,
    createVersion: v.optional(v.boolean()),
    versionNote: v.optional(v.string()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromSession(ctx, args.sessionToken);
    if (!user) throw new Error("Unauthorized.");

    const now = args.updatedAt || Date.now();
    const existing = await ctx.db
      .query("snapshots")
      .withIndex("by_user_and_client_id", q =>
        q.eq("userId", user._id).eq("clientSnapshotId", args.clientSnapshotId)
      )
      .first();

    let snapshotDocId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        courses: args.courses,
        metrics: args.metrics,
        updatedAt: now,
      });
      snapshotDocId = existing._id;
    } else {
      snapshotDocId = await ctx.db.insert("snapshots", {
        userId: user._id,
        clientSnapshotId: args.clientSnapshotId,
        name: args.name,
        courses: args.courses,
        metrics: args.metrics,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Check if we should create a version history entry
    if (args.createVersion) {
      const existingVersions = await ctx.db
        .query("snapshotVersions")
        .withIndex("by_user_snapshot", q =>
          q.eq("userId", user._id).eq("clientSnapshotId", args.clientSnapshotId)
        )
        .collect();

      const nextVersionNumber = existingVersions.length + 1;

      await ctx.db.insert("snapshotVersions", {
        userId: user._id,
        clientSnapshotId: args.clientSnapshotId,
        versionNumber: nextVersionNumber,
        name: args.name,
        note: args.versionNote || `Saved revision v${nextVersionNumber}`,
        courses: args.courses,
        metrics: args.metrics,
        createdAt: now,
      });
    }

    return { success: true, updatedAt: now };
  },
});

/**
 * Get all versions for a snapshot file
 */
export const getVersionHistory = query({
  args: {
    sessionToken: v.string(),
    clientSnapshotId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromSession(ctx, args.sessionToken);
    if (!user) return [];

    const versions = await ctx.db
      .query("snapshotVersions")
      .withIndex("by_user_snapshot", q =>
        q.eq("userId", user._id).eq("clientSnapshotId", args.clientSnapshotId)
      )
      .collect();

    // Sort descending by version number / creation time
    return versions
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(v => ({
        id: v._id,
        versionNumber: v.versionNumber,
        name: v.name,
        note: v.note,
        courses: v.courses,
        metrics: v.metrics,
        createdAt: v.createdAt,
      }));
  },
});

/**
 * Delete a snapshot document and all its versions
 */
export const deleteSnapshot = mutation({
  args: {
    sessionToken: v.string(),
    clientSnapshotId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromSession(ctx, args.sessionToken);
    if (!user) throw new Error("Unauthorized.");

    const existing = await ctx.db
      .query("snapshots")
      .withIndex("by_user_and_client_id", q =>
        q.eq("userId", user._id).eq("clientSnapshotId", args.clientSnapshotId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    const versions = await ctx.db
      .query("snapshotVersions")
      .withIndex("by_user_snapshot", q =>
        q.eq("userId", user._id).eq("clientSnapshotId", args.clientSnapshotId)
      )
      .collect();

    for (const v of versions) {
      await ctx.db.delete(v._id);
    }

    return { success: true };
  },
});

/**
 * Smart bidirectional merge of local and cloud snapshots & version histories.
 * Guarantees zero data loss: preserves older conflicting states into version history.
 */
export const smartSync = mutation({
  args: {
    sessionToken: v.string(),
    localSnapshots: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        courses: v.array(courseValidator),
        metrics: metricsValidator,
        createdAt: v.number(),
        updatedAt: v.number(),
      })
    ),
    localVersions: v.optional(
      v.array(
        v.object({
          clientSnapshotId: v.string(),
          versionNumber: v.number(),
          name: v.string(),
          note: v.optional(v.string()),
          courses: v.array(courseValidator),
          metrics: metricsValidator,
          createdAt: v.number(),
        })
      )
    ),
    activeSnapshotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUserFromSession(ctx, args.sessionToken);
    if (!user) throw new Error("Unauthorized.");

    const now = Date.now();

    // 1. Fetch all cloud snapshots and versions for this user
    const cloudSnapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .collect();

    const cloudVersions = await ctx.db
      .query("snapshotVersions")
      .withIndex("by_user_snapshot", q => q.eq("userId", user._id))
      .collect();

    const cloudSnapshotsMap = new Map(cloudSnapshots.map(s => [s.clientSnapshotId, s]));
    const localSnapshotsMap = new Map(args.localSnapshots.map(s => [s.id, s]));

    // 2. Process local snapshots
    for (const localSnap of args.localSnapshots) {
      const cloudSnap = cloudSnapshotsMap.get(localSnap.id);

      if (!cloudSnap) {
        // Local snapshot does not exist in cloud -> insert to cloud
        await ctx.db.insert("snapshots", {
          userId: user._id,
          clientSnapshotId: localSnap.id,
          name: localSnap.name,
          courses: localSnap.courses,
          metrics: localSnap.metrics,
          createdAt: localSnap.createdAt || now,
          updatedAt: localSnap.updatedAt || now,
        });

        // Insert its initial version if none exists
        await ctx.db.insert("snapshotVersions", {
          userId: user._id,
          clientSnapshotId: localSnap.id,
          versionNumber: 1,
          name: localSnap.name,
          note: "Initial sync from local device",
          courses: localSnap.courses,
          metrics: localSnap.metrics,
          createdAt: localSnap.createdAt || now,
        });
      } else {
        // Snapshot exists in both: compare which is more recent
        const localUpdated = localSnap.updatedAt || 0;
        const cloudUpdated = cloudSnap.updatedAt || 0;

        const coursesMatch = JSON.stringify(localSnap.courses) === JSON.stringify(cloudSnap.courses);

        if (!coursesMatch) {
          if (localUpdated > cloudUpdated) {
            // Local is newer: update cloud to local content, but preserve cloud's old state in version history
            const snapVersions = cloudVersions.filter(v => v.clientSnapshotId === localSnap.id);
            const nextVNum = snapVersions.length + 1;

            // Preserve old cloud state as a version
            await ctx.db.insert("snapshotVersions", {
              userId: user._id,
              clientSnapshotId: localSnap.id,
              versionNumber: nextVNum,
              name: cloudSnap.name,
              note: `Cloud revision before local sync (${new Date(cloudUpdated).toLocaleTimeString()})`,
              courses: cloudSnap.courses,
              metrics: cloudSnap.metrics,
              createdAt: cloudUpdated,
            });

            // Update cloud snapshot with local's newer data
            await ctx.db.patch(cloudSnap._id, {
              name: localSnap.name,
              courses: localSnap.courses,
              metrics: localSnap.metrics,
              updatedAt: localUpdated,
            });
          } else {
            // Cloud is newer: keep cloud snapshot, but preserve local's different state in version history
            const snapVersions = cloudVersions.filter(v => v.clientSnapshotId === localSnap.id);
            const nextVNum = snapVersions.length + 1;

            await ctx.db.insert("snapshotVersions", {
              userId: user._id,
              clientSnapshotId: localSnap.id,
              versionNumber: nextVNum,
              name: localSnap.name,
              note: `Local revision from device (${new Date(localUpdated).toLocaleTimeString()})`,
              courses: localSnap.courses,
              metrics: localSnap.metrics,
              createdAt: localUpdated,
            });
          }
        }
      }
    }

    // 3. Process any local version history records that are missing in cloud
    if (args.localVersions && args.localVersions.length > 0) {
      for (const lv of args.localVersions) {
        const alreadyExists = cloudVersions.some(
          cv => cv.clientSnapshotId === lv.clientSnapshotId && cv.createdAt === lv.createdAt
        );
        if (!alreadyExists) {
          const snapVersions = await ctx.db
            .query("snapshotVersions")
            .withIndex("by_user_snapshot", q =>
              q.eq("userId", user._id).eq("clientSnapshotId", lv.clientSnapshotId)
            )
            .collect();

          await ctx.db.insert("snapshotVersions", {
            userId: user._id,
            clientSnapshotId: lv.clientSnapshotId,
            versionNumber: lv.versionNumber || snapVersions.length + 1,
            name: lv.name,
            note: lv.note || "Local saved version",
            courses: lv.courses,
            metrics: lv.metrics,
            createdAt: lv.createdAt || now,
          });
        }
      }
    }

    // 4. Update user active snapshot preference if provided
    let finalActiveSnapshotId = args.activeSnapshotId;
    const pref = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .first();

    if (pref && !args.activeSnapshotId) {
      finalActiveSnapshotId = pref.activeSnapshotId;
    } else if (args.activeSnapshotId) {
      if (pref) {
        await ctx.db.patch(pref._id, {
          activeSnapshotId: args.activeSnapshotId,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("userPreferences", {
          userId: user._id,
          activeSnapshotId: args.activeSnapshotId,
          updatedAt: now,
        });
      }
    }

    // 5. Gather and return the final unified snapshot list and all versions
    const finalCloudSnapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .collect();

    const finalCloudVersions = await ctx.db
      .query("snapshotVersions")
      .withIndex("by_user_snapshot", q => q.eq("userId", user._id))
      .collect();

    const versionsBySnapshot = {};
    for (const v of finalCloudVersions) {
      if (!versionsBySnapshot[v.clientSnapshotId]) {
        versionsBySnapshot[v.clientSnapshotId] = [];
      }
      versionsBySnapshot[v.clientSnapshotId].push({
        id: v._id,
        versionNumber: v.versionNumber,
        name: v.name,
        note: v.note,
        courses: v.courses,
        metrics: v.metrics,
        createdAt: v.createdAt,
      });
    }

    // Sort versions descending
    for (const sid of Object.keys(versionsBySnapshot)) {
      versionsBySnapshot[sid].sort((a, b) => b.versionNumber - a.versionNumber);
    }

    const mergedSnapshots = finalCloudSnapshots.map(s => ({
      id: s.clientSnapshotId,
      name: s.name,
      courses: s.courses,
      metrics: s.metrics,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      versionCount: (versionsBySnapshot[s.clientSnapshotId] || []).length,
    }));

    return {
      snapshots: mergedSnapshots,
      versions: versionsBySnapshot,
      activeSnapshotId: finalActiveSnapshotId || (mergedSnapshots[0] ? mergedSnapshots[0].id : null),
      lastSyncAt: now,
    };
  },
});
