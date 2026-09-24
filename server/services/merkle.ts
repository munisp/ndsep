/**
 * Pure Merkle tree service (SHA-256, node:crypto only — no I/O, no DB).
 *
 * Used by server/routers/tribunalBundle.ts to build the per-bundle artifact
 * manifest root that is anchored into the anti-wipe audit ledger, and by the
 * court-facing verifyBundle path to recompute proofs.
 *
 * Tree conventions (identical to server/antiwipe/ledger.ts#computeMerkleRoot
 * and the Rust workers/rust/audit_chain service, so a bundle root can be
 * cross-checked against the daily ledger anchor algorithm):
 *
 *   - Leaves are lowercase hex SHA-256 digests (64 chars). Callers hash their
 *     own content first (hashLeaf / sha256Hex helpers provided).
 *   - Parent = sha256Hex(left + right) — hex strings CONCATENATED AS TEXT,
 *     not as decoded bytes. This matches the existing ledger convention.
 *   - An odd leaf at any level is duplicated (paired with itself).
 *   - The empty tree hashes to sha256Hex("empty"), same as the ledger.
 *
 * Everything in this module is deterministic and side-effect free, which is
 * what makes it unit-testable under tests/round8/.
 */
import crypto from "node:crypto";

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Hash arbitrary leaf content into a hex digest suitable for the tree. */
export function hashLeaf(content: Buffer | string): string {
  return sha256Hex(content);
}

const HEX64 = /^[0-9a-f]{64}$/;

export function isHexDigest(value: string): boolean {
  return HEX64.test(value);
}

function assertDigest(value: string, label: string): void {
  if (!HEX64.test(value)) {
    throw new Error(`merkle: ${label} must be a lowercase 64-char hex SHA-256 digest, got '${value.slice(0, 80)}'`);
  }
}

/** sha256 of the empty tree — mirrors antiwipe ledger computeMerkleRoot([]). */
export const EMPTY_TREE_ROOT = sha256Hex("empty");

export interface MerkleProofStep {
  /** Sibling digest at this level. */
  hash: string;
  /** Where the sibling sits relative to the running node. */
  position: "left" | "right";
}

export interface MerkleTree {
  /** Bottom-up levels; levels[0] = leaves, last level = [root]. */
  levels: string[][];
  root: string;
  leafCount: number;
}

/**
 * Combine two digests into their parent. Order matters: left || right.
 * Exported so proof verifiers use exactly the same combiner as builders.
 */
export function hashPair(left: string, right: string): string {
  assertDigest(left, "left digest");
  assertDigest(right, "right digest");
  return sha256Hex(`${left}${right}`);
}

/** Build the full tree from leaf digests. Input order is significant. */
export function buildMerkleTree(leaves: string[]): MerkleTree {
  leaves.forEach((l, i) => assertDigest(l, `leaf[${i}]`));
  if (leaves.length === 0) {
    return { levels: [[]], root: EMPTY_TREE_ROOT, leafCount: 0 };
  }
  const levels: string[][] = [[...leaves]];
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashPair(level[i], right));
    }
    levels.push(next);
    level = next;
  }
  return { levels, root: level[0], leafCount: leaves.length };
}

/** Convenience: root only (same result as buildMerkleTree(leaves).root). */
export function merkleRoot(leaves: string[]): string {
  return buildMerkleTree(leaves).root;
}

/**
 * Inclusion proof for the leaf at `index`: one sibling digest per level,
 * bottom-up. An odd-level duplicated node yields itself as the sibling,
 * which verifyMerkleProof handles symmetrically.
 */
export function getMerkleProof(leaves: string[], index: number): MerkleProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`merkle: proof index ${index} out of range (0..${leaves.length - 1})`);
  }
  const tree = buildMerkleTree(leaves);
  const proof: MerkleProofStep[] = [];
  let idx = index;
  // levels[0] = leaves; stop before the root level.
  for (let depth = 0; depth < tree.levels.length - 1; depth += 1) {
    const level = tree.levels[depth];
    const isRightNode = idx % 2 === 1;
    const siblingIdx = isRightNode ? idx - 1 : idx + 1;
    const sibling =
      siblingIdx < level.length
        ? level[siblingIdx]
        : level[idx]; // odd level: node paired with itself
    proof.push({
      hash: sibling,
      position: isRightNode ? "left" : "right",
    });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/**
 * Verify an inclusion proof: fold the leaf with each proof step and compare
 * against the expected root. Constant-work; throws on malformed input,
 * returns a boolean verdict on well-formed input.
 */
export function verifyMerkleProof(
  leaf: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): boolean {
  assertDigest(leaf, "leaf");
  assertDigest(expectedRoot, "expected root");
  let node = leaf;
  for (const step of proof) {
    node =
      step.position === "left"
        ? hashPair(step.hash, node)
        : hashPair(node, step.hash);
  }
  // timingSafeEqual over equal-length hex buffers to avoid early-exit compare.
  const a = Buffer.from(node, "utf8");
  const b = Buffer.from(expectedRoot, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Root over already-hashed evidence rows for a tribunal bundle manifest.
 * Leaves are sorted by artifact index BEFORE calling this — the function
 * deliberately does not sort so the manifest ordering stays explicit and
 * reproducible for the court verifier.
 */
export function bundleManifestRoot(artifactDigests: string[]): string {
  return merkleRoot(artifactDigests);
}
