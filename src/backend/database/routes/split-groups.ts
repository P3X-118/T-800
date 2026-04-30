import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { savedSplitGroups } from "../db/schema.js";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

// Server stores `layout` and `tabs` as JSON-encoded TEXT. The client
// works with parsed objects, so the API parses on read and stringifies
// on write. Keeping the row schema string-typed keeps the table flat
// regardless of how the SplitLayoutNode shape evolves.
type StoredRow = {
  id: string;
  userId: string;
  name: string;
  layout: string;
  tabs: string;
  createdAt: number;
  updatedAt: number;
};

function rowToApi(row: StoredRow) {
  return {
    id: row.id,
    name: row.name,
    layout: JSON.parse(row.layout),
    tabs: JSON.parse(row.tabs),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }
    try {
      const rows = await db
        .select()
        .from(savedSplitGroups)
        .where(eq(savedSplitGroups.userId, userId))
        .orderBy(desc(savedSplitGroups.updatedAt));
      res.json(rows.map((r) => rowToApi(r as StoredRow)));
    } catch (err) {
      authLogger.error("Failed to fetch saved split groups", err);
      res.status(500).json({ error: "Failed to fetch saved split groups" });
    }
  },
);

router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id, name, layout, tabs, createdAt, updatedAt } = req.body ?? {};

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(id) ||
      !isNonEmptyString(name) ||
      layout == null ||
      !Array.isArray(tabs)
    ) {
      return res
        .status(400)
        .json({ error: "id, name, layout, tabs are required" });
    }

    try {
      const now = Date.now();
      const insertData = {
        id,
        userId,
        name: name.trim(),
        layout: JSON.stringify(layout),
        tabs: JSON.stringify(tabs),
        createdAt: typeof createdAt === "number" ? createdAt : now,
        updatedAt: typeof updatedAt === "number" ? updatedAt : now,
      };
      await db.insert(savedSplitGroups).values(insertData);
      res.status(201).json(rowToApi(insertData));
    } catch (err) {
      authLogger.error("Failed to create saved split group", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to create saved split group",
      });
    }
  },
);

router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { name, layout, tabs } = req.body ?? {};

    if (!isNonEmptyString(userId) || !isNonEmptyString(id)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(savedSplitGroups)
        .where(
          and(eq(savedSplitGroups.id, id), eq(savedSplitGroups.userId, userId)),
        );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Not found" });
      }

      const updateFields: Partial<{
        name: string;
        layout: string;
        tabs: string;
        updatedAt: number;
      }> = { updatedAt: Date.now() };

      if (name !== undefined) {
        if (!isNonEmptyString(name)) {
          return res.status(400).json({ error: "Invalid name" });
        }
        updateFields.name = name.trim();
      }
      if (layout !== undefined) updateFields.layout = JSON.stringify(layout);
      if (tabs !== undefined) {
        if (!Array.isArray(tabs)) {
          return res.status(400).json({ error: "Invalid tabs" });
        }
        updateFields.tabs = JSON.stringify(tabs);
      }

      await db
        .update(savedSplitGroups)
        .set(updateFields)
        .where(
          and(eq(savedSplitGroups.id, id), eq(savedSplitGroups.userId, userId)),
        );

      const updated = await db
        .select()
        .from(savedSplitGroups)
        .where(
          and(eq(savedSplitGroups.id, id), eq(savedSplitGroups.userId, userId)),
        );
      res.json(rowToApi(updated[0] as StoredRow));
    } catch (err) {
      authLogger.error("Failed to update saved split group", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to update saved split group",
      });
    }
  },
);

router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isNonEmptyString(userId) || !isNonEmptyString(id)) {
      return res.status(400).json({ error: "Invalid request" });
    }
    try {
      await db
        .delete(savedSplitGroups)
        .where(
          and(eq(savedSplitGroups.id, id), eq(savedSplitGroups.userId, userId)),
        );
      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete saved split group", err);
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : "Failed to delete saved split group",
      });
    }
  },
);

export default router;
