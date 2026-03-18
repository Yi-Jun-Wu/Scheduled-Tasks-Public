import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fetch_url } from "./login.ts";
import { type DetailLecture, type ListLecture } from "./extract.ts";

interface MergedLecture extends ListLecture, DetailLecture {
  id: string; // 纯字母的唯一标识符
  startTimestamp: number;
  endTimestamp: number;
  lastUpdatedAt: string;
}

// ================= 模拟网络请求函数 =================
// 实际使用时替换为你自己的爬虫逻辑
async function list_lectures(
  category: "humanity" | "science",
): Promise<ListLecture[]> {
  return [];
}
async function lecture_detail(url: string): Promise<DetailLecture> {
  const content = fetch_url(url);
  return {
    mainVenue: "",
    venueOfParallelSessions: "",
    startingTime: "",
    timeOfEnding: "",
    lectureIntroduction: "",
  };
}

// ================= 核心工具函数 =================

/**
 * 解析非标准时间字符串，转换为标准 Unix 时间戳 (毫秒)
 */
function parseLectureTime(timeStr: string): { start: number; end: number } {
  // 示例: "2026-03-25 18:30-20:30"
  const [datePart, timeRange] = timeStr.split(" ");
  const [startStr, endStr] = timeRange.split("-");

  const startTimestamp = new Date(`${datePart}T${startStr}:00+08:00`).getTime();
  const endTimestamp = new Date(`${datePart}T${endStr}:00+08:00`).getTime();

  return { start: startTimestamp, end: endTimestamp };
}

/**
 * 生成纯字母的特征码 (Letter-Only FourCC/ID)
 * 规则：基于 URL 和 重复索引 生成稳定的 Hash，并将 0-9 映射到 A-J，a-f 映射到 K-P
 */
function generateLetterID(url: string, duplicateIndex: number): string {
  const rawHash = createHash("md5").update(`${url}_${duplicateIndex}`).digest(
    "hex",
  );
  let letterOnlyID = "";

  // 取前 8 位即可保证极低碰撞率
  for (let i = 0; i < 8; i++) {
    const charCode = rawHash.charCodeAt(i);
    // 如果是数字 0-9 (48-57) -> 映射到 A-J (65-74)
    if (charCode >= 48 && charCode <= 57) {
      letterOnlyID += String.fromCharCode(charCode + 17);
    } // 如果是字母 a-f (97-102) -> 映射到 K-P (75-80)
    else {
      letterOnlyID += String.fromCharCode(charCode - 22);
    }
  }
  return letterOnlyID;
}

// ================= 数据处理主逻辑 =================

const BASE_DIR = resolve("./lectures");

async function ensureDir(dirPath: string) {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

async function syncCategory(category: "humanity" | "science") {
  console.log(`\n=== 开始同步分类: ${category} ===`);
  const archiveDir = join(BASE_DIR, category, "archive");
  await ensureDir(archiveDir);

  // 1. 获取最新列表
  const rawList = await list_lectures(category);
  if (rawList.length === 0) {
    console.log("未抓取到任何数据。");
    return;
  }

  // 用于追踪同一次抓取中的重复 URL，以生成不同的纯字母 ID
  const urlOccurrenceCount: Record<string, number> = {};

  // 按月份将抓取到的数据分组 (例如 "2026-03")
  const groupedNewLectures: Record<string, MergedLecture[]> = {};

  // 2. 遍历并解析抓取到的讲座
  for (const item of rawList) {
    // 处理重复项分配：如果遇到相同 URL，索引递增
    const duplicateIndex = urlOccurrenceCount[item.detailUrl] || 0;
    urlOccurrenceCount[item.detailUrl] = duplicateIndex + 1;

    const letterID = generateLetterID(item.detailUrl, duplicateIndex);
    const { start, end } = parseLectureTime(item.lectureTime);

    // 使用开始时间来决定它属于哪个月份的归档文件
    const dateObj = new Date(start);
    const monthKey = `${dateObj.getFullYear()}-${
      String(dateObj.getMonth() + 1).padStart(2, "0")
    }`; // "2026-03"

    if (!groupedNewLectures[monthKey]) {
      groupedNewLectures[monthKey] = [];
    }

    groupedNewLectures[monthKey].push({
      ...item,
      id: letterID,
      startTimestamp: start,
      endTimestamp: end,
      lastUpdatedAt: new Date().toISOString(),
      // 下面这些详情数据先占位，发现是新数据时再请求
      mainVenue: "",
      venueOfParallelSessions: "",
      startingTime: "",
      timeOfEnding: "",
      lectureIntroduction: "",
    });
  }

  // 3. 读取本地归档并进行 Diff 更新
  let hasAnyUpdate = false;
  const allRecentLectures: MergedLecture[] = []; // 用于后续生成 latest.json
  const SEVEN_DAYS_AGO = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const [monthKey, newLectures] of Object.entries(groupedNewLectures)) {
    const archivePath = join(archiveDir, `${monthKey}.json`);
    let localArchive: MergedLecture[] = [];

    try {
      const rawData = (await readFile(archivePath)).toString();
      localArchive = JSON.parse(rawData);
    } catch (e) {
      console.log(`创建全新的月份归档: ${monthKey}.json`);
    }

    let isMonthUpdated = false;

    // 对比新数据和本地数据
    for (const newLec of newLectures) {
      const existingIndex = localArchive.findIndex((l) => l.id === newLec.id);

      if (existingIndex === -1) {
        // 这是一个全新的讲座（或者是全新的重复项）！请求详情页
        console.log(
          `[新增] 发现新讲座 (ID: ${newLec.id}): ${newLec.lectureName}`,
        );
        const detail = await lecture_detail(newLec.detailUrl);

        const finalLecture = { ...newLec, ...detail };
        localArchive.push(finalLecture);
        isMonthUpdated = true;
        hasAnyUpdate = true;

        // 为了避免被风控，请求详情后休眠 1 秒
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        // 如果存在，可以选择性地检查状态是否改变 (比如讲座题目修改了)
        // 这里为了简单，假设只要 ID 存在就不覆盖详情，如果需要可以加入 Diff 逻辑
      }
    }

    // 保存更新后的本月归档
    if (isMonthUpdated) {
      await writeFile(
        archivePath,
        JSON.stringify(localArchive, null, 2),
        "utf-8",
      );
    }

    // 收集热数据：只要讲座时间在 7 天前到现在、或未来，就加入
    const recentInThisMonth = localArchive.filter((l) =>
      l.startTimestamp >= SEVEN_DAYS_AGO
    );
    allRecentLectures.push(...recentInThisMonth);
  }

  // 4. 生成给网页用的热数据 (latest.json)
  if (hasAnyUpdate) {
    // 按时间排序，方便前端渲染日历
    allRecentLectures.sort((a, b) => a.startTimestamp - b.startTimestamp);

    const latestPath = join(BASE_DIR, category, "latest.json");
    await writeFile(
      latestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          total: allRecentLectures.length,
          lectures: allRecentLectures,
        },
        null,
        2,
      ),
    );

    console.log(
      `✅ ${category} 数据更新完毕，已生成最新的 latest.json，包含 ${allRecentLectures.length} 条近期记录。`,
    );
  } else {
    console.log(`无新数据，${category} 归档保持不变。`);
  }
}

// ================= 执行入口 =================
async function main() {
  try {
    await syncCategory("humanity");
    await syncCategory("science");
    console.log("\n🎉 所有讲座数据同步流程执行完毕！");
  } catch (err) {
    console.error("执行过程中发生错误:", err);
    process.exit(1);
  }
}

main();
