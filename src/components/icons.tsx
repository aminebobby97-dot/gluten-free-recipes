// Small inline SVG icon set (stroke icons, 24px grid).

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const ServingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 15h16" />
    <path d="M5.5 15a6.5 6.5 0 0 1 13 0" />
    <path d="M12 8.5V7M3 18h18" />
  </Icon>
);

export const PrinterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 9V4h10v5" />
    <rect x="4" y="9" width="16" height="7" rx="2" />
    <path d="M7 14h10v6H7z" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const LeafIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z" />
    <path d="M5 19 13 11" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4 2.8 19.5h18.4L12 4Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const PinterestIcon = ({ size = 18, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...p}>
    <path d="M12 2a10 10 0 0 0-3.64 19.31c-.09-.78-.17-1.98.03-2.84l1.18-5s-.3-.6-.3-1.49c0-1.4.81-2.44 1.82-2.44.86 0 1.27.64 1.27 1.41 0 .86-.55 2.15-.83 3.34-.24 1 .5 1.81 1.48 1.81 1.78 0 3.15-1.88 3.15-4.59 0-2.4-1.73-4.08-4.19-4.08-2.85 0-4.53 2.14-4.53 4.35 0 .86.33 1.79.75 2.29.08.1.09.19.07.29l-.28 1.13c-.04.18-.15.22-.33.13-1.25-.58-2.03-2.4-2.03-3.87 0-3.15 2.29-6.04 6.6-6.04 3.46 0 6.16 2.47 6.16 5.77 0 3.44-2.17 6.21-5.18 6.21-1.01 0-1.97-.53-2.29-1.15l-.62 2.38c-.23.87-.84 1.96-1.25 2.62A10 10 0 1 0 12 2Z" />
  </svg>
);

/** Line illustrations used for category cards and image placeholders. */
export function CategoryGlyph({ slug, size = 56, ...props }: IconProps & { slug?: string | null }) {
  const common = { size, strokeWidth: 1.4, ...props };
  switch (slug) {
    case "gluten-free-breakfast": // pancake stack
      return (
        <Icon {...common}>
          <ellipse cx="12" cy="16.5" rx="8" ry="2" />
          <path d="M4 16.5v-1.8c0-1.1 3.6-2 8-2s8 .9 8 2v1.8" />
          <path d="M4.6 13.6v-1.6c0-1 3.3-1.8 7.4-1.8s7.4.8 7.4 1.8v1.6" />
          <path d="M10 8.5c.8-1.2 3.2-1.2 4 0M12 10.2v-1.7" />
        </Icon>
      );
    case "gluten-free-lunch": // bowl with greens
      return (
        <Icon {...common}>
          <path d="M3.5 12h17a8.5 8.5 0 0 1-17 0Z" />
          <path d="M8 12c0-2.5 1.5-4 3-4.5M12.5 12c.3-2.6 2-4.3 4.2-4.5M9.5 20.5h5" />
        </Icon>
      );
    case "gluten-free-dinner": // plate with fork and knife
      return (
        <Icon {...common}>
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M2.5 5v4.5a1.5 1.5 0 0 0 3 0V5M4 11v8.5M21 5c-1.5 1-2 3-2 5.5h2V19.5" />
        </Icon>
      );
    case "gluten-free-desserts": // cake slice
      return (
        <Icon {...common}>
          <path d="M3.5 19.5h17v-7l-17-4.5v11.5Z" />
          <path d="M3.5 13h17M3.5 8l9-3.5 8 8" />
          <path d="M12 4.5V3" />
        </Icon>
      );
    case "gluten-free-baking": // loaf
      return (
        <Icon {...common}>
          <path d="M5 19.5V11a4 4 0 0 1-1-7c1.7-1.2 4-1 5 .5 1-1.5 4-2 6-1s4 1 5 3a4 4 0 0 1-1 4.5v8.5H5Z" />
          <path d="M9 9.5l1.5 1.5M12.5 8.5 14 10M16 9.5l1 1" />
        </Icon>
      );
    case "gluten-free-snacks": // energy bites
      return (
        <Icon {...common}>
          <circle cx="8" cy="15" r="4" />
          <circle cx="16" cy="15" r="4" />
          <circle cx="12" cy="8" r="4" />
          <path d="M7 14h.01M16 16h.01M12 7h.01M10.5 9h.01" />
        </Icon>
      );
    case "gluten-free-dairy-free": // leaf + drop
      return (
        <Icon {...common}>
          <path d="M12 3.5c3 3.6 5 6.6 5 9.5a5 5 0 0 1-10 0c0-2.9 2-5.9 5-9.5Z" />
          <path d="M4 20 20 4" />
        </Icon>
      );
    case "high-protein-gluten-free": // egg
      return (
        <Icon {...common}>
          <path d="M12 3c3.6 0 6.5 5.4 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.4 8.4 3 12 3Z" />
          <circle cx="12" cy="14" r="2.6" />
        </Icon>
      );
    default: // whisk
      return (
        <Icon {...common}>
          <path d="M12 21v-6" />
          <path d="M12 15c-3.5 0-5-4.5-5-8s2-4.5 5-4.5 5 1 5 4.5-1.5 8-5 8Z" />
          <path d="M12 15c-1.4 0-2-4.5-2-8s.8-4.5 2-4.5 2 1 2 4.5-.6 8-2 8Z" />
        </Icon>
      );
  }
}
