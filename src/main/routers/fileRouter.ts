import { t } from "../trpc";

export const fileRouter = t.router({
    convertSrc: t.procedure
      .input((input: unknown) => input as string)
      .query(({ input }) => {
        if (
          !input ||
          input.startsWith("http") ||
          input.startsWith("local-media://")
        )
          return input;
        const normalized = input.replace(/\\/g, "/");
        const segments = normalized.split("/");
        const encodedSegments = segments.map((seg, index) => {
          if (index === 0 && /^[a-zA-Z]:$/.test(seg)) {
            return seg;
          }
          return encodeURIComponent(seg);
        });
        return `local-media:///${encodedSegments.join("/")}`;
      }),
  });
