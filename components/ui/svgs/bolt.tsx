import React from "react";

export function Bolt(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M13 2 3 14h7l-1 8 12-14h-7l-1-6Z" />
    </svg>
  );
}

