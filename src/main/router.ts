import { t } from "./trpc";
import { downloadRouter } from "./routers/downloadRouter";
import { videosRouter } from "./routers/videosRouter";
import { windowRouter } from "./routers/windowRouter";
import { dialogRouter } from "./routers/dialogRouter";
import { fileRouter } from "./routers/fileRouter";
import { extensionRouter } from "./routers/extensionRouter";
import { storageRouter } from "./routers/storageRouter";
import { loggerRouter } from "./routers/loggerRouter";
import { systemRouter } from "./routers/systemRouter";
import { metaRouter } from "./routers/metaRouter";
import { statsRouter } from "./routers/statsRouter";

export const appRouter = t.router({
  download: downloadRouter,
  videos: videosRouter,
  window: windowRouter,
  dialog: dialogRouter,
  file: fileRouter,
  extension: extensionRouter,
  storage: storageRouter,
  logger: loggerRouter,
  system: systemRouter,
  meta: metaRouter,
  stats: statsRouter,
});

export type AppRouter = typeof appRouter;
