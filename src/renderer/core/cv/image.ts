/**
 * 把界面上的图（dataURL）变成识别算法要的 ImageData。
 *
 * 单独拎出来是因为现在不止一处要识别：手动导入那张图、内置浏览器的截取、
 * 还有实时截取每隔几秒截一次。几处各写一遍 canvas 容易写漏 willReadFrequently，
 * 那个漏了会让 getImageData 每次都从 GPU 回读一遍，实时截取一开就白烧 CPU。
 */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片打不开'));
    img.src = dataUrl;
  });
}

export function imageDataOf(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function imageDataFromUrl(dataUrl: string): Promise<ImageData> {
  return imageDataOf(await loadImage(dataUrl));
}
