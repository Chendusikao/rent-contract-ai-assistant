/**
 * 图片压缩工具
 * 手机拍照的大图（通常 3-12MB）压缩到最长边 1600px、质量 0.8，
 * 显著减小上传体积、加快后端 OCR 速度
 */
export async function compressImage(file: File, maxSize = 1600, quality = 0.8): Promise<File> {
  // 非图片或小图直接返回
  if (!file.type.startsWith('image/')) return file;
  if (file.size < 500 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // 计算缩放后尺寸
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    // 转 Blob（保持原格式，png 转 jpeg 更小）
    const mime = file.type === 'image/png' ? 'image/jpeg' : file.type;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), mime, quality);
    });
    if (!blob) return file;

    // 压缩后仍然更大则不使用
    if (blob.size >= file.size) return file;

    const name = file.name.replace(/\.(png|jpg|jpeg)$/i, '.jpg');
    return new File([blob], name, { type: mime });
  } catch {
    return file; // 压缩失败则用原图
  }
}
