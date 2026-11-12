import React from 'react';

/**
 * Full-bleed animated nebula artwork.
 *
 * This is rendered locally (no remote image, GIF URL, emoji, or image-service
 * dependency), so it is available immediately on every route and scales with
 * the viewport without stretching UI content.
 */
export const CosmicBackdrop: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`autobe-cosmic-backdrop ${className}`.trim()} aria-hidden="true">
    <div className="cosmic-nebula cosmic-nebula--violet" />
    <div className="cosmic-nebula cosmic-nebula--indigo" />
    <div className="cosmic-nebula cosmic-nebula--magenta" />
    <svg className="cosmic-nebula-noise" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <filter id="autobe-nebula-clouds" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.006 0.012"
            numOctaves="4"
            seed="17"
            stitchTiles="stitch"
            result="nebulaNoise"
          >
            <animate attributeName="baseFrequency" values="0.006 0.012;0.009 0.008;0.005 0.014;0.006 0.012" dur="48s" repeatCount="indefinite" />
            <animate attributeName="seed" values="17;23;31;17" dur="72s" repeatCount="indefinite" />
          </feTurbulence>
          <feColorMatrix in="nebulaNoise" type="matrix" values="
            0.22 0 0 0 0.02
            0 0.08 0 0 0
            0 0 0.42 0 0.08
            0 0 0 0.72 0
          " />
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <radialGradient id="autobe-nebula-core">
          <stop offset="0" stopColor="#d9a7ff" stopOpacity=".72" />
          <stop offset=".24" stopColor="#8b35ed" stopOpacity=".46" />
          <stop offset="1" stopColor="#4c1d95" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1000" height="1000" filter="url(#autobe-nebula-clouds)" opacity=".9" />
      <ellipse cx="505" cy="425" rx="490" ry="350" fill="url(#autobe-nebula-core)" opacity=".55" />
    </svg>
    <div className="cosmic-starfield cosmic-starfield--fine" />
    <div className="cosmic-starfield cosmic-starfield--bright" />
    <div className="cosmic-nebula-vignette" />
  </div>
);

export default CosmicBackdrop;
