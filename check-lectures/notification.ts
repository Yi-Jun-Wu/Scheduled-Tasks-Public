// ⚠️ 生产环境中请保存入 Secrets, 不得使用明文

import { processAnyApiKeys, processApiKeys } from "./decrypt_server_chan_api.ts";
import type { Lecture } from "./extract.ts";
import { get_all_replies } from "./get_all_replies.ts";

// // 从环境变量读取账号密码
// const API_KEY = process.env.API_KEY!;
// if (API_KEY === undefined) {
//   console.error("❌ 致命错误: 未检测到 API_KEY 环境变量！");
//   console.error(
//     "如果你在 GitHub Actions 运行，请检查 workflow 的 env 配置以及 Secrets 是否正确绑定。",
//   );
//   process.exit(1); // 异常退出
// }

const REGISTER_URL =
  "https://github.com/Yi-Jun-Wu/Scheduled-Tasks-Public/discussions/1";

const COMMENT_NODE_ID = {
  humanity: process.env.COMMENT_NODE_ID_HUMANITY!, // 替换为实际的 Node ID
  science: process.env.COMMENT_NODE_ID_SCIENCE!, // 替换为实际的 Node ID
  humanity_webhook: process.env.COMMENT_NODE_ID_HUMANITY_WEBHOOK!, // 替换为实际的 Node ID
  science_webhook: process.env.COMMENT_NODE_ID_SCIENCE_WEBHOOK!, // 替换为实际的 Node ID
};
if (
  COMMENT_NODE_ID.humanity === undefined ||
  COMMENT_NODE_ID.science === undefined ||
  COMMENT_NODE_ID.humanity_webhook === undefined ||
  COMMENT_NODE_ID.science_webhook === undefined
) {
  console.error(
    "❌ 致命错误: 未检测到 COMMENT_NODE_ID_HUMANITY 或 COMMENT_NODE_ID_SCIENCE 环境变量！",
  );
  console.error(
    "❌ 致命错误: 或未检测到 COMMENT_NODE_ID_HUMANITY_WEBHOOK 或 COMMENT_NODE_ID_SCIENCE_WEBHOOK 环境变量！",
  );
  console.error("请检查 workflow 的 env 配置是否正确绑定。");
  process.exit(1); // 异常退出
}

const TYPE = {
  "humanity": "人文讲座",
  "science": "科学前沿讲座",
};

async function get_server_chan_api_keys(
  type: "humanity" | "science",
): Promise<string[]> {
  const TOKEN = process.env.DISCUSSION_READ_TOKEN || process.env.GITHUB_TOKEN!;
  if (TOKEN === undefined) {
    console.error(
      "❌ 致命错误: 未检测到 DISCUSSION_READ_TOKEN 或 GITHUB_TOKEN 环境变量！",
    );
    console.error("请检查 workflow 的 env 配置以及 Secrets 是否正确绑定。");
    process.exit(1); // 异常退出
  }
  const replies = await get_all_replies(COMMENT_NODE_ID[type], TOKEN);
  const apiKeys = processApiKeys(replies);
  return apiKeys;
}

async function get_webhook_keys(
  type: "humanity" | "science",
): Promise<(string | WebhookInfo)[]> {
  const TOKEN = process.env.DISCUSSION_READ_TOKEN || process.env.GITHUB_TOKEN!;
  if (TOKEN === undefined) {
    console.error(
      "❌ 致命错误: 未检测到 DISCUSSION_READ_TOKEN 或 GITHUB_TOKEN 环境变量！",
    );
    console.error("请检查 workflow 的 env 配置以及 Secrets 是否正确绑定。");
    process.exit(1); // 异常退出
  }
  const COMMENT_NODE_ID_KEY = type + "_webhook" as "humanity_webhook" | "science_webhook";
  const replies = await get_all_replies(COMMENT_NODE_ID[COMMENT_NODE_ID_KEY], TOKEN);
  const apiKeys = processAnyApiKeys(replies);
  return apiKeys;
}

interface WebhookInfo {
  key?: string;                             // 与 url 必填其一, 默认使用企业微信消息推送 webhook
  url?: string;                             // 可以向任意 url 发送消息推送
  body?: string | object;                   // 选填, 默认为企业微信 markdown_v2 标注载荷, 如需自行配置, 使用 MARKDOWN 作为文本占位符即可.
  method?: "POST" | string;                 // 选填, 其它请求方法
  headers?: { [key: string]: string };      // 选填, 其它配置
}

async function post_by_api(info: WebhookInfo | string, header: string, markdown: string) {
  if (typeof info === "string") {
    info = { key: info };
  }
  const url = info.url || `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${info.key}`;
  if (!info.url && !info.key) {
    throw new Error("❌ 错误: WebhookInfo 中必须至少提供 key 或 url 之一！");
  }
  const method = info.method || "POST";
  const headers = {
    "Content-Type": "application/json"
  };
  if (info.headers) {
    Object.assign(headers, info.headers);
  }
  const body = info.body || {
    msgtype: "markdown_v2",
    markdown_v2: {
      content: `# **HEADER**\n\nMARKDOWN`,
    }
  };
  const body_str = typeof body === "string" ? body : JSON.stringify(body);
  const message = body_str.replace("HEADER", header).replace("MARKDOWN", markdown);

  // 请求逻辑
  const response = await fetch(url,
    {
      method: method,
      headers: headers,
      body: message,
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`❌ 请求失败: ${response.status} ${response.statusText}, 响应内容: ${errorText}`);
  }
  return await response.text();
}

export async function post_notification(
  lectures: Lecture[],
  length: number,
  type: "humanity" | "science",
) {
  const DAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const header = `${TYPE[type]}讲座更新提醒`;
  const description = [
    `## 新增了 ${length} 个${TYPE[type]}, 列出如下:`,
    `*共 ${new Set(lectures.map((x) => x.lectureTime)).size} 个时间段*`,
    length !== lectures.length
      ? "* 部分讲座可能未列出，请通过课程网站查询准确内容"
      : undefined,
    lectures.map((x) => {
      let weekday = "未知";
      try {
        weekday = "星期" + DAYS[new Date(x.lectureTime.split(" ")[0]).getDay()];
      } catch (error) {
        console.error(`❌ 获取星期几时出错，日期: ${x.lectureTime}, 错误:`, error);
      }
      return [
        `### 讲座: ${x.lectureName}`,
        x.appointmentRequired ? "⚠️ 需要预约" : undefined,
        `时间: ${x.lectureTime} (${weekday})`,
        `组织: ${x.department}-${x.seriesName} / ${x.targetedObjects}`,
      ];
    }),
    "---",
    `*如果你需要取消订阅, 请访问 [订阅网站](${REGISTER_URL}) 并删除你的 API_KEY。*`,
  ].flat(2).filter(Boolean).join("\n\n");
  const brief = `${TYPE[type]}讲座更新(${length}个): ${lectures[0]?.lectureName}`;

  const params = {
    text: header,
    title: header,
    desp: description,
    short: brief,
  };
  const postData = new URLSearchParams(params).toString();


  const API_KEYs = await get_server_chan_api_keys(type);
  if (API_KEYs.length === 0) {
    console.warn(
      `⚠️ 警告: 未找到任何有效的 API_KEY，无法发送通知。请检查环境变量和 Secrets 配置。`,
    );
    return;
  }

  const WEBHOOKs = await get_webhook_keys(type);
  for (const WEBHOOK of WEBHOOKs) {
    try {
      const response = await post_by_api(WEBHOOK, header, description);
      console.log("webhook call response:", response);
      console.log(`✅ 成功发送通知到 WEBHOOK: ${JSON.stringify(WEBHOOK).slice(0, 5)}...`);
    } catch (error) {
      console.error(
        `❌ 发送通知失败，WEBHOOK: ${JSON.stringify(WEBHOOK).slice(0, 5)}, 错误:`,
        error,
      );
    }
  }


  if (process.env['DEBUG'] === 'true') {
    console.log("DEBUG 模式: 将打印通知内容而不发送 API 请求。");
    console.log("以下是将要发送的通知内容:");
    console.log("Header:", header);
    console.log("Description:", description);
    console.log("Brief:", brief);
    return;
  }

  for (const API_KEY of API_KEYs) {
    try {
      const url = `https://sctapi.ftqq.com/${API_KEY}.send`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData).toString(),
        },
        body: postData,
      });
      console.log("Api call response:", await response.json());
      console.log(`✅ 成功发送通知到 API_KEY: ${API_KEY.slice(0, 5)}...`);
    } catch (error) {
      console.error(
        `❌ 发送通知失败，API_KEY: ${API_KEY.slice(0, 5)}, 错误:`,
        error,
      );
    }
    // return; // DEBUG: 只发送一次(我自己)
  }
  return;
}

console.log(await get_webhook_keys("humanity"));
