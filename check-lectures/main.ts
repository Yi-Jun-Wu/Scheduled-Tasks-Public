import { readFile, writeFile } from "node:fs/promises";
import { find_new_lectures, get_lectures_num, type Lecture } from "./extract.ts";
import { login_for_data } from "./login.ts";
import { post_notification } from "./notification.ts";
import { list_lectures, sync_database } from "./sync_database.ts";

const LECTURE_FILE = {
  "humanity": "humanity_lectures.json",
  "science": "science_lectures.json",
};

interface LectureRec {
  data: Lecture[];
  length: number;
}

type TaskResult =
  | { success: true; diff: false; lectures_list: Lecture[]; }
  | { success: true; diff: true; lectures_list: Lecture[]; lectures: Lecture[]; length: number }
  | { success: false; reason: string };
async function task(type: "humanity" | "science", to_sync_database: boolean): Promise<TaskResult> {
  let history: LectureRec;
  try {
    history = JSON.parse((await readFile(LECTURE_FILE[type])).toString());
  } catch (_) {
    history = {
      data: [],
      length: 0,
    };
  }

  let lectures: Lecture[];
  let new_length: number;
  try {
    const html = await login_for_data(type);
    if (!html) {
      return { success: false, reason: "Cannot fetch html" };
    }
    new_length = get_lectures_num(html) ?? history.length;
    if (to_sync_database) {
      lectures = await list_lectures(type);
    } else {
      lectures = await list_lectures(type, 0);
    }
  } catch (e) {
    return { success: false, reason: (e as Error).message };
  }

  const new_lectures = find_new_lectures(history.data, lectures);
  if (!(new_length > 0)) new_length = history.length;
  if (!new_lectures && new_length === history.length) {
    return { success: true, diff: false, lectures_list: lectures };
  }
  const added_length = new_length - history.length;
  history.length = new_length;
  writeFile(LECTURE_FILE[type], JSON.stringify(history, null, 2));
  return {
    success: true,
    diff: true,
    lectures_list: lectures,
    lectures: new_lectures ?? [],
    length: added_length,
  };
}

async function main(type: "humanity" | "science" = "humanity", to_sync_database: boolean) {
  console.log(`\n=== 开始拉取网页: ${type} ===`);
  const result = await task(type, to_sync_database);
  if (!result.success) {
    console.error("[Run Failed]", result.reason);
    return;
  }
  if (!result.diff) {
    console.log("[No More Lectures]", type);
  } else {
    try {
      await post_notification(result.lectures, result.length, type);
    } catch (e) {
      console.error("Failed to post notification:", (e as Error).message);
    }
  }
  if (to_sync_database) {
    try {
      await sync_database(type, result.lectures_list);
      console.log("\n🎉 讲座数据同步流程执行完毕！");
    } catch (err) {
      console.error("执行过程中发生错误:", err);
      process.exit(1);
    }
  }
  return;
}

if (import.meta.main) {
  const to_sync_database = process.argv[2]?.trim().toLowerCase() === "true";
  if (to_sync_database) {
    console.log("同步数据库模式：将从网页获取的最新讲座信息覆盖本地数据库（JSON 文件）。");
  }
  await main("humanity", to_sync_database);
  await main("science", to_sync_database);
}
