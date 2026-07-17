export function isCanonicalArtifactContentUri(uri: string): boolean {
  return /^kiln:\/\/artifacts\/[^/]+\/[^/]+\/content$/u.test(uri);
}
