import { DomParser } from "@thednp/domparser";

export interface Lecture {
  department: string;
  topic: string;
  name: string;
  date: string;
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

export interface DetailLecture {
  mainVenue: string;
  venueOfParallelSessions: string;
  startingTime: string; // "2026/03/25 20:30:00"
  timeOfEnding: string;
  lectureIntroduction: string;
}

type FetchLectures =
  | { success: true; data: Lecture[]; length: number }
  | { success: false; fatal: boolean; reason: string };
export function parse_lectures(html: string): FetchLectures {
  // DEBUG
  // await writeFile("dist/res.html", html);

  // initialize parser
  const parser = DomParser();

  // parse the source
  const doc = parser.parseFromString(html).root;

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
    };
  });

  // DEBUG
  // await writeFile("dist/table.json", JSON.stringify(content, null, 2));
  return { success: true, data: content, length: statistic };
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
