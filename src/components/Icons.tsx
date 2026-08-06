// Minimal inline icon set (16×16 viewBox, stroke-based) so we don't need an
// icon library. Size via CSS `1em`.
interface IconProps {
  size?: number;
}

function svg(path: React.ReactNode, { size = 16 }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const FolderPlus = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M1.5 3.5h4l1.5 2h7.5v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" />
      <path d="M8 8v4M6 10h4" />
    </>,
    p,
  );

export const FolderMinus = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M1.5 3.5h4l1.5 2h7.5v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" />
      <path d="M6 10h4" />
    </>,
    p,
  );

export const Folder = (p: IconProps = {}) =>
  svg(<path d="M1.5 3.5h4l1.5 2h7.5v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-9z" />, p);

export const ImportIcon = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M8 1.5v8M5 6.5l3 3 3-3" />
      <path d="M2 11v2.5A1 1 0 0 0 3 14.5h10a1 1 0 0 0 1-1V11" />
    </>,
    p,
  );

export const Sparkles = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2z" />
      <path d="M13 10.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
    </>,
    p,
  );

export const Refresh = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.7 1.8v3h-3" />
    </>,
    p,
  );

export const SearchIcon = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>,
    p,
  );

export const GearIcon = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" />
    </>,
    p,
  );

export const TerminalIcon = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4 6l2.5 2L4 10M8 10.5h4" />
    </>,
    p,
  );

export const PanelLeft = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M6 2.5v11" />
    </>,
    p,
  );

export const PanelRight = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M10 2.5v11" />
    </>,
    p,
  );

export const PdfIcon = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
      <path d="M9.5 1.5V5H13" />
    </>,
    p,
  );

export const CloseIcon = (p: IconProps = {}) =>
  svg(<path d="M4 4l8 8M12 4l-8 8" />, p);

export const ChevronRight = (p: IconProps = {}) =>
  svg(<path d="M6 3.5L10.5 8 6 12.5" />, p);

export const ChevronDown = (p: IconProps = {}) =>
  svg(<path d="M3.5 6L8 10.5 12.5 6" />, p);

export const CheckIcon = (p: IconProps = {}) =>
  svg(<path d="M2.5 8.5l3.5 3.5 7.5-8" />, p);

export const GlobeIcon = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c1.8 1.8 2.7 4 2.7 6.5S9.8 12.7 8 14.5c-1.8-1.8-2.7-4-2.7-6.5S6.2 3.3 8 1.5z" />
    </>,
    p,
  );

export const CopyIcon = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
      <path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3" />
    </>,
    p,
  );

export const SendIcon = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M14 2L7.5 8.5" />
      <path d="M14 2L9.8 14l-2.3-5.5L2 6.2z" />
    </>,
    p,
  );

export const Spinner = ({ size = 16 }: IconProps = {}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    className="spin"
    aria-hidden="true"
  >
    <circle
      cx="8"
      cy="8"
      r="6"
      stroke="currentColor"
      strokeOpacity="0.25"
      strokeWidth="2"
    />
    <path
      d="M14 8a6 6 0 0 0-6-6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
