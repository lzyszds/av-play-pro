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
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            setFailed(true);
            onError?.(e);
          }}
          // 用 visibility 切换避开 opacity 渐变带来的合成层重算；fade 视觉收益很小，但每次滚动出现新卡片都付一次代价
          style={{ visibility: loaded ? "visible" : "hidden" }}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </div>
  );
};
