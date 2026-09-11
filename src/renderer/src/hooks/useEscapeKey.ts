import { useEffect } from "react";

/**
 * 弹窗 Esc 关闭：组件挂载期间监听 document keydown，
 * 按下 Escape 时调用 onClose。
 * enabled 为 false 时不监听（用于常驻挂载、按条件启停的场景）。
 */
export function useEscapeKey(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}
