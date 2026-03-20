import { DomParser } from "@thednp/domparser";
// import { readFile } from "node:fs/promises";

export interface Lecture {
  department: string;
  topic: string;
  name: string;
  date: string;
  need_appointment: boolean;
}

export interface ListLecture {
  seriesName: string;
  lectureName: string;
  creditHours: string;
  department: string;
  targetedObjects: string;
  lectureTime: string; // "2026-03-25 18:30-20:30"
  lecturer: string;
  appointmentRequired: boolean;
  detailUrl: string;
}
export const LIST_LECTURE: ListLecture = {
  seriesName: "",
  lectureName: "",
  creditHours: "",
  department: "",
  targetedObjects: "",
  lectureTime: "",
  lecturer: "",
  appointmentRequired: false,
  detailUrl: "",
};

export interface DetailLecture {
  lectureName: string;
  creditHours: string;
  department: string;
  targetedObjects: string;
  mainVenue: string;
  venueOfParallelSessions: string;
  startingTime: string; // "2026/03/25 20:30:00"
  timeOfEnding: string;
  lectureIntroduction: string;
}
export const DETAILED_LECTURE: DetailLecture = {
  lectureName: "",
  creditHours: "",
  department: "",
  targetedObjects: "",
  mainVenue: "",
  venueOfParallelSessions: "",
  startingTime: "",
  timeOfEnding: "",
  lectureIntroduction: "",
};

type FetchLectures =
  | { success: true; data: Lecture[]; length: number }
  | { success: false; fatal: boolean; reason: string };
export function parse_lectures(html: string): FetchLectures {
  // DEBUG
  // await writeFile("dist/res.html", html);

  // initialize parser
  const parser = DomParser();

  // parse the source
  const doc = parser.parseFromString(fix_html(html)).root;

  const info = doc.querySelector("bn-info")?.textContent ?? "";
  let statistic = parseInt(info?.trim().slice(1));
  if (isNaN(statistic) || !(statistic > 0)) {
    statistic = parseInt(html.match(/共(\d+)项/)?.[1] ?? "0");
  }

  const table = doc.querySelector("table")?.querySelector("tbody")
    ?.querySelectorAll("tr");
  if (table === undefined) {
    return { success: false, reason: "Document Type Error!", fatal: true }; // Fatal Error!
  }
  const content = table.map((tr) => {
    const cells = tr.children.map((x) =>
      x.textContent.replace(/(\s|&nbsp;)+/g, " ").trim()
    );
    return {
      department: cells[6],
      topic: cells[0],
      name: cells[1],
      date: cells[3],
      need_appointment: is_appointment_required(cells[7]),
    };
  });

  // DEBUG
  // await writeFile("dist/table.json", JSON.stringify(content, null, 2));
  return { success: true, data: content, length: statistic };
}

const appointment = [
  "报名",
  "预约已经结束",
  "预约已结束",
  "已经预约过",
  "已预约过",
];

const no_appointment = [
  "无需预约",
  "此讲座无需报名",
];

function is_appointment_required(info: string): boolean {
  return appointment.some((x) => info.includes(x)) &&
    !no_appointment.some((x) => info.includes(x));
}

/** Extract the lecture list from the HTML of the lecture series page
 * @returns null if the HTML structure is unexpected, otherwise a list of lectures (possibly empty)
 */
export function parse_list_lectures(html: string): ListLecture[] | null {
  const parser = DomParser();
  const doc = parser.parseFromString(fix_html(html)).root;
  const table = doc
    .querySelector("table")
    ?.querySelector("tbody")
    ?.querySelectorAll("tr");
  if (table === undefined) {
    return null;
  }
  return table.map((tr) => {
    const cells = tr.children.map((x) =>
      x.textContent.replace(/(\s|&nbsp;)+/g, " ").trim()
    );
    const url = tr.querySelectorAll("a")
      .filter((x) => x.textContent.trim() === "查看详情")[0]
      ?.attributes.get("href") ??
      tr.querySelectorAll("a")
        .map((x) => x.attributes.get("href"))
        .filter((x) => x !== undefined)[0];

    // console.log(cells[7]);
    const ret: ListLecture = {
      seriesName: cells[0] ?? "",
      lectureName: cells[1] ?? "",
      creditHours: cells[2] ?? "",
      lectureTime: cells[3] ?? "",
      targetedObjects: cells[4] ?? "",
      lecturer: cells[5] ?? "",
      department: cells[6] ?? "",
      appointmentRequired: is_appointment_required(cells[7] ?? ""),
      detailUrl: url ?? "",
    };
    return ret;
  });
}

function fix_html(html: string): string {
  // Fix broken HTML (replace `<中文字符>` with `&lt;中文字符&gt;`)
  return html.replace(/<([^<>]{0,20}[\u4e00-\u9fa5]+[^<>]{0,20})>/gu, "＜$1＞");
}

export function parse_lecture_detail(html: string): DetailLecture | null {
  if (!html.includes("查看讲座详情")) return null;
  const parser = DomParser();
  const doc = parser.parseFromString(fix_html(html)).root;
  const table = doc.querySelector("table")?.querySelectorAll("td");
  if (!table) return null;
  const ret: DetailLecture = {
    lectureName: "",
    creditHours: "",
    department: "",
    targetedObjects: "",
    mainVenue: "",
    venueOfParallelSessions: "",
    startingTime: "",
    timeOfEnding: "",
    lectureIntroduction: "",
  };
  table.forEach((t) => {
    const [k, v] = t.textContent.trim().split("：");
    switch (k) {
      case "讲座名称":
        return ret.lectureName = v;
      case "学时":
        return ret.creditHours = v;
      case "部门":
        return ret.department = v;
      case "面向对象":
        return ret.targetedObjects = v;
      case "开始时间":
        return ret.startingTime = v;
      case "结束时间":
        return ret.timeOfEnding = v;
      case "主会场地点":
        return ret.mainVenue = v;
      case "分会场地点":
        return ret.venueOfParallelSessions = v;
      case "讲座介绍":
        return;
      default:
        ret.lectureIntroduction += t.textContent.trim() + "\n";
    }
  });
  ret.lectureIntroduction = ret.lectureIntroduction.trim();
  return ret;
}

/** If any lectures are added
 * - return lecture list is there is any, and append to history
 * - return null is there is not, and do nothing to history
 */
export function find_new_lectures(
  history: Lecture[],
  lectures: Lecture[],
): null | Lecture[] {
  const old = new Set(
    history.map((l) => `${l.department}-${l.topic}-${l.name}`),
  );
  const new_lec = lectures.filter((l) =>
    !old.has(`${l.department}-${l.topic}-${l.name}`)
  );
  if (new_lec.length === 0) {
    return null;
  }
  console.log("New lectures found:", new_lec);
  history.splice(0, 0, ...new_lec);
  return new_lec;
}

// console.log(parse_list_lectures((await readFile("./dist/humanityLecture.html")).toString()))
// console.log(parse_lecture_detail((await readFile("./dist/humanityView.html")).toString()))
