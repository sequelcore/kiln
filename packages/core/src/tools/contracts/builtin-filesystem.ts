type NodeFilesystem = typeof import("node:fs/promises");

/** Host filesystem port consumed by canonical developer-tool semantics. */
export interface BuiltinFilesystem {
  readonly lstat: NodeFilesystem["lstat"];
  readonly mkdir: NodeFilesystem["mkdir"];
  readonly open: NodeFilesystem["open"];
  readonly readFile: NodeFilesystem["readFile"];
  readonly readdir: NodeFilesystem["readdir"];
  readonly rm: NodeFilesystem["rm"];
  readonly stat: NodeFilesystem["stat"];
  readonly writeFile: NodeFilesystem["writeFile"];
}

const unavailable = async (): Promise<never> => {
  throw new Error("Filesystem execution requires a Runtime-owned adapter");
};

export const unavailableBuiltinFilesystem: BuiltinFilesystem = {
  lstat: unavailable as BuiltinFilesystem["lstat"],
  mkdir: unavailable as BuiltinFilesystem["mkdir"],
  open: unavailable as BuiltinFilesystem["open"],
  readFile: unavailable as BuiltinFilesystem["readFile"],
  readdir: unavailable as BuiltinFilesystem["readdir"],
  rm: unavailable as BuiltinFilesystem["rm"],
  stat: unavailable as BuiltinFilesystem["stat"],
  writeFile: unavailable as BuiltinFilesystem["writeFile"],
};
