export type SplitDirection = "horizontal" | "vertical";

export type DropPosition = "top" | "right" | "bottom" | "left" | "center";

export type SplitLayoutNode =
  | { type: "leaf"; tabId: number }
  | {
      type: "split";
      direction: SplitDirection;
      children: SplitLayoutNode[];
    };

export function isLeaf(
  node: SplitLayoutNode,
): node is { type: "leaf"; tabId: number } {
  return node.type === "leaf";
}

export function getLeafIds(node: SplitLayoutNode | null): number[] {
  if (!node) return [];
  if (node.type === "leaf") return [node.tabId];
  return node.children.flatMap(getLeafIds);
}

export function findLeaf(
  node: SplitLayoutNode,
  tabId: number,
): boolean {
  if (node.type === "leaf") return node.tabId === tabId;
  return node.children.some((c) => findLeaf(c, tabId));
}

/**
 * Build a sensible default layout tree from a flat list of tab IDs.
 * Used when applying a "split N tabs" preset.
 */
export function defaultLayoutFromIds(ids: number[]): SplitLayoutNode | null {
  if (ids.length === 0) return null;
  if (ids.length === 1) return { type: "leaf", tabId: ids[0] };

  const leaf = (id: number): SplitLayoutNode => ({ type: "leaf", tabId: id });
  const hRow = (rowIds: number[]): SplitLayoutNode => ({
    type: "split",
    direction: "horizontal",
    children: rowIds.map(leaf),
  });

  // Distribute IDs across rows in a balanced grid
  const n = ids.length;
  let rows: number[][];
  if (n === 2) rows = [[ids[0], ids[1]]];
  else if (n === 3) rows = [[ids[0], ids[1]], [ids[2]]];
  else if (n === 4) rows = [[ids[0], ids[1]], [ids[2], ids[3]]];
  else if (n === 5) rows = [[ids[0], ids[1]], [ids[2], ids[3], ids[4]]];
  else if (n === 6)
    rows = [
      [ids[0], ids[1], ids[2]],
      [ids[3], ids[4], ids[5]],
    ];
  else if (n === 7)
    rows = [
      [ids[0], ids[1], ids[2]],
      [ids[3], ids[4], ids[5]],
      [ids[6]],
    ];
  else if (n === 8)
    rows = [
      [ids[0], ids[1], ids[2]],
      [ids[3], ids[4], ids[5]],
      [ids[6], ids[7]],
    ];
  else if (n === 9)
    rows = [
      [ids[0], ids[1], ids[2]],
      [ids[3], ids[4], ids[5]],
      [ids[6], ids[7], ids[8]],
    ];
  else if (n === 10)
    rows = [
      [ids[0], ids[1], ids[2], ids[3]],
      [ids[4], ids[5], ids[6]],
      [ids[7], ids[8], ids[9]],
    ];
  else if (n === 11)
    rows = [
      [ids[0], ids[1], ids[2], ids[3]],
      [ids[4], ids[5], ids[6], ids[7]],
      [ids[8], ids[9], ids[10]],
    ];
  else
    rows = [
      [ids[0], ids[1], ids[2], ids[3]],
      [ids[4], ids[5], ids[6], ids[7]],
      [ids[8], ids[9], ids[10], ids[11]],
    ];

  if (rows.length === 1) return hRow(rows[0]);

  return {
    type: "split",
    direction: "vertical",
    children: rows.map((r) => (r.length === 1 ? leaf(r[0]) : hRow(r))),
  };
}

/**
 * Insert `newTabId` adjacent to `targetTabId` in the given direction/position.
 * If the target's parent already runs in the new split direction, insert as a
 * sibling (flattened) instead of nesting a new split.
 */
export function splitLeaf(
  tree: SplitLayoutNode,
  targetTabId: number,
  newTabId: number,
  position: DropPosition,
): SplitLayoutNode {
  if (position === "center") {
    // Center drop = swap (or no-op if dropping onto self)
    return swapLeaves(tree, targetTabId, newTabId);
  }

  const newDir: SplitDirection =
    position === "top" || position === "bottom" ? "vertical" : "horizontal";
  const insertBefore = position === "top" || position === "left";
  const newLeaf: SplitLayoutNode = { type: "leaf", tabId: newTabId };

  // Special case: tree root is a leaf and is the target
  if (tree.type === "leaf") {
    if (tree.tabId !== targetTabId) return tree;
    return {
      type: "split",
      direction: newDir,
      children: insertBefore ? [newLeaf, tree] : [tree, newLeaf],
    };
  }

  function walk(node: SplitLayoutNode): SplitLayoutNode {
    if (node.type === "leaf") {
      if (node.tabId !== targetTabId) return node;
      return {
        type: "split",
        direction: newDir,
        children: insertBefore ? [newLeaf, node] : [node, newLeaf],
      };
    }

    // Split node — check whether to flatten the insert as a sibling
    const matchingChildIdx = node.children.findIndex(
      (c) => c.type === "leaf" && c.tabId === targetTabId,
    );

    if (matchingChildIdx !== -1 && node.direction === newDir) {
      // Flatten: insert newLeaf as a sibling of the matching child
      const newChildren = [...node.children];
      const insertIdx = insertBefore
        ? matchingChildIdx
        : matchingChildIdx + 1;
      newChildren.splice(insertIdx, 0, newLeaf);
      return { ...node, children: newChildren };
    }

    return {
      ...node,
      children: node.children.map(walk),
    };
  }

  return walk(tree);
}

/**
 * Swap the positions of two leaves within the tree.
 */
export function swapLeaves(
  tree: SplitLayoutNode,
  aTabId: number,
  bTabId: number,
): SplitLayoutNode {
  if (aTabId === bTabId) return tree;
  function walk(node: SplitLayoutNode): SplitLayoutNode {
    if (node.type === "leaf") {
      if (node.tabId === aTabId) return { type: "leaf", tabId: bTabId };
      if (node.tabId === bTabId) return { type: "leaf", tabId: aTabId };
      return node;
    }
    return { ...node, children: node.children.map(walk) };
  }
  return walk(tree);
}

/**
 * Remove a leaf from the tree. Collapses single-child split nodes and merges
 * nested splits with the same direction.
 */
export function removeLeaf(
  tree: SplitLayoutNode,
  tabId: number,
): SplitLayoutNode | null {
  if (tree.type === "leaf") {
    return tree.tabId === tabId ? null : tree;
  }

  const newChildren: SplitLayoutNode[] = [];
  for (const child of tree.children) {
    const removed = removeLeaf(child, tabId);
    if (removed !== null) newChildren.push(removed);
  }

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0]; // collapse

  // Flatten nested same-direction splits into the parent
  const flattened: SplitLayoutNode[] = [];
  for (const child of newChildren) {
    if (child.type === "split" && child.direction === tree.direction) {
      flattened.push(...child.children);
    } else {
      flattened.push(child);
    }
  }

  return { ...tree, children: flattened };
}

/**
 * Insert a new leaf at the outermost level of the tree, in the given direction.
 * - Drops on top/bottom create a new row at the root.
 * - Drops on left/right create a new outermost column.
 *
 * If the existing root already runs in the requested direction, the new leaf
 * is appended/prepended as a sibling. Otherwise the existing tree is wrapped
 * in a new split of the requested direction.
 */
export function insertAtRoot(
  tree: SplitLayoutNode | null,
  newTabId: number,
  position: "top" | "right" | "bottom" | "left",
): SplitLayoutNode {
  const newLeaf: SplitLayoutNode = { type: "leaf", tabId: newTabId };
  if (!tree) return newLeaf;

  const wantDir: SplitDirection =
    position === "top" || position === "bottom" ? "vertical" : "horizontal";
  const insertBefore = position === "top" || position === "left";

  if (tree.type === "split" && tree.direction === wantDir) {
    return {
      ...tree,
      children: insertBefore
        ? [newLeaf, ...tree.children]
        : [...tree.children, newLeaf],
    };
  }

  return {
    type: "split",
    direction: wantDir,
    children: insertBefore ? [newLeaf, tree] : [tree, newLeaf],
  };
}

/**
 * Filter the tree so that only leaves whose IDs appear in `validIds` remain.
 * Removed leaves are dropped and the tree is collapsed accordingly.
 */
export function pruneLayout(
  tree: SplitLayoutNode | null,
  validIds: Set<number>,
): SplitLayoutNode | null {
  if (!tree) return null;
  if (tree.type === "leaf") {
    return validIds.has(tree.tabId) ? tree : null;
  }
  const newChildren: SplitLayoutNode[] = [];
  for (const child of tree.children) {
    const pruned = pruneLayout(child, validIds);
    if (pruned !== null) newChildren.push(pruned);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  const flattened: SplitLayoutNode[] = [];
  for (const child of newChildren) {
    if (child.type === "split" && child.direction === tree.direction) {
      flattened.push(...child.children);
    } else {
      flattened.push(child);
    }
  }
  return { ...tree, children: flattened };
}
