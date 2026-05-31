import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export const EXTENSION_DIR_NAME = "m3u8-sniffer-extension";

export function resolveExtensionPath(): string {
  const extensionPath = app.isPackaged
    ? path.join(process.resourcesPath, "extension", EXTENSION_DIR_NAME)
    : path.resolve(process.cwd(), "extension", EXTENSION_DIR_NAME);

  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error(`Extension manifest not found: ${extensionPath}`);
  }

  return extensionPath;
}
