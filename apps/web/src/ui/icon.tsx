import type { SVGProps } from "react";

export type IconName = "contracts" | "templates" | "approvals" | "customers" | "shield" | "journal" | "users" | "menu" | "close" | "logout" | "arrow";

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const sharedProps = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props,
  };

  switch (name) {
    case "contracts":
      return (
        <svg {...sharedProps}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h5M10 16h5" />
        </svg>
      );
    case "templates":
      return (
        <svg {...sharedProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 9h16M9 9v11" />
        </svg>
      );
    case "approvals":
      return (
        <svg {...sharedProps}>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12.2 2.4 2.4 4.6-5" />
        </svg>
      );
    case "customers":
      return (
        <svg {...sharedProps}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c.7-3.8 3.1-5.7 7-5.7s6.3 1.9 7 5.7" />
        </svg>
      );
    case "shield":
      return (
        <svg {...sharedProps}>
          <path d="M12 3 19 6v5c0 4.5-2.7 7.9-7 10-4.3-2.1-7-5.5-7-10V6l7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "journal":
      return (
        <svg {...sharedProps}>
          <path d="M6 4h13v16H6a3 3 0 0 1 0-16Z" />
          <path d="M6 4a3 3 0 0 0 0 16M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "users":
      return (
        <svg {...sharedProps}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c.5-3.4 2.4-5 6-5s5.5 1.6 6 5" />
          <path d="M16 5.5a3 3 0 0 1 0 5.8M17 15c2.2.6 3.5 2.1 4 5" />
        </svg>
      );
    case "menu":
      return (
        <svg {...sharedProps}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "close":
      return (
        <svg {...sharedProps}>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      );
    case "logout":
      return (
        <svg {...sharedProps}>
          <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...sharedProps}>
          <path d="M5 12h13M13 7l5 5-5 5" />
        </svg>
      );
  }
}
