import React from 'react';

/**
 * Uses the supplied animated nebula artwork as the actual app background.
 * The two locally hosted GIF layers keep the artwork moving without a video
 * dependency or remote image request.
 */
export const CosmicBackdrop: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`autobe-cosmic-backdrop ${className}`.trim()} aria-hidden="true">
    <img
      className="autobe-cosmic-backdrop__image autobe-cosmic-backdrop__image--primary"
      src="/assets/C4100D18-7746-409D-A333-C1AD7A8D14AF.gif"
      alt=""
      draggable={false}
    />
    <img
      className="autobe-cosmic-backdrop__image autobe-cosmic-backdrop__image--secondary"
      src="/assets/3628521F-1216-48A5-A53A-C70EF1F25B4D.gif"
      alt=""
      draggable={false}
    />
    <div className="autobe-cosmic-backdrop__shade" />
  </div>
);

export default CosmicBackdrop;
