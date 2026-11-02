/** Sign-in illustration: a service desk agent answering requests (from docs/fe/service-desk-illustration.svg). */
export default function ServiceDeskIllustration({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 460 340"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A service desk agent with a headset answering requests at a laptop"
    >
      {/* floor shadow */}
      <ellipse
        cx="230"
        cy="312"
        rx="190"
        ry="14"
        fill="#C9DAF0"
        opacity="0.7"
      />

      {/* floating ticket cards (left) */}
      <g transform="translate(18 40) rotate(-6)">
        <rect width="132" height="62" rx="10" fill="#FFFFFF" stroke="#D5E2F3" />
        <rect width="6" height="62" rx="3" fill="#FF8200" />
        <rect x="18" y="14" width="74" height="8" rx="4" fill="#003883" />
        <rect x="18" y="30" width="96" height="6" rx="3" fill="#D5E2F3" />
        <rect x="18" y="42" width="60" height="6" rx="3" fill="#D5E2F3" />
        <circle
          cx="112"
          cy="18"
          r="7"
          fill="#FFF1E0"
          stroke="#FF8200"
          strokeWidth="2"
        />
        <path
          d="M112 14v4l2.5 2"
          stroke="#FF8200"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(34 122) rotate(3)">
        <rect width="132" height="62" rx="10" fill="#FFFFFF" stroke="#D5E2F3" />
        <rect width="6" height="62" rx="3" fill="#8DC63F" />
        <rect x="18" y="14" width="64" height="8" rx="4" fill="#003883" />
        <rect x="18" y="30" width="96" height="6" rx="3" fill="#D5E2F3" />
        <rect x="18" y="42" width="72" height="6" rx="3" fill="#D5E2F3" />
        <circle cx="112" cy="18" r="8" fill="#8DC63F" />
        <path
          d="M108 18l3 3 5-6"
          stroke="#FFFFFF"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* chat bubble */}
      <g transform="translate(330 18)">
        <path
          d="M0 14a14 14 0 0 1 14-14h70a14 14 0 0 1 14 14v26a14 14 0 0 1-14 14H30l-14 12v-12h-2A14 14 0 0 1 0 40z"
          fill="#003883"
        />
        <circle cx="30" cy="27" r="5" fill="#FFFFFF" />
        <circle cx="49" cy="27" r="5" fill="#FFFFFF" opacity="0.8" />
        <circle cx="68" cy="27" r="5" fill="#8DC63F" />
      </g>

      {/* plant */}
      <g transform="translate(350 166)">
        <path d="M18 40 C2 22 4 6 14 0 C18 14 22 26 18 40Z" fill="#8DC63F" />
        <path d="M20 40 C34 24 40 12 34 2 C26 14 20 26 20 40Z" fill="#6FA82E" />
        <path d="M19 40 C14 30 6 26 0 26 C6 34 12 40 19 40Z" fill="#A6D46A" />
        <path d="M6 40h28l-4 26H10z" fill="#FF8200" />
      </g>

      {/* agent: chair back */}
      <rect x="228" y="120" width="96" height="120" rx="22" fill="#B9CCE6" />
      {/* agent: body */}
      <path
        d="M232 230 C232 178 250 158 276 158 C302 158 320 178 320 230 Z"
        fill="#8DC63F"
      />
      <path d="M262 160 L276 182 L290 160 Z" fill="#FFFFFF" />
      {/* neck and head */}
      <rect x="268" y="138" width="16" height="22" rx="6" fill="#8A5A3B" />
      <circle cx="276" cy="118" r="26" fill="#9B6644" />
      <path
        d="M250 112 C252 90 300 86 302 112 C298 100 262 98 250 112Z"
        fill="#2B1A12"
      />
      {/* headset */}
      <path
        d="M248 118 C246 84 306 84 304 118"
        fill="none"
        stroke="#003883"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect x="242" y="110" width="12" height="20" rx="5" fill="#FF8200" />
      <rect x="298" y="110" width="12" height="20" rx="5" fill="#FF8200" />
      <path
        d="M248 128 C250 144 262 148 270 146"
        fill="none"
        stroke="#003883"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="271" cy="146" r="3.5" fill="#003883" />
      {/* arm reaching to laptop */}
      <path
        d="M246 196 C236 214 222 226 204 230"
        fill="none"
        stroke="#8DC63F"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <circle cx="202" cy="230" r="8" fill="#9B6644" />

      {/* desk */}
      <rect x="96" y="232" width="300" height="14" rx="4" fill="#003883" />
      <rect x="112" y="246" width="10" height="62" rx="3" fill="#0A4CA8" />
      <rect x="370" y="246" width="10" height="62" rx="3" fill="#0A4CA8" />

      {/* laptop */}
      <path d="M120 232 L132 168 H228 L216 232 Z" fill="#E3E8EF" />
      <path d="M126 226 L136 174 H222 L212 226 Z" fill="#FFFFFF" />
      <rect x="146" y="186" width="44" height="6" rx="3" fill="#003883" />
      <rect x="144" y="198" width="58" height="5" rx="2.5" fill="#D5E2F3" />
      <rect x="142" y="208" width="50" height="5" rx="2.5" fill="#D5E2F3" />
      <circle cx="204" cy="189" r="4" fill="#8DC63F" />
      <rect x="106" y="228" width="132" height="6" rx="3" fill="#B9CCE6" />

      {/* mug */}
      <rect
        x="300"
        y="206"
        width="22"
        height="26"
        rx="4"
        fill="#FFFFFF"
        stroke="#D5E2F3"
        strokeWidth="2"
      />
      <path
        d="M322 212 h5 a6 6 0 0 1 0 12 h-5"
        fill="none"
        stroke="#D5E2F3"
        strokeWidth="3"
      />
      <rect x="300" y="214" width="22" height="5" fill="#FF8200" />
    </svg>
  );
}
