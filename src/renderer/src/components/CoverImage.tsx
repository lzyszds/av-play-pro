import React, { useState } from "react";
import { Logo } from "./Logo";

interface CoverImageProps {
  src?: string;
  alt?: string;
  className?: string;
  logoSize?: number;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export const CoverImage: React.FC<CoverImageProps> = ({
  src,
  alt,
  className,
  logoSize = 56,
  onError,
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const showPlaceholder = !src || !loaded || failed;

  return (
    <div className={`relative w-full h-full bg-slate-900 ${className ?? ""}`}>
      {showPlaceholder && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#1a1410] to-[#0a0606]">
          <Logo size={logoSize} animated showBackground={false} />
        </div>
      )}
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
