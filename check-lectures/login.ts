import { readFile, writeFile } from "node:fs/promises";
import { constants as crypto_constants, publicEncrypt } from "node:crypto";
// import { createInterface } from 'readline/promises';

import axios, { type AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

import { recognizeCaptcha } from "./captcha.ts";

// 配置常量
const COOKIE_FILE = "./session_cookies.json";
const TARGET_URL = {
  "humanity": "https://xkcts.ucas.ac.cn:8443/subject/humanityLecture",
  "science": "https://xkcts.ucas.ac.cn:8443/subject/lecture",
};

const TARGET_NAME = {
  "humanity": "人文讲座报名",
  "science": "科学前沿讲座预告（报名）",
};

// ⚠️ 生产环境中请保存入 Secrets, 不得使用明文
// 从环境变量读取账号密码
const USERNAME = process.env.SEP_USERNAME || process.env.USERNAME!;
const PASSWORD = process.env.SEP_PASSWORD! || process.env.PASSWORD!;
if (USERNAME === undefined || PASSWORD === undefined) {
  console.error("❌ 致命错误: 未检测到 USERNAME 或 PASSWORD 环境变量！");
  console.error(
    "如果你在 GitHub Actions 运行，请检查 workflow 的 env 配置以及 Secrets 是否正确绑定。",
  );
  process.exit(1); // 异常退出
}

/**
 * 判断 HTML 内容是否表示失效或未登录
 * 你可以根据实际的未登录页面特征（如包含 "请登录"、"统一身份认证" 等关键字）来完善这个函数
 */
function is_invalid(html: string): boolean {
  // 示例规则：如果页面包含返回登录页的关键字，或者没有预期的讲座列表 DOM 特征
  if (html.includes("你的会话已失效或身份已改变，请重新登录")) {
    return true;
  }
  // 也可以检查长度等特征
  if (html.length < 10000) {
    return true;
  }
  return false;
}

// === Cookie 文件持久化工具 ===
async function loadCookieJar(): Promise<CookieJar> {
  try {
    const data = (await readFile(COOKIE_FILE)).toString();
    return CookieJar.deserializeSync(JSON.parse(data));
  } catch (err) {
    // 文件不存在或解析失败时，返回一个新的空 Jar
    return new CookieJar();
  }
}

async function saveCookieJar(jar: CookieJar): Promise<void> {
  const serialized = jar.serializeSync();
  await writeFile(COOKIE_FILE, JSON.stringify(serialized, null, 2));
}

// === Node.js 原生 RSA 加密 (替代 JSEncrypt) ===
function encryptPassword(pwd: string, pubKeyBase64: string): string {
  const pemKey =
    `-----BEGIN PUBLIC KEY-----\n${pubKeyBase64}\n-----END PUBLIC KEY-----`;
  const buffer = Buffer.from(pwd, "utf8");
  const encrypted = publicEncrypt({
    key: pemKey,
    padding: crypto_constants.RSA_PKCS1_PADDING,
  }, buffer);
  return encrypted.toString("base64");
}

let global_client: AxiosInstance | null = null;
let currentSubsystemOrigin = '';

// // 封装一个命令行的交互输入函数
// async function askQuestion(query: string): Promise<string> {
//   const rl = createInterface({
//     input: process.stdin,
//     output: process.stdout,
//   });
//   const text = await rl.question(query);
//   rl.close();
//   return text;
// }

// === 主流程 ===

export const fetch_lecture_list = login_for_data;

// 自动登录, 并获取数据
export async function login_for_data(
  type: "humanity" | "science",
  pageNum?: number,
): Promise<string | undefined> {
  // 1. 初始化带有本地持久化 Cookie 的 axios 客户端
  let jar = await loadCookieJar();
  const chromeHeaders = {
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br", // 移除了 zstd 以防止 Node.js 解压失败
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "max-age=0",
    "Connection": "keep-alive",
    "Origin": "https://sep.ucas.ac.cn",
    "Referer": "https://sep.ucas.ac.cn/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "sec-ch-ua":
      '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };

  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    // 允许自动跟进 303/302 重定向
    maxRedirects: 10,
    proxy: false, // 强制禁用自动读取系统代理环境变量
    headers: chromeHeaders, // 注入全局伪装 Headers
  }));

  console.log("正在尝试使用本地缓存的 Session 访问目标页面...");

  let params;
  if (pageNum) params = { pageNum };

  try {
    // 2. 尝试直接访问最终目标页
    const testRes = await client.get(TARGET_URL[type], { params });

    if (!is_invalid(testRes.data)) {
      // console.log("✅ Session 仍然有效，直接获取到讲座列表数据！");
      // 这里可以继续执行你的讲座检测与预约逻辑
      global_client = client;
      currentSubsystemOrigin = new URL(testRes.config.url!).origin; // 保存到模块变量
      return testRes.data;
    } else {
      console.log("⚠️ Session 已失效，准备执行完整登录流程...");
    }
  } catch (e: any) {
    console.log(
      `⚠️ 网络请求异常或 Session 失效 (${e.message})，准备重新登录...`,
    );
  }

  // 3. 清空过期的 Cookie，准备从头开始
  jar.removeAllCookiesSync();

  try {
    console.log("-> 步骤 1: 获取主页，提取动态公钥并获取初始 JSESSIONID...");

    const MAX_LOGIN_ATTEMPTS = 3;
    let loginSuccess = false;

    // 外层循环：最多尝试 3 次登录流程
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
      console.log(`\n========== 开始第 ${attempt} 次登录尝试 ==========`);

      console.log("-> 步骤 1: 获取主页，提取动态公钥并获取初始 JSESSIONID...");
      const resHome = await client.get("https://sep.ucas.ac.cn/");
      const pubKeyMatch = resHome.data.match(/var\s+jsePubKey\s*=\s*'([^']+)'/);
      if (!pubKeyMatch) throw new Error("无法从主页提取 jsePubKey 密钥");
      const jsePubKey = pubKeyMatch[1];

      let certCode: string | undefined = undefined;

      // 判断页面是否触发了验证码防御机制
      if (resHome.data.includes("验证码")) {
        console.log("-> 步骤 1.5: 检测到验证码，开始自动化识别...");

        // 内层循环：直到获取并识别出一个格式完美的验证码为止
        while (true) {
          const timestamp = new Date().getTime();
          // 请求时带上时间戳避免缓存
          const captchaRes = await client.get(
            `https://sep.ucas.ac.cn/changePic?code=${timestamp}`,
            {
              responseType: "arraybuffer",
            },
          );

          // 调用之前封装好的 OCR 识别函数
          const recognizedText = await recognizeCaptcha(captchaRes.data);

          // 严格校验格式：必须是精确的 4 位大小写字母或数字
          if (/^[A-Za-z0-9]{4}$/.test(recognizedText)) {
            certCode = recognizedText;
            console.log(`✅ 验证码识别成功: ${certCode}`);
            break; // 跳出验证码刷新循环
          } else {
            console.log(
              `⚠️ 识别结果异常 (${recognizedText})，图像过于复杂，正在刷新验证码重试...`,
            );
            // 稍微停顿 500ms，防止高频请求被 WAF 彻底封杀 IP
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }

      console.log("-> 步骤 2: 提交登录表单...");
      const passwordRSA = encryptPassword(PASSWORD, jsePubKey);
      const loginDataJson: Record<string, string> = {
        userName: USERNAME,
        pwd: passwordRSA,
        loginFrom: "",
        sb: "sb",
      };

      // 修正了原来的 Key 赋值错误
      if (certCode) {
        loginDataJson["certCode"] = certCode;
      }

      const loginData = new URLSearchParams(loginDataJson);

      const loginRes = await client.post(
        "https://sep.ucas.ac.cn/slogin",
        loginData.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      // 核心判断逻辑：Axios 会自动跟随重定向。
      // 如果登录成功，通常会重定向到 /appStoreStudent 等其他路径。
      // 如果登录失败，系统会 302 跳回登录页（即 URL 为 https://sep.ucas.ac.cn/）。
      const finalUrl = loginRes.request.res.responseUrl || loginRes.config.url;

      if (
        finalUrl === "https://sep.ucas.ac.cn/" ||
        loginRes.data.includes("错误") || loginRes.data.includes("无效")
      ) {
        console.log(
          `❌ 第 ${attempt} 次登录失败。可能原因：密码错误、验证码识别错误或被风控。`,
          loginRes.data,
          loginRes.headers
        );
        throw new Error(`登录失败，返回 URL: ${finalUrl}`);

        if (attempt === MAX_LOGIN_ATTEMPTS) {
          throw new Error(
            `已达到最大尝试次数 (${MAX_LOGIN_ATTEMPTS} 次)，程序退出。`,
          );
        }
        console.log("准备进行下一次尝试...\n");
        // 失败后等待 1 秒，让之前的 Session 彻底失效，并为下一次请求留出缓冲
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        console.log("✅ 登录成功！顺利突破认证。", finalUrl);
        loginSuccess = true;
        break; // 成功则跳出整个外层重试循环
      }
    }
    if(!loginSuccess){
      throw new Error("经过多次尝试，仍然无法登录。");
    }

    console.log("-> 步骤 3: 访问 businessMenu 提取讲座系统入口路径...");
    const resMenu = await client.get("https://sep.ucas.ac.cn/businessMenu");
    // 匹配 "科学前沿讲座预告（报名）" 对应的 href 路径
    const menuRegex = new RegExp(
      `href="(\\/portal\\/site\\/[^"]+)"[^>]*>${TARGET_NAME[type]}`,
    );
    // const menuRegex = /href="(\/portal\/site\/[^"]+)"[^>]*>科学前沿讲座预告/;
    const menuMatch = resMenu.data.match(menuRegex);
    if (!menuMatch) throw new Error("无法在菜单页中找到讲座系统的入口链接");
    const portalPath = menuMatch[1];

    console.log("-> 步骤 4: 访问入口页破译真实的 SSO 登录链接...");
    const resPortal = await client.get(`https://sep.ucas.ac.cn${portalPath}`);
    const metaRegex = /<meta\s+http-equiv="refresh"\s+content="0;url=([^"]+)"/i;
    const metaMatch = resPortal.data.match(metaRegex);
    if (!metaMatch) throw new Error("无法从 portal 页面解析出转跳的 meta url");
    // 把 HTML 实体符号替换回来，非常重要
    const ssoUrl = metaMatch[1].replace(/&amp;/g, "&");

    console.log("-> 步骤 5: 访问 SSO 链接，建立最终系统 Session...");
    // 这一步 axios 会自动处理连续的 303 重定向，并更新 cookie 中的 SESSION 值
    let finalRes = await client.get(ssoUrl);

    console.log("-> 步骤 6: 验证最终页面并保存新的 Session...");
    // const finalRes = await client.get(TARGET_URL[type]);
    const finalUrl = finalRes.request.res.responseUrl || finalRes.config.url;
    if (finalUrl !== TARGET_URL[type]) {
      console.error(
        "最终链接路径错误(Real !== Expected):",
        finalUrl,
        "!==",
        TARGET_URL[type],
      );
      console.error("可能无法获取正确数据");
    }

    if (params) finalRes = await client.get(TARGET_URL[type], { params });

    if (!is_invalid(finalRes.data)) {
      console.log("✅ 重新登录成功！");
      await saveCookieJar(jar);
      console.log("💾 新的 Session 已成功保存到本地文件。");

      // 这里可以继续执行你的讲座检测与预约逻辑
      global_client = client;
      currentSubsystemOrigin = new URL(finalUrl).origin; // 保存到模块变量
      return finalRes.data;
    } else {
      console.error(
        "❌ 流程执行完毕，但最终页面内容仍然无效。可能是网络波动或学校系统结构更新。",
      );
    }
  } catch (error: any) {
    console.error("❌ 登录流程中发生错误:", error.message);
  }
}

export async function fetch_url(url: string, params?: any): Promise<string> {
  if (global_client === null) {
    login_for_data("humanity");
  }
  if (!global_client) {
    throw new Error("Could not login to SEP!");
  }
  // turn /portal/site/xxx into https://xkxt.ucas.ac.cn:8843/portal/site/xxx
  if (url.startsWith("/")) {
    url = currentSubsystemOrigin + url;
  }
  const response = params
    ? global_client.get(url, { params })
    : global_client.get(url);
  return (await response).data;
}

// // 执行主程序
// const data = await main();

// console.log(data?.slice(0, 100), "...", data?.slice(-100));
