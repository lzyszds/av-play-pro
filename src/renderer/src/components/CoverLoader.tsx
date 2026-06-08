import React from "react";
import type { LoaderStyle } from "../pages/download/types";

interface CoverLoaderProps {
  /** 显式指定样式；不传时读取 document.documentElement.dataset.loader */
  variant?: LoaderStyle;
}

const VALID_LOADERS: LoaderStyle[] = [
  "eq",
  "vinyl",
  "wave",
  "radar",
  "prism",
  "matrix",
  "orbit",
  "pulse",
  "scan",
];

function normalizeVariant(value: unknown): LoaderStyle {
  return VALID_LOADERS.includes(value as LoaderStyle)
    ? (value as LoaderStyle)
    : "eq";
}

function readVariant(): LoaderStyle {
  if (typeof document === "undefined") return "eq";
  return normalizeVariant(document.documentElement.dataset.loader);
}

export const CoverLoader: React.FC<CoverLoaderProps> = ({ variant }) => {
  const v = normalizeVariant(variant ?? readVariant());

  return (
    <div className="cover-placeholder absolute inset-0 flex items-center justify-center overflow-hidden">
      {v === "eq" && (
        <>
          <div className="cover-eq" aria-hidden>
            <span /><span /><span /><span /><span />
          </div>
          <div className="cover-scanline" aria-hidden />
        </>
      )}
      {v === "wave" && (
        <div className="cover-wave" aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
      )}
      {v === "radar" && (
        <div className="cover-radar" aria-hidden>
          <span />
        </div>
      )}
      {v === "prism" && (
        <div className="cover-prism" aria-hidden>
          <span /><span /><span />
        </div>
      )}
      {v === "vinyl" && (
        <div className="cover-vinyl" aria-hidden>
          <div className="cover-vinyl-disc">
            <div className="cover-vinyl-label" />
          </div>
        </div>
      )}
      {v === "matrix" && (
        <div className="cover-matrix" aria-hidden>
          <span /><span /><span /><span /><span /><span /><span /><span /><span />
        </div>
      )}
      {v === "orbit" && (
        <div className="cover-orbit" aria-hidden>
          <span /><span /><span />
        </div>
      )}
      {v === "pulse" && (
        <div className="cover-pulse" aria-hidden>
          <span /><span />
        </div>
      )}
      {v === "scan" && (
        <div className="cover-scope" aria-hidden>
          <span /><span /><span /><span />
        </div>
      )}
    </div>
  );
};
