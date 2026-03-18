import sharp from "sharp";
import Tesseract from "tesseract.js";

/**
 * 识别验证码
 * @param imageBuffer 从 axios 抓取到的图片 Buffer
 * @returns 识别出的 4 位字符串, 或更多字符(错误, 需重试)
 */
export async function recognizeCaptcha(imageBuffer: Buffer): Promise<string> {
  console.log("正在对验证码进行降噪预处理...");
  // 1. 获取原图的 Raw RGB 像素数据
  // 优化：在提取 Raw 之前，先做一次轻度模糊，抹平 JPEG 压缩带来的背景杂色块
  const { data, info } = await sharp(imageBuffer)
    .removeAlpha()
    .median(3) // 提前平滑，让后续的频数统计更集中
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 2. 核心改进：统计法获取最真实的背景色 (众数提取)
  const colorCounts = new Map<string, number>();
  let maxCount = 0;
  let bgR = 255, bgG = 255, bgB = 255;

  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];

    // 将 RGB 降低一点精度进行分组 (除以 10 抹平细微色差)，避免相似但不同的背景色被分散
    const key = `${Math.floor(r / 10)},${Math.floor(g / 10)},${
      Math.floor(b / 10)
    }`;
    const count = (colorCounts.get(key) || 0) + 1;
    colorCounts.set(key, count);

    // 记录出现次数最多的具体色值，这就是无可争议的背景色
    if (count > maxCount) {
      maxCount = count;
      bgR = r;
      bgG = g;
      bgB = b;
    }
  }

  // 创建一个只有单通道（灰度/二值）的空 Buffer，大小为 宽 * 高
  const binaryBuffer = Buffer.alloc(info.width * info.height);

  // 3. 遍历所有像素，计算与背景色的“色差”
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];

    const colorDist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

    // 阈值设定：你改为了 90。因为我们在第 1 步加入了前置的 median(3)，
    // 图像变得更平滑了，90 是一个很合理的阈值，能有效过滤掉边缘模糊带。
    // if (colorDist > 70) {
    //   binaryBuffer[i] = 0;   // 黑色 (文字/干扰线)
    // } else {
    //   binaryBuffer[i] = 255; // 白色 (背景)
    // }
    binaryBuffer[i] = Math.min(Math.max(255 + 20 - colorDist / 1.4, 0), 255);
  }

  // 4. 将抠图后的纯黑白 Buffer 重新塞回 sharp，利用中值滤波抹除细长干扰线
  const processedImageBuffer = await sharp(binaryBuffer, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 1,
    },
  })
    .median(3) // 再次中值滤波，此时是在黑白图上进行，专门用于吃掉细小的黑色干扰线
    .png()
    .toBuffer();

  // 调试用：保存出来看看效果
  // await writeFile('./debug_captcha.png', processedImageBuffer);

  console.log("正在调用 OCR 引擎识别...");

  // 2. OCR 识别
  const result = await Tesseract.recognize(processedImageBuffer, "eng", {
    // logger: m => {}, // 屏蔽内部日志输出
    // 核心配置：白名单和页面分割模式
    // tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    // tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD // PSM=8: 告诉引擎整个图像是一个单词，不要加空格
  });

  // console.log("Result: ", result);
  // // 3. 后期清洗
  // // 剔除可能识别出的零星非白名单字符，并强制截取前 4 位
  // let text = result.data.text.replace(/[^A-Za-z0-9]/g, '');

  // // 如果长度不够或超长，尽量保证返回 4 位
  // if (text.length > 4) text = text.substring(0, 4);

  return result.data.text.trim();
}

// import { readFile, writeFile } from 'fs/promises';
// import { argv } from 'process';
// if (import.meta.main) {
//   const text = await recognizeCaptcha(await readFile(argv[2] ?? "captcha.png"))
//   console.log(text);
// }
