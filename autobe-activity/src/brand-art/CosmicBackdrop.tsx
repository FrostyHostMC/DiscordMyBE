import React from 'react';

/** Full-bleed, locally hosted animated AutoBE background artwork. */
export const CosmicBackdrop: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`autobe-cosmic-backdrop ${className}`.trim()} aria-hidden="true">
    <img
      src="/assets/Background%20App.gif"
      alt=""
      draggable={false}
      className="autobe-cosmic-backdrop__image"
    />
    <div className="autobe-cosmic-backdrop__shade" />
  </div>
);

export default CosmicBackdrop;
