import { dialog } from "electron";
import { t } from "../trpc";
import { getMainWindow } from "../windowState";

export const dialogRouter = t.router({
    selectFolder: t.procedure
      .input((input: unknown) => (input as { currentPath?: string }) || {})
      .query(async ({ input }) => {
        const result = await dialog.showOpenDialog(getMainWindow()!, {
          properties: ["openDirectory"],
          defaultPath: input.currentPath || undefined,
        });
        return result.canceled ? null : result.filePaths[0];
      }),
  });
