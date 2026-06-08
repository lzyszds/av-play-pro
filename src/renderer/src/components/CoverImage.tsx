import React, { useState } from "react";
import { CoverLoader } from "./CoverLoader";

interface CoverImageProps {
  src?: string;
  alt?: string;
  className?: string;
  /** 兼容旧参数：已废弃，loader 样式由全局设置控制 */
  logoSize?: number;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export const CoverImage: React.FC<CoverImageProps> = ({
  src,
  alt,
  className,
  onError,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const showPlaceholder = !src || !loaded || failed;

  return (
    <div className={`relative w-full h-full bg-slate-900 ${className ?? ""}`}>
      {showPlaceholder && <CoverLoader />}
      {src && !failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            setFailed(true);
            onError?.(e);
          }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
};
