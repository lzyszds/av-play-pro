import React from "react";

interface LogoProps {
  size?: number;
  animated?: boolean;
  showBackground?: boolean;
  className?: string;
}

const BARS = [
  { x: 14, base: 56, color: "#ec4899" },
  { x: 26, base: 30, color: "#e0408a" },
  { x: 38, base: 18, color: "#d13b7a" },
  { x: 48, base: 22, color: "#c14269" },
  { x: 58, base: 18, color: "#b85a4a" },
  { x: 68, base: 34, color: "#c97032" },
  { x: 80, base: 46, color: "#e08020" },
  { x: 92, base: 58, color: "#f97316" },
];

const BAR_W = 7;
const VIEW = 100;
const CENTER_Y = 50;

export const Logo: React.FC<LogoProps> = ({
  size = 64,
  animated = false,
  showBackground = true,
  className,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AV Play Pro"
    >
      <defs>
        <linearGradient id="avplay-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1410" />
          <stop offset="100%" stopColor="#0a0606" />
        </linearGradient>
      </defs>

      {showBackground && (
        <rect
          x="2"
          y="2"
          width={VIEW - 4}
          height={VIEW - 4}
          rx="22"
          ry="22"
          fill="url(#avplay-bg)"
        />
      )}

      {BARS.map((b, i) => {
        const h = b.base;
        return (
          <rect
            key={i}
            x={b.x - BAR_W / 2}
            y={CENTER_Y - h / 2}
            width={BAR_W}
            height={h}
            rx={BAR_W / 2}
            ry={BAR_W / 2}
            fill={b.color}
            style={
              animated
                ? {
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animation: `logo-bar-pulse 1.1s ease-in-out ${i * 0.09}s infinite`,
                  }
                : undefined
            }
          />
        );
      })}
    </svg>
  );
};
