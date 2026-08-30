import { lstat, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { BuiltinFilesystem } from "@kilnai/core/tools";

export const nodeBuiltinFilesystem: BuiltinFilesystem = {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
};
