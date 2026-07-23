import type { DatabaseReader, DatabaseWriter } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type StageName = "phonology" | "lexicon" | "morphology" | "syntax" | "orthography";

/**
 * Every array-shaped field a stage diffs (e.g. phonology's consonants/vowels)
 * is a top-level property holding items with a stable `id`. Atomic fields
 * (phonotactics, stress, ...) are diffed whole. Both op kinds address their
 * field by its plain top-level key — no nested paths needed, since every
 * stage's data shape (so far) is one level deep.
 */
export type DiffOp =
  | { kind: "upsert"; field: string; id: string; value: unknown }
  | { kind: "removeById"; field: string; id: string }
  | { kind: "replace"; field: string; value: unknown };

interface KeyedItem {
  id: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Diff an id-keyed array field (e.g. `consonants`). Order doesn't carry meaning here — only membership and content do. */
export function diffKeyedArray<T extends KeyedItem>(
  prev: readonly T[],
  next: readonly T[],
  field: string,
): DiffOp[] {
  const ops: DiffOp[] = [];
  const prevById = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) {
    const before = prevById.get(item.id);
    if (!before || !deepEqual(before, item)) {
      ops.push({ kind: "upsert", field, id: item.id, value: item });
    }
  }
  const nextIds = new Set(next.map((item) => item.id));
  for (const item of prev) {
    if (!nextIds.has(item.id)) {
      ops.push({ kind: "removeById", field, id: item.id });
    }
  }
  return ops;
}

/** Diff a whole-field value (e.g. `phonotactics`, `stress`). Emits one op iff it changed. */
export function diffAtomic(prev: unknown, next: unknown, field: string): DiffOp[] {
  return deepEqual(prev, next) ? [] : [{ kind: "replace", field, value: next }];
}

/** Apply ops onto a deep copy of `base`. Base and result are plain JSON-safe objects. */
export function applyDiff<T extends object>(base: T, ops: DiffOp[]): T {
  const working: Record<string, unknown> = JSON.parse(JSON.stringify(base));
  for (const op of ops) {
    if (op.kind === "replace") {
      working[op.field] = op.value;
    } else if (op.kind === "upsert") {
      const arr = (working[op.field] as Array<{ id: string }> | undefined) ?? [];
      const idx = arr.findIndex((item) => item.id === op.id);
      if (idx >= 0) arr[idx] = op.value as { id: string };
      else arr.push(op.value as { id: string });
      working[op.field] = arr;
    } else if (op.kind === "removeById") {
      const arr = (working[op.field] as Array<{ id: string }> | undefined) ?? [];
      working[op.field] = arr.filter((item) => item.id !== op.id);
    }
  }
  return working as T;
}

const SNAPSHOT_CADENCE = 5;

/**
 * Append a new history entry for the current committed `data`. Writes a
 * full snapshot every 5th entry (or when `forceSnapshot` is set, e.g. the
 * stage just got locked — Section 10.3) and a lightweight diff otherwise.
 * Skips the write entirely if the diff against the previous entry is empty
 * (a nudge that happened to land on "keep everything").
 */
export async function appendHistory<T extends object>(
  ctx: { db: DatabaseWriter },
  args: {
    languageId: Id<"languages">;
    stage: StageName;
    data: T;
    trigger: "nudge" | "reroll" | "edit";
    diffFn: (prev: T, next: T) => DiffOp[];
    forceSnapshot?: boolean;
  },
): Promise<void> {
  const prevEntry = await ctx.db
    .query("stageHistory")
    .withIndex("by_language_stage", (q) => q.eq("languageId", args.languageId).eq("stage", args.stage))
    .order("desc")
    .first();

  const newSeq = (prevEntry?.seq ?? 0) + 1;
  const isSnapshotCadence = newSeq % SNAPSHOT_CADENCE === 1;

  if (!prevEntry || isSnapshotCadence || args.forceSnapshot) {
    await ctx.db.insert("stageHistory", {
      languageId: args.languageId,
      stage: args.stage,
      kind: "snapshot",
      data: args.data,
      trigger: args.trigger,
      seq: newSeq,
      createdAt: Date.now(),
    });
    return;
  }

  const prevData = await reconstructFromEntry<T>(ctx, prevEntry);
  const ops = args.diffFn(prevData, args.data);
  if (ops.length === 0) return;

  await ctx.db.insert("stageHistory", {
    languageId: args.languageId,
    stage: args.stage,
    kind: "diff",
    data: ops,
    trigger: args.trigger,
    seq: newSeq,
    createdAt: Date.now(),
  });
}

/**
 * Reconstruct the full stage data as of a given history entry: find the
 * nearest prior snapshot (indexed `seq <=` range scan, bounded to a small
 * page) and replay diffs forward. Cost is bounded to at most
 * `SNAPSHOT_CADENCE - 1` diff replays regardless of how long the language's
 * history grows.
 */
export async function reconstructAt<T extends object>(
  ctx: { db: DatabaseReader },
  args: { languageId: Id<"languages">; stage: StageName; historyEntryId: Id<"stageHistory"> },
): Promise<T> {
  const target = await ctx.db.get(args.historyEntryId);
  if (!target || target.languageId !== args.languageId || target.stage !== args.stage) {
    throw new Error("History entry not found");
  }
  return reconstructFromEntry<T>(ctx, target);
}

async function reconstructFromEntry<T extends object>(
  ctx: { db: DatabaseReader },
  entry: Doc<"stageHistory">,
): Promise<T> {
  if (entry.kind === "snapshot") return entry.data as T;

  const page = await ctx.db
    .query("stageHistory")
    .withIndex("by_language_stage", (q) =>
      q.eq("languageId", entry.languageId).eq("stage", entry.stage).lte("seq", entry.seq),
    )
    .order("desc")
    .take(SNAPSHOT_CADENCE + 1);

  const anchorIndex = page.findIndex((e) => e.kind === "snapshot");
  if (anchorIndex === -1) {
    throw new Error(
      `No snapshot found within ${SNAPSHOT_CADENCE + 1} entries of seq ${entry.seq} for ${entry.stage} — history corrupted or SNAPSHOT_CADENCE changed after the fact`,
    );
  }

  const anchor = page[anchorIndex];
  // page is seq-descending; entries strictly between the anchor and the
  // target (inclusive of target) need replaying oldest-first.
  const diffsAscending = page.slice(0, anchorIndex).reverse();

  let data = anchor.data as T;
  for (const diffEntry of diffsAscending) {
    data = applyDiff(data, diffEntry.data as DiffOp[]);
  }
  return data;
}
