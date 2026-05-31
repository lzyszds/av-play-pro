import { t } from "./trpc";
import { downloadRouter } from "./routers/downloadRouter";
import { videosRouter } from "./routers/videosRouter";
import { windowRouter } from "./routers/windowRouter";
import { dialogRouter } from "./routers/dialogRouter";
import { fileRouter } from "./routers/fileRouter";
import { extensionRouter } from "./routers/extensionRouter";
import { storageRouter } from "./routers/storageRouter";

export const appRouter = t.router({
  download: downloadRouter,
  videos: videosRouter,
  window: windowRouter,
  dialog: dialogRouter,
  file: fileRouter,
  extension: extensionRouter,
  storage: storageRouter,
});

export type AppRouter = typeof appRouter;
