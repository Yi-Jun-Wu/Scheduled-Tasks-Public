const LEC_URL = (id: number, type: "humanity" | "science") =>
  `/subject/${id}/${type === "humanity" ? "humanityView" : "view"}`;

import { readdir, readFile, writeFile } from "fs/promises";
import { generateLetterID, type MergedLecture } from "./sync_database.ts";
import { fetch_url } from "./login.ts";
import { parse_lecture_detail } from "./extract.ts";

async function get_missing_ids(
  type: "humanity" | "science",
): Promise<number[]> {
  const folder = `./lectures/${type}/archive/`;
  const files = await readdir(folder, { encoding: "utf-8" });
  const ret = new Set<number>();
  for (const file of files) {
    const content: MergedLecture[] = JSON.parse(
      (await readFile(folder + file, { encoding: "utf-8" })).toString(),
    );
    const ids = content.map((x) => x.sourceUrl.match(/\/subject\/(\d+)\//)?.[1])
      .filter((x): x is string => !!x).map((x) => parseInt(x));
    ids.forEach((id) => ret.add(id));
  }
  const max_id = Math.max(...ret);
  const missing_ids = [];
  for (let i = 1; i <= max_id; i++) {
    if (!ret.has(i)) {
      missing_ids.push(i);
    }
  }
  return missing_ids;
}

async function read_lecture(url: string): Promise<MergedLecture> {
  const html = await fetch_url(url);

  const lecture = parse_lecture_detail(html)!;
  // console.log("Parsed lecture", lecture);
  const ret: MergedLecture = {
    id: generateLetterID(url, 0),
    seriesName: "",
    title: lecture.lectureName,
    creditHours: lecture.creditHours,
    department: lecture.department,
    targetAudience: lecture.targetedObjects,
    speaker: "",
    isAppointmentRequired: false,
    sourceUrl: url,
    startTimestamp: lecture.startingTime?.trim().length > 0 ? new Date(lecture.startingTime).getTime() : 0,
    endTimestamp: lecture.timeOfEnding?.trim().length > 0 ? new Date(lecture.timeOfEnding).getTime() : 0,
    rawTimeStr: `${lecture.startingTime} ${lecture.timeOfEnding}`,
    mainVenue: lecture.mainVenue,
    parallelVenue: lecture.venueOfParallelSessions,
    introduction: lecture.lectureIntroduction,
    lastUpdatedAt: new Date().toISOString(),
  };
  return ret;
}

async function main(type: "humanity" | "science") {
  const missing_ids = await get_missing_ids(type);
  console.log(
    `Missing ${missing_ids.length} lectures: ${missing_ids.slice(0, 10).join(", ")
    }${missing_ids.length > 10 ? `... (${missing_ids.length - 10} more)` : ""}`,
  );
  const urls = missing_ids.map((id) => LEC_URL(id, type));
  await writeFile(`./dist/${type}_missing_urls.txt`, urls.join("\n"), {
    encoding: "utf-8",
  });

  const stat: Record<number, boolean> = {};
  const results: MergedLecture[] = [];

  for (const id of missing_ids.slice(-10)) {
    try {
      const lecture = await read_lecture(LEC_URL(id, type));
      results.push(lecture);
    } catch (e) {
      console.error(`Failed to read lecture at ${id}:`, (e as Error).message);
      stat[id] = false;
      continue;
    }
    stat[id] = true;
  }
  console.log("Read lectures:", stat);
  await writeFile(`./dist/${type}_missing_lectures.json`, JSON.stringify(results, null, 2), {
    encoding: "utf-8",
  });
  await writeFile(`./dist/${type}_stat.txt`, JSON.stringify(stat, null, 2), {
    encoding: "utf-8",
  });
}

if (import.meta.main) {
  await main("humanity");
  await main("science");
}
