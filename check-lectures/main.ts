import { readFile, writeFile } from "node:fs/promises";
import { find_new_lectures, parse_lectures, type Lecture } from "./extract.ts";
import { login_for_data } from "./login.ts";
import { post_notification } from "./notification.ts";

const LECTURE_FILE = {
  "humanity": "humanity_lectures.json",
  "science": "science_lectures.json",
}

interface LectureRec {
  data: Lecture[],
  length: number;
}

type TaskResult =
  | { success: true; diff: false }
  | { success: true; diff: true; lectures: Lecture[], length: number }
  | { success: false; reason: string };
async function task(type: "humanity" | "science"): Promise<TaskResult> {
  let history: LectureRec;
  try {
    history = JSON.parse((await readFile(LECTURE_FILE[type])).toString())
  } catch (_) {
    history = {
      data: [],
      length: 0,
    }
  }

  let lectures: Lecture[];
  let new_length: number;
  try {
    const html = await login_for_data(type);
    if (!html) {
      return { success: false, reason: "Cannot fetch html" }
    }
    const res = parse_lectures(html);
    if (!res.success) {
      return res;
    }
    lectures = res.data;
    new_length = res.length;
  } catch (e) {
    return { success: false, reason: (e as Error).message };
  }

  const new_lectures = find_new_lectures(history.data, lectures);
  if (!(new_length > 0)) new_length = history.length;
  if (!new_lectures && new_length === history.length) {
    return { success: true, diff: false };
  }
  const added_length = new_length - history.length;
  history.length = new_length;
  writeFile(LECTURE_FILE[type], JSON.stringify(history, null, 2));
  return { success: true, diff: true, lectures: new_lectures ?? [], length: added_length };
}


async function main(type: "humanity" | "science" = "humanity") {
  const result = await task(type);
  if (!result.success) {
    console.error("[Run Failed]", result.reason);
    return;
  }
  if (!result.diff) {
    console.log("[No More Lectures]", type);
    return;
  }
  await post_notification(result.lectures, result.length, type);
  return;
}

await main("humanity");
await main("science");