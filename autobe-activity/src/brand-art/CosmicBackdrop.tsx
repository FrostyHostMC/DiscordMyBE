import React from 'react';

/** Full-bleed AutoBE artwork. Images are served locally from the app's public assets. */
export const CosmicBackdrop: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`autobe-cosmic-backdrop ${className}`.trim()} aria-hidden="true">
    <img className="autobe-cosmic-backdrop__base" src="/assets/C4100D18-7746-409D-A333-C1AD7A8D14AF.gif" alt="" />
    <img className="autobe-cosmic-backdrop__clouds" src="/assets/Background%20App.gif" alt="" />
    <div className="autobe-cosmic-backdrop__shade" />
  </div>
);

export default CosmicBackdrop;
