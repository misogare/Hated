/**
 * A photo the visitor adds in the web demo, kept the way the API keeps one:
 * fitted within 1080 by 1350 and re-encoded as JPEG (drawing it on a canvas
 * leaves the file's metadata, GPS included, behind), plus a blurred copy made
 * from a 24-pixel thumbnail, so no detail survives in it.
 */

export interface KeptPhoto {
  full: string;
  blurred: string;
  width: number;
  height: number;
}

function load(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('unreadable'));
    image.src = uri;
  });
}

function jpeg(image: HTMLImageElement, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function keepPhoto(uri: string): Promise<KeptPhoto> {
  const image = await load(uri);
  const scale = Math.min(1, 1080 / image.naturalWidth, 1350 / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const thumbnail = jpeg(image, 24, Math.max(1, Math.round((24 * height) / width)));
  // The thumbnail, stretched past the edges and blurred, so the edges don't fade.
  const blurred = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(width / 18)}"/></filter>
  <image href="${thumbnail}" x="${-0.15 * width}" y="${-0.15 * height}" width="${1.3 * width}" height="${1.3 * height}" preserveAspectRatio="none" filter="url(#blur)"/>
</svg>`;
  return {
    full: jpeg(image, width, height),
    blurred: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(blurred)}`,
    width,
    height,
  };
}
