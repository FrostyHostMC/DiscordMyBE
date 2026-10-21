import { useState, useEffect, useRef } from 'react';

type ImageMap<K extends string> = Partial<Record<K, HTMLImageElement>>;

/**
 * Loads images in parallel. MUST destructure: `const { images, loaded } = useGameImages(urls)`.
 * Pass a stable object (module-level const or useMemo) to avoid re-triggering.
 */
export function useGameImages<K extends string>(
  urls: Record<K, string>,
): { images: ImageMap<K>; loaded: boolean; progress: number } {
  const [images, setImages] = useState<ImageMap<K>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const entriesRef = useRef(urls);

  const keys = Object.keys(urls) as K[];
  const total = keys.length;

  useEffect(() => {
    const currentUrls = entriesRef.current;
    const result: ImageMap<K> = {};
    let count = 0;
    let cancelled = false;

    const onDone = () => {
      count++;
      if (!cancelled) {
        setLoadedCount(count);
        if (count >= total) {
          setImages({ ...result });
        }
      }
    };

    (Object.entries(currentUrls) as [K, string][]).forEach(([key, url]) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { result[key] = img; onDone(); };
      img.onerror = () => { onDone(); };
      img.src = url;
    });

    return () => { cancelled = true; };
  }, []);  

  return {
    images,
    loaded: total > 0 ? loadedCount >= total : true,
    progress: total > 0 ? loadedCount / total : 1,
  };
}
