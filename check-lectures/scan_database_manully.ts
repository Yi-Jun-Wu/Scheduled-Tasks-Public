const LEC_URL = (id: number, type: "humanity" | "science") =>
  `/subject/${id}/${type === "humanity" ? "humanityView" : "view"}`;

import { readdir, readFile, writeFile } from "fs/promises";
import { generateLetterID, type MergedLecture } from "./sync_database.ts";
import { fetch_url } from "./login.ts";
import { parse_lecture_detail } from "./extract.ts";
import { stdout } from "process";

async function get_missing_ids(
  type: "humanity" | "science",
  stat: Record<number, boolean>
): Promise<number[]> {
  const folder = `./lectures/${type}/archive/`;
  const files = await readdir(folder, { encoding: "utf-8" });
  const ret = new Set<number>(Object.keys(stat).map((x) => parseInt(x)));
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
  const stat: Record<number, boolean> = JSON.parse(
    (await readFile(`./dist/${type}_stat.json`, { encoding: "utf-8" })).toString()
  );
  const results: MergedLecture[] = JSON.parse(
    (await readFile(`./dist/${type}_missing_lectures.json`, { encoding: "utf-8" })).toString()
  );

  let missing_ids = await get_missing_ids(type, stat);
  console.log(
    `Missing ${missing_ids.length} lectures: ${missing_ids.slice(0, 10).join(", ")
    }${missing_ids.length > 10 ? `... (${missing_ids.length - 10} more)` : ""}`,
  );
  const urls = missing_ids.map((id) => LEC_URL(id, type));
  await writeFile(`./dist/${type}_missing_urls.txt`, urls.join("\n"), {
    encoding: "utf-8",
  });


  // missing_ids = Object.entries(stat).map((c, i, arr) => c[1] == false && arr[i + 1]?.[1] == false ? (parseInt(c[0]) + parseInt(arr[i + 1][0])) >> 1 : null).filter((x): x is number => !!x && missing_ids.includes(x));
  const RANDOM_SAMPLE = 100;
  missing_ids = missing_ids.sort(() => Math.random() - 0.5).slice(0, RANDOM_SAMPLE);
  let startTime = performance.now();
  let i = 0;
  const MAX_READ = 500; // Limit the number of lectures to read in one run

  for (const id of missing_ids.slice(-MAX_READ)) {
    // for (const id of Array.from({length: 120}, (_, i)=> i * 50 + 25)) {
    const total = Math.min(missing_ids.length, MAX_READ);
    const prog = Math.round(i / total * 10000) / 100;
    const elapsed = (performance.now() - startTime) / 1000;
    const eta = elapsed / (i || 1) * (total - i);
    stdout.write(`\rProgress: ${prog}%. Reading ${type} lecture ${id}...... ETA: ${eta.toFixed(1)}s\r`);
    if ((i++) % 10 === 0) {
      // back up files every 10 lectures
      await writeFile(`./dist/${type}_missing_lectures.json`, JSON.stringify(results, null, 2), {
        encoding: "utf-8",
      });
      await writeFile(`./dist/${type}_stat.json`, JSON.stringify(stat, null, 2), {
        encoding: "utf-8",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  console.log("\nRead lectures:", "Success:", Object.values(stat).filter((x) => x).length, "Failed:", Object.values(stat).filter((x) => !x).length);
  await writeFile(`./dist/${type}_missing_lectures.json`, JSON.stringify(results, null, 2), {
    encoding: "utf-8",
  });
  await writeFile(`./dist/${type}_stat.json`, JSON.stringify(stat, null, 2), {
    encoding: "utf-8",
  });
}

if (import.meta.main) {
  await main("humanity");
  await main("science");
}
