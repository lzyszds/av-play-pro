import { t } from "../trpc";
import { getMainWindow } from "../windowState";

const mainWindowProxy = {
  minimize: () => getMainWindow()?.minimize(),
  isMaximized: () => getMainWindow()?.isMaximized(),
  unmaximize: () => getMainWindow()?.unmaximize(),
  maximize: () => getMainWindow()?.maximize(),
  focus: () => {
    const window = getMainWindow();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  },
  close: () => getMainWindow()?.close(),
};

export const windowRouter = t.router({
    minimize: t.procedure.mutation(() => {
      mainWindowProxy.minimize();
      return { success: true };
    }),
    maximize: t.procedure.mutation(() => {
      if (mainWindowProxy.isMaximized()) {
        mainWindowProxy.unmaximize();
      } else {
        mainWindowProxy.maximize();
      }
      return { success: true };
    }),
    close: t.procedure.mutation(() => {
      mainWindowProxy.close();
      return { success: true };
    }),
    focus: t.procedure.mutation(() => {
      mainWindowProxy.focus();
      return { success: true };
    }),
  });
