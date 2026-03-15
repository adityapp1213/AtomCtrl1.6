import React from "react";

export function Beacon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2a3 3 0 0 0-3 3c0 .7.2 1.3.6 1.8L3.5 20h17L14.4 6.8c.4-.5.6-1.1.6-1.8a3 3 0 0 0-3-3Zm0 7.5 3.6 8H8.4L12 9.5Z" />
    </svg>
  );
}

