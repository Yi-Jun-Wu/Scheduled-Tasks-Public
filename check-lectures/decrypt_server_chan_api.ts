import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const privateKey = process.env.RSA_PRIVATE_KEY || readFileSync('./private.pem', 'utf8');
if (!privateKey || privateKey.trim() === '') {
  console.error("未找到 RSA 私钥，请确保环境变量 RSA_PRIVATE_KEY 已设置且 Github Secrets 已配置");
  process.exit(1);
}

/**
 * 解密 RSA-OAEP-SHA256 的 Hex 字符串
 * @param {string} encryptedHex - 小写的 hex 密文
 * @param {crypto.KeyObject | string} privateKey - 私钥
 * @returns {string} 解密后的 UTF-8 明文
 */
function decryptApiKey(encryptedHex: string, privateKey: crypto.KeyObject | string): string | null {
  try {
    // 1. hex (low cases) -> Buffer
    const bufferToDecrypt = Buffer.from(encryptedHex, 'hex');

    // 2. 解密 (严格匹配 OAEP 和 SHA256)
    const decryptedBuffer = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256', // 必须明确指定，Node.js 默认可能是 sha1
      },
      bufferToDecrypt
    );

    // 3. Buffer -> utf-8
    return decryptedBuffer.toString('utf8');

  } catch (error: any) {
    console.error("解密失败，可能是密文损坏或密钥不匹配:", error.message);
    return null;
  }
}

/** 验证 API key 合法性 
 * 合法 key 格式: SCTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 */
function isValidApiKey(apiKey: string): boolean {
  const apiKeyPattern = /^[A-Za-z0-9]{30, 40}$/;
  return apiKeyPattern.test(apiKey);
}

function isLikelyRsaCipherText(encryptedHex: string, keySizeInBits: number = 2048): boolean {
  const hexPattern = /^[0-9a-fA-F]+$/;
  // 计算预期长度：2048位密钥对应 256字节，即 512个十六进制字符
  const expectedHexLength = (keySizeInBits / 8) * 2;
  return (
    hexPattern.test(encryptedHex) &&
    encryptedHex.length === expectedHexLength
  );
}

/** 批量处理 API keys
 * @param {string[]} raw - 原始数据数组
 * @returns {string[]} 处理后的 API keys 数组
 */
function batchParseApiKeys(raw: string[]): string[] {
  function processSingleEntry(entry: string): string[] {
    const results: string[] = [];
    const full = entry.replace(/\s\n/g, '');
    if (isValidApiKey(full) || isLikelyRsaCipherText(full)) {
      results.push(full);
    }
    const lines = entry.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (isValidApiKey(trimmed) || isLikelyRsaCipherText(trimmed)) {
        results.push(trimmed);
      }
    }
    return results;
  }
  const allResults = new Set<string>();
  for (const entry of raw) {
    const processed = processSingleEntry(entry);
    for (const item of processed) {
      allResults.add(item);
    }
  }
  return Array.from(allResults);
}

/** 批量解密 API keys
 * @param {string[]} encryptedHexArray - 加密的 hex 字符串数组
 * @param {crypto.KeyObject | string} privateKey - 私钥
 * @returns {string[]} 解密后的 API keys 数组
 */
function decryptBatchApiKeys(encryptedHexArray: string[], privateKey: crypto.KeyObject | string): string[] {
  const decryptedKeys = new Set<string>();
  for (const encryptedHex of encryptedHexArray) {
    const decrypted = decryptApiKey(encryptedHex, privateKey)?.trim();
    if (decrypted && isValidApiKey(decrypted)) {
      decryptedKeys.add(decrypted);
    }
  }
  return Array.from(decryptedKeys);
}

/** 处理 API keys
 * @param {string[]} raw - 原始数据数组
 * @returns {string[]} 处理后的 API keys 数组
 */
export function processApiKeys(raw: string[]): string[] {
  const candidates = batchParseApiKeys(raw);
  const decryptedKeys = decryptBatchApiKeys(candidates, privateKey);
  return decryptedKeys;
}