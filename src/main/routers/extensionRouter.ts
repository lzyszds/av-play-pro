import { clipboard } from "electron";
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { t } from "../trpc";
import { resolveExtensionPath } from "../extensions/extensionPath";
import { consumeQueuedExtensionTaskPushes } from "../extensions/pushServer";

function findChromeExecutable(): string {
  const candidates =
    process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA &&
            path.join(
              process.env.LOCALAPPDATA,
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
          process.env.PROGRAMFILES &&
            path.join(
              process.env.PROGRAMFILES,
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
          process.env["PROGRAMFILES(X86)"] &&
            path.join(
              process.env["PROGRAMFILES(X86)"],
              "Google",
              "Chrome",
              "Application",
              "chrome.exe",
            ),
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/snap/bin/chromium",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];

  const chromePath = candidates.find(
    (candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)),
  );

  if (!chromePath) {
    throw new Error("Google Chrome executable was not found.");
  }

  return chromePath;
}

function isChromeRunning(): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);

  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq chrome.exe", "/NH"],
      { windowsHide: true },
      (_error, stdout) => {
        resolve(stdout.toLowerCase().includes("chrome.exe"));
      },
    );
  });
}

function navigateChromeToExtensionsPage(): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();

  const script = [
    "$ws = New-Object -ComObject WScript.Shell",
    "Start-Sleep -Milliseconds 900",
    "$activated = $ws.AppActivate('Google Chrome')",
    "if (-not $activated) { $activated = $ws.AppActivate('Chrome') }",
    "if ($activated) {",
    "  Start-Sleep -Milliseconds 200",
    "  $ws.SendKeys('^l')",
    "  Start-Sleep -Milliseconds 100",
    "  $ws.SendKeys('^v')",
    "  Start-Sleep -Milliseconds 100",
    "  $ws.SendKeys('{ENTER}')",
    "}",
  ].join("; ");

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
      () => resolve(),
    );
  });
}

export const extensionRouter = t.router({
  consumePushedTasks: t.procedure.mutation(() => {
    return consumeQueuedExtensionTaskPushes();
  }),

  installToChrome: t.procedure
    .input((input: unknown) => (input as Record<string, never>) || {})
    .mutation(async () => {
      const extensionPath = resolveExtensionPath();
      const chromePath = findChromeExecutable();
      const chromeRunning = await isChromeRunning();
      clipboard.writeText("chrome://extensions");

      const child = spawn(chromePath, [], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      await navigateChromeToExtensionsPage();
      clipboard.writeText(extensionPath);

      return {
        success: true,
        chromePath,
        extensionPath,
        chromeRunning,
        clipboardWritten: true,
      };
    }),
});
