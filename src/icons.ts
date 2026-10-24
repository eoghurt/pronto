// Line icons, drawn on a 24-unit grid with round ends to match Figtree.

const svg = (body: string, extra = "") =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  highlight: svg(`<path d="M14.5 4.5l5 5-8.5 8.5H6v-5z"/><path d="M5 21h7"/>`),
  type: svg(`<path d="M6 5h12M12 5v14"/>`),
  draw: svg(`<path d="M3 14c2-3 3.5-3 5 0s3 3 4.5 0 3-3 4.5 0 2.5 2 4 0"/>`),
  sign: svg(`<path d="M3 16c2-6 3.5-6 4.5-1s2.5 2 3.5-1 2-3 3 0 2 2 4 1"/><path d="M3 20h18"/>`),
  pages: svg(`<rect x="5" y="3" width="11" height="14" rx="2.5"/><path d="M9 21h7.5a2.5 2.5 0 0 0 2.5-2.5V8"/>`),
  back: svg(`<path d="M14.5 6l-6 6 6 6"/>`),
  undo: svg(`<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
  redo: svg(`<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`),
  share: svg(`<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/>`),
  download: svg(`<path d="M12 4v12M6 11l6 6 6-6M5 21h14"/>`, `stroke-width="2.6"`),
  rotate: svg(`<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>`),
  trash: svg(`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7M9 7V4h6v3"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),
  minus: svg(`<path d="M5 12h14"/>`),
  close: svg(`<path d="M6 6l12 12M18 6L6 18"/>`),
  check: svg(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  calendar: svg(`<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>`),
  pen: svg(`<path d="M16 4l4 4L9 19H5v-4z"/>`),
};

/** The Pronto mark: a slanted P with its top corner folded down. */
export function mark(colour = "#FF5A3C", letter = "#FFF6EC", fold = "#FFB08F") {
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" rx="24" fill="${colour}"/>
    <g transform="translate(50 50) skewX(-9) translate(-50 -50)">
      <path fill="${letter}" fill-rule="evenodd" d="M33 21H59L72 36V45C72 57 64 63 52 63H47V77Q47 80 44 80H36Q33 80 33 77ZM47 34H56Q60 34 60 38V45Q60 50 55 50H47Z"/>
      <path fill="${fold}" d="M59 21V33Q59 36 62 36H72Z"/>
    </g>
  </svg>`;
}
