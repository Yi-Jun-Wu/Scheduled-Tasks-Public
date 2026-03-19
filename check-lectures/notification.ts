// ⚠️ 生产环境中请保存入 Secrets, 不得使用明文

import type { Lecture } from "./extract.ts";

// 从环境变量读取账号密码
const API_KEY = process.env.API_KEY!;
if (API_KEY === undefined) {
  console.error("❌ 致命错误: 未检测到 API_KEY 环境变量！");
  console.error(
    "如果你在 GitHub Actions 运行，请检查 workflow 的 env 配置以及 Secrets 是否正确绑定。",
  );
  process.exit(1); // 异常退出
}

const TYPE = {
  "humanity": "人文讲座",
  "science": "科学前沿讲座",
};

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
      `时间: ${x.date}`,
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
  const url = `https://sctapi.ftqq.com/${API_KEY}.send`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(postData).toString(),
    },
    body: postData,
  });

  const data = await response.json();
  console.log("Api call response:", data);
  // DEBUG
  // await writeFile("dist/response.log", inspect({ response, Body: data }, { maxArrayLength: Infinity, maxStringLength: Infinity }));
  return;
}
