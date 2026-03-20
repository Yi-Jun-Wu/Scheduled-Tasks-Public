// ⚠️ 生产环境中请保存入 Secrets, 不得使用明文

import { processApiKeys } from "./decrypt_server_chan_api.ts";
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

const COMMENT_NODE_ID = {
  humanity: process.env.COMMENT_NODE_ID_HUMANITY!, // 替换为实际的 Node ID
  science: process.env.COMMENT_NODE_ID_SCIENCE!, // 替换为实际的 Node ID
};
if (COMMENT_NODE_ID.humanity === undefined || COMMENT_NODE_ID.science === undefined) {
  console.error("❌ 致命错误: 未检测到 COMMENT_NODE_ID_HUMANITY 或 COMMENT_NODE_ID_SCIENCE 环境变量！");
  console.error("请检查 workflow 的 env 配置是否正确绑定。");
  process.exit(1); // 异常退出
}

const TYPE = {
  "humanity": "人文讲座",
  "science": "科学前沿讲座",
};

async function get_all_api_keys(type: "humanity" | "science"): Promise<string[]> {
  const TOKEN  = process.env.DISCUSSION_READ_TOKEN || process.env.GITHUB_TOKEN!;
  if(TOKEN === undefined) {
    console.error("❌ 致命错误: 未检测到 DISCUSSION_READ_TOKEN 或 GITHUB_TOKEN 环境变量！");
    console.error("请检查 workflow 的 env 配置以及 Secrets 是否正确绑定。");
    process.exit(1); // 异常退出
  }
  const replies = await get_all_replies(COMMENT_NODE_ID[type], TOKEN);
  const apiKeys = processApiKeys(replies);
  return apiKeys;
}

export async function post_notification(
  lectures: Lecture[],
  length: number,
  type: "humanity" | "science",
) {
  const header = `${TYPE[type]}讲座更新提醒`;
  const description = [
    `## 新增了 ${length} 个${TYPE[type]}, 列出如下:`,
    `*共 ${new Set(lectures.map((x) => x.date)).size} 个时间段*`,
    lectures.map((x) => [
      `### 讲座: ${x.name}`,
      `时间: ${x.date}${x.need_appointment ? " (⚠️ 需要预约 ⚠️)" : ""}`,
      `组织: ${x.department}-${x.topic}`,
    ]),
  ].flat(2).filter(Boolean).join("\n\n");
  const brief = `${TYPE[type]}讲座更新(${length}个): ${lectures[0]?.name}`;

  const params = {
    text: header,
    title: header,
    desp: description,
    short: brief,
  };
  const postData = new URLSearchParams(params).toString();

  const API_KEYs = await get_all_api_keys(type);
  if (API_KEYs.length === 0) {
    console.warn(`⚠️ 警告: 未找到任何有效的 API_KEY，无法发送通知。请检查环境变量和 Secrets 配置。`);
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
      console.error(`❌ 发送通知失败，API_KEY: ${API_KEY.slice(0, 5)}, 错误:`, error);
    }
  }
  // DEBUG
  // await writeFile("dist/response.log", inspect({ response, Body: data }, { maxArrayLength: Infinity, maxStringLength: Infinity }));
  return;
}


console.log(await get_all_api_keys("humanity"));