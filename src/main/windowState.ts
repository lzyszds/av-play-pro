import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;
let downloadWidgetWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setDownloadWidgetWindow(win: BrowserWindow | null): void {
  downloadWidgetWindow = win;
}

export function getDownloadWidgetWindow(): BrowserWindow | null {
  return downloadWidgetWindow;
}
