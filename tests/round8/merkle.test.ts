/**
 * Unit tests for server/services/merkle.ts — pure Merkle tree logic
 * (build / proof / verify) used by the tribunal bundle manifest.
 *
 * Run: vitest run --root tests/round8   (the repo vitest.config only
 * includes server/**; these tests are self-contained pure logic).
 */
import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  hashLeaf,
  buildMerkleTree,
  merkleRoot,
  getMerkleProof,
  verifyMerkleProof,
  hashPair,
  isHexDigest,
  EMPTY_TREE_ROOT,
} from "../../server/services/merkle";

const leaves = (n: number) =>
  Array.from({ length: n }, (_, i) => hashLeaf(`artifact-${i}`));

describe("sha256Hex / hashLeaf", () => {
  it("produces 64-char lowercase hex digests", () => {
    const h = sha256Hex("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(isHexDigest(h)).toBe(true);
    expect(hashLeaf("hello")).toBe(h);
  });

  it("matches the well-known sha256 test vector for the empty string", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("uses the same 'genesis' convention as the antiwipe ledger", () => {
    // server/antiwipe/ledger.ts: GENESIS_HASH = sha256Hex("genesis")
    expect(sha256Hex("genesis")).toBe(
      "aeebad4a796fcc2e15dc4c6061b45ed9b373f26adfc798ca7d2d8cc58182718e",
    );
  });
});

describe("buildMerkleTree", () => {
  it("empty tree hashes to sha256('empty')", () => {
    const tree = buildMerkleTree([]);
    expect(tree.root).toBe(EMPTY_TREE_ROOT);
    expect(tree.leafCount).toBe(0);
  });

  it("single leaf: root IS the leaf", () => {
    const [l] = leaves(1);
    expect(merkleRoot([l])).toBe(l);
  });

  it("two leaves: root = sha256(left + right) as hex-text concat", () => {
    const [a, b] = leaves(2);
    expect(merkleRoot([a, b])).toBe(hashPair(a, b));
    // order matters
    expect(merkleRoot([a, b])).not.toBe(merkleRoot([b, a]));
  });

  it("odd leaf count duplicates the last node", () => {
    const [a, b, c] = leaves(3);
    const expected = hashPair(hashPair(a, b), hashPair(c, c));
    expect(merkleRoot([a, b, c])).toBe(expected);
  });

  it("is deterministic", () => {
    const ls = leaves(7);
    expect(buildMerkleTree(ls).root).toBe(buildMerkleTree([...ls]).root);
  });

  it("rejects malformed digests", () => {
    expect(() => buildMerkleTree(["not-hex"])).toThrow(/hex/);
    expect(() => buildMerkleTree(["A".repeat(64)])).toThrow(/hex/); // uppercase
  });
});

describe("getMerkleProof / verifyMerkleProof", () => {
  it.each([1, 2, 3, 4, 5, 7, 8, 13, 16])(
    "round-trips a proof for every leaf of a %i-leaf tree",
    (n) => {
      const ls = leaves(n);
      const root = merkleRoot(ls);
      for (let i = 0; i < n; i += 1) {
        const proof = getMerkleProof(ls, i);
        expect(verifyMerkleProof(ls[i], proof, root)).toBe(true);
      }
    },
  );

  it("proof length is ceil(log2(n)) for n > 1", () => {
    expect(getMerkleProof(leaves(2), 0)).toHaveLength(1);
    expect(getMerkleProof(leaves(4), 3)).toHaveLength(2);
    expect(getMerkleProof(leaves(5), 4)).toHaveLength(3);
    expect(getMerkleProof(leaves(16), 0)).toHaveLength(4);
  });

  it("single-leaf tree has an empty proof", () => {
    const [l] = leaves(1);
    expect(getMerkleProof([l], 0)).toEqual([]);
    expect(verifyMerkleProof(l, [], l)).toBe(true);
  });

  it("rejects a proof for the wrong leaf (tamper detection)", () => {
    const ls = leaves(6);
    const root = merkleRoot(ls);
    const proof = getMerkleProof(ls, 2);
    const forged = hashLeaf("artifact-2-tampered");
    expect(verifyMerkleProof(forged, proof, root)).toBe(false);
  });

  it("rejects a proof against the wrong root", () => {
    const ls = leaves(4);
    const proof = getMerkleProof(ls, 1);
    const otherRoot = merkleRoot(leaves(4).reverse());
    expect(verifyMerkleProof(ls[1], proof, otherRoot)).toBe(false);
  });

  it("rejects out-of-range proof requests", () => {
    const ls = leaves(3);
    expect(() => getMerkleProof(ls, 3)).toThrow(/out of range/);
    expect(() => getMerkleProof(ls, -1)).toThrow(/out of range/);
  });

  it("mutating one leaf changes the root (manifest tamper-evidence)", () => {
    const ls = leaves(8);
    const root = merkleRoot(ls);
    const tampered = [...ls];
    tampered[5] = hashLeaf("different-content");
    expect(merkleRoot(tampered)).not.toBe(root);
  });
});
