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
import { whisperRouter } from "./routers/whisperRouter";
import { rssRouter } from "./routers/rssRouter";
import { libraryRouter } from "./routers/libraryRouter";
import { postprocessRouter } from "./routers/postprocessRouter";
import { actorRouter } from "./routers/actorRouter";
import { scenesRouter } from "./routers/scenesRouter";
import { intelRouter } from "./routers/intelRouter";
import { scrapeRouter } from "./routers/scrapeRouter";
import { syncRouter } from "./routers/syncRouter";
import { snapshotRouter } from "./routers/snapshotRouter";
import { activityRouter } from "./routers/activityRouter";
import { organizerRouter } from "./routers/organizerRouter";
import { achievementsRouter } from "./routers/achievementsRouter";

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
  whisper: whisperRouter,
  rss: rssRouter,
  library: libraryRouter,
  postprocess: postprocessRouter,
  actor: actorRouter,
  scenes: scenesRouter,
  intel: intelRouter,
  scrape: scrapeRouter,
  sync: syncRouter,
  snapshot: snapshotRouter,
  activity: activityRouter,
  organizer: organizerRouter,
  achievements: achievementsRouter,
});

export type AppRouter = typeof appRouter;
