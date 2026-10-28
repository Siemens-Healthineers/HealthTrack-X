interface HTXLogoProps {
  className?: string;
}

export function HTXLogo({ className = '' }: HTXLogoProps) {
  return (
    <svg 
      className={className}
      viewBox="0 0 220 50" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Medical Cross with Heart */}
      <g>
        {/* Circular background */}
        <circle cx="25" cy="25" r="22" className="fill-primary/10" />
        
        {/* Heart outline */}
        <path 
          d="M25 35L19 29C16.5 26.5 16.5 22.5 19 20C20.5 18.5 22.5 18 24.5 18.5C25 18.5 25.5 19 25 19.5C25.5 19 26 18.5 26.5 18.5C28.5 18 30.5 18.5 32 20C34.5 22.5 34.5 26.5 32 29L25 35Z" 
          className="fill-primary"
        />
        
        {/* EKG pulse line */}
        <path 
          d="M10 25 L15 25 L17 20 L19 30 L21 25 L40 25" 
          className="stroke-cyan-500 dark:stroke-cyan-400"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </g>
      
      {/* Text: Health */}
      <text 
        x="55" 
        y="22" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="16" 
        fontWeight="600"
        className="fill-foreground"
      >
        Health
      </text>
      
      {/* Text: Track */}
      <text 
        x="55" 
        y="38" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="16" 
        fontWeight="600"
        className="fill-cyan-500 dark:fill-cyan-400"
      >
        Track
      </text>
      
      {/* Dash */}
      <line 
        x1="115" 
        y1="25" 
        x2="125" 
        y2="25" 
        className="stroke-foreground"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      
      {/* X in rounded square */}
      <g transform="translate(130, 10)">
        <rect 
          x="0" 
          y="0" 
          width="30" 
          height="30" 
          rx="6" 
          className="fill-primary"
        />
        <text 
          x="15" 
          y="22" 
          fontFamily="system-ui, -apple-system, sans-serif" 
          fontSize="20" 
          fontWeight="700"
          className="fill-primary-foreground"
          textAnchor="middle"
        >
          X
        </text>
      </g>
    </svg>
  );
}
