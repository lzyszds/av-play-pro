import React from "react";

interface PageLoaderProps {
  active: boolean;
  label?: string;
}

export const PageLoader: React.FC<PageLoaderProps> = ({
  active,
  label = "正在加载",
}) => {
  return (
    <div className="page-loader" data-active={active ? "true" : "false"}>
      <div className="page-loader-inner">
        <div className="page-loader-label">{label}</div>
        <div className="page-loader-bar" aria-hidden>
          <span className="page-loader-bar-track" />
          <span className="page-loader-bar-beam" />
        </div>
      </div>
    </div>
  );
};
