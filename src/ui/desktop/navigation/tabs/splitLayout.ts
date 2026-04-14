export type SplitDirection = "horizontal" | "vertical";

export type DropPosition =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "center"
  | "max-top"
  | "max-right"
  | "max-bottom"
  | "max-left";

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
 * Insert a new full-width row or full-height column adjacent to the row/column
 * that contains `targetTabId`.
 *
 * - axis="row": find the row containing target (lowest ancestor whose parent
 *   is a vertical split, or the root) and insert a new row sibling before/after.
 * - axis="column": find the column containing target (lowest ancestor whose
 *   parent is horizontal) and insert a new column sibling before/after.
 *
 * If no matching ancestor exists, the existing tree is wrapped in a new
 * vertical/horizontal split with the new leaf adjacent to it.
 */
export function insertAdjacentRowOrColumn(
  tree: SplitLayoutNode,
  targetTabId: number,
  axis: "row" | "column",
  side: "before" | "after",
  newTabId: number,
): SplitLayoutNode {
  const wantParentDir: SplitDirection =
    axis === "row" ? "vertical" : "horizontal";

  function findPath(
    node: SplitLayoutNode,
    target: number,
    acc: number[],
  ): number[] | null {
    if (node.type === "leaf") {
      return node.tabId === target ? acc : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const sub = findPath(node.children[i], target, [...acc, i]);
      if (sub) return sub;
    }
    return null;
  }

  const path = findPath(tree, targetTabId, []);
  if (!path) return tree;

  // Walk root → leaf collecting nodes
  const chain: SplitLayoutNode[] = [tree];
  for (const idx of path) {
    const last = chain[chain.length - 1];
    if (last.type !== "split") break;
    chain.push(last.children[idx]);
  }
  // chain[0] = root, chain[chain.length-1] = leaf

  // Find lowest ancestor whose parent is wantParentDir, or root if none.
  let containerDepth = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (i === 0) {
      containerDepth = 0;
      break;
    }
    const parent = chain[i - 1];
    if (parent.type === "split" && parent.direction === wantParentDir) {
      containerDepth = i;
      break;
    }
  }

  const newLeaf: SplitLayoutNode = { type: "leaf", tabId: newTabId };
  const insertBefore = side === "before";

  if (containerDepth === 0) {
    // No matching parent — wrap the tree in a new outermost split
    return {
      type: "split",
      direction: wantParentDir,
      children: insertBefore ? [newLeaf, tree] : [tree, newLeaf],
    };
  }

  // chain[containerDepth] is the row/column container; chain[containerDepth-1]
  // is the parent split (running in wantParentDir). Insert as a sibling.
  const containerIdxInParent = path[containerDepth - 1];
  const insertIdx = insertBefore
    ? containerIdxInParent
    : containerIdxInParent + 1;

  function rebuild(
    node: SplitLayoutNode,
    depth: number,
  ): SplitLayoutNode {
    if (depth === containerDepth - 1) {
      if (node.type !== "split") return node;
      const newChildren = [...node.children];
      newChildren.splice(insertIdx, 0, newLeaf);
      return { ...node, children: newChildren };
    }
    if (node.type === "leaf") return node;
    const childIdx = path[depth];
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === childIdx ? rebuild(child, depth + 1) : child,
      ),
    };
  }

  return rebuild(tree, 0);
}

/**
 * Return the IDs of all leaves that share the same row as `tabId`.
 *
 * The "row" is the lowest ancestor whose parent is a vertical split (rows
 * container), or the root if no vertical ancestor exists. Returns an empty
 * array if `tabId` isn't in the tree.
 */
export function getRowLeafIds(
  tree: SplitLayoutNode,
  tabId: number,
): number[] {
  function findPath(
    node: SplitLayoutNode,
    target: number,
    acc: number[],
  ): number[] | null {
    if (node.type === "leaf") {
      return node.tabId === target ? acc : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const sub = findPath(node.children[i], target, [...acc, i]);
      if (sub) return sub;
    }
    return null;
  }

  const path = findPath(tree, tabId, []);
  if (!path) return [];

  const chain: SplitLayoutNode[] = [tree];
  for (const idx of path) {
    const last = chain[chain.length - 1];
    if (last.type !== "split") break;
    chain.push(last.children[idx]);
  }

  // Find the lowest ancestor whose parent is vertical, or the root if none.
  let rowDepth = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (i === 0) {
      rowDepth = 0;
      break;
    }
    const parent = chain[i - 1];
    if (parent.type === "split" && parent.direction === "vertical") {
      rowDepth = i;
      break;
    }
  }

  return getLeafIds(chain[rowDepth]);
}

/**
 * Maximize a leaf so it takes over its full visual column or row.
 *
 * The displaced tabs (the ones the maxed leaf is shoving aside) are not
 * dropped from the layout — they are appended as a new bottom row of the
 * tree so they remain reachable in the split view.
 *
 * Examples (axis = "column"):
 *
 *   3x3 grid:
 *     vertical[ horizontal[A,B,C], horizontal[D,E,F], horizontal[G,H,I] ]
 *     + max-column on B
 *     → vertical[
 *         horizontal[ vertical[A,D,G], B, vertical[C,F,I] ],
 *         horizontal[E, H]   ← E and H displaced as a new bottom row
 *       ]
 *
 *   horizontal[X, vertical[A, B], Z] + max-column on A
 *     → vertical[ horizontal[X, A, Z], B ]
 *
 * Examples (axis = "row"):
 *
 *   3x3 grid + max-row on B
 *     → vertical[
 *         B,                           ← B alone, full top row
 *         horizontal[D, E, F],
 *         horizontal[G, H, I],
 *         horizontal[A, C]             ← displaced row siblings
 *       ]
 */
export function maximizeAlongAxis(
  tree: SplitLayoutNode,
  tabId: number,
  axis: "column" | "row",
): SplitLayoutNode {
  function findPath(
    node: SplitLayoutNode,
    target: number,
    acc: number[],
  ): number[] | null {
    if (node.type === "leaf") {
      return node.tabId === target ? acc : null;
    }
    for (let i = 0; i < node.children.length; i++) {
      const sub = findPath(node.children[i], target, [...acc, i]);
      if (sub) return sub;
    }
    return null;
  }

  const path = findPath(tree, tabId, []);
  if (!path) return tree;

  // Walk root → leaf collecting nodes
  const chain: SplitLayoutNode[] = [tree];
  for (const idx of path) {
    const last = chain[chain.length - 1];
    if (last.type !== "split") break;
    chain.push(last.children[idx]);
  }
  // chain[0] = root, chain[chain.length - 1] = leaf

  const leafLeaf: SplitLayoutNode = { type: "leaf", tabId };

  // Helper: append `displaced` as a new bottom row of `outer`
  const appendBottomRow = (
    outer: SplitLayoutNode,
    displaced: SplitLayoutNode[],
  ): SplitLayoutNode => {
    if (displaced.length === 0) return outer;
    const row: SplitLayoutNode =
      displaced.length === 1
        ? displaced[0]
        : { type: "split", direction: "horizontal", children: displaced };
    if (outer.type === "split" && outer.direction === "vertical") {
      return { ...outer, children: [...outer.children, row] };
    }
    return {
      type: "split",
      direction: "vertical",
      children: [outer, row],
    };
  };

  // Helper: replace a node along the path at depth `targetDepth` with `replacement`
  const replaceAtDepth = (
    targetDepth: number,
    replacement: SplitLayoutNode,
  ): SplitLayoutNode => {
    function rebuild(
      node: SplitLayoutNode,
      depth: number,
    ): SplitLayoutNode {
      if (depth === targetDepth) return replacement;
      if (node.type === "leaf") return node;
      const childIdx = path[depth];
      return {
        ...node,
        children: node.children.map((child, i) =>
          i === childIdx ? rebuild(child, depth + 1) : child,
        ),
      };
    }
    return rebuild(tree, 0);
  };

  // ─── ROW MAXIMIZE ─────────────────────────────────────────────────────
  if (axis === "row") {
    // Find the lowest ancestor whose parent is vertical (or root if none).
    // That ancestor IS the row we want the leaf to take over.
    let rowDepth = 0;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (i === 0) {
        rowDepth = 0;
        break;
      }
      const parent = chain[i - 1];
      if (parent.type === "split" && parent.direction === "vertical") {
        rowDepth = i;
        break;
      }
    }

    const rowNode = chain[rowDepth];
    const allInRow = getLeafIds(rowNode);
    const displaced: SplitLayoutNode[] = allInRow
      .filter((id) => id !== tabId)
      .map((id) => ({ type: "leaf", tabId: id }));

    if (rowDepth === 0) {
      // Whole tree is the "row" — leaf replaces everything, displaced go below
      return appendBottomRow(leafLeaf, displaced);
    }

    const modified = replaceAtDepth(rowDepth, leafLeaf);
    return appendBottomRow(modified, displaced);
  }

  // ─── COLUMN MAXIMIZE ──────────────────────────────────────────────────
  // Case A: leaf's parent is a vertical split (leaf is already a column-cell)
  if (chain.length >= 2) {
    const parent = chain[chain.length - 2];
    if (parent.type === "split" && parent.direction === "vertical") {
      const colDepth = chain.length - 2;
      const allInCol = getLeafIds(parent);
      const displaced: SplitLayoutNode[] = allInCol
        .filter((id) => id !== tabId)
        .map((id) => ({ type: "leaf", tabId: id }));
      const modified = replaceAtDepth(colDepth, leafLeaf);
      return appendBottomRow(modified, displaced);
    }
  }

  // Case B: leaf's parent is a horizontal split (a row), and grandparent is
  // a vertical split (a row-major grid). Restructure that grid so the leaf
  // becomes a full-height column at its column position.
  if (chain.length >= 3) {
    const parent = chain[chain.length - 2];
    const grandparent = chain[chain.length - 3];
    if (
      parent.type === "split" &&
      parent.direction === "horizontal" &&
      grandparent.type === "split" &&
      grandparent.direction === "vertical"
    ) {
      const grandparentDepth = chain.length - 3;
      const colIndex = path[path.length - 1];
      const parentRowIdx = path[path.length - 2];

      const leftCellsByRow: SplitLayoutNode[][] = [];
      const rightCellsByRow: SplitLayoutNode[][] = [];
      const displaced: SplitLayoutNode[] = [];

      grandparent.children.forEach((row, i) => {
        if (row.type === "split" && row.direction === "horizontal") {
          const leftPart = row.children.slice(0, colIndex);
          const middleCell =
            colIndex < row.children.length ? row.children[colIndex] : undefined;
          const rightPart = row.children.slice(colIndex + 1);

          leftCellsByRow.push(leftPart);
          rightCellsByRow.push(rightPart);

          if (middleCell && i !== parentRowIdx) {
            // Other row's middle cell — displaced (leaf's own row's middle is the leaf itself)
            displaced.push(middleCell);
          }
        } else if (row.type === "leaf") {
          // Single-tab row spans the full width visually, so the column being
          // maximized passes right through it — displace this leaf.
          leftCellsByRow.push([]);
          rightCellsByRow.push([]);
          displaced.push(row);
        } else {
          // Row is a non-horizontal split (e.g., a vertical column container).
          // Pull every leaf inside it into the displaced bucket so the column
          // can run unobstructed across the full grid height.
          leftCellsByRow.push([]);
          rightCellsByRow.push([]);
          getLeafIds(row).forEach((leafId) => {
            displaced.push({ type: "leaf", tabId: leafId });
          });
        }
      });

      const buildColumn = (
        cellsByRow: SplitLayoutNode[][],
      ): SplitLayoutNode | null => {
        const rowNodes: SplitLayoutNode[] = [];
        for (const cells of cellsByRow) {
          if (cells.length === 0) continue;
          if (cells.length === 1) rowNodes.push(cells[0]);
          else
            rowNodes.push({
              type: "split",
              direction: "horizontal",
              children: cells,
            });
        }
        if (rowNodes.length === 0) return null;
        if (rowNodes.length === 1) return rowNodes[0];
        return { type: "split", direction: "vertical", children: rowNodes };
      };

      const leftColumn = buildColumn(leftCellsByRow);
      const rightColumn = buildColumn(rightCellsByRow);

      const sliceChildren: SplitLayoutNode[] = [];
      if (leftColumn) sliceChildren.push(leftColumn);
      sliceChildren.push(leafLeaf);
      if (rightColumn) sliceChildren.push(rightColumn);

      const newSlice: SplitLayoutNode =
        sliceChildren.length === 1
          ? sliceChildren[0]
          : {
              type: "split",
              direction: "horizontal",
              children: sliceChildren,
            };

      const modified = replaceAtDepth(grandparentDepth, newSlice);
      return appendBottomRow(modified, displaced);
    }
  }

  // Fallback: leaf is on its own at the root, or in an unsupported config.
  // Just replace whatever is at the leaf's path with the leaf and displace
  // siblings to a new bottom row (if there are any).
  if (chain.length === 1) return tree; // leaf is the root already
  const parent = chain[chain.length - 2];
  if (parent.type !== "split") return tree;
  const parentDepth = chain.length - 2;
  const allInParent = getLeafIds(parent);
  const displaced: SplitLayoutNode[] = allInParent
    .filter((id) => id !== tabId)
    .map((id) => ({ type: "leaf", tabId: id }));
  const modified = replaceAtDepth(parentDepth, leafLeaf);
  return appendBottomRow(modified, displaced);
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
