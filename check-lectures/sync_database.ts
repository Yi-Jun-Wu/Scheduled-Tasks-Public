import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fetch_lecture_list, fetch_url, login_for_data } from "./login.ts";
import { DETAILED_LECTURE, parse_lecture_detail, parse_list_lectures, type DetailLecture, type ListLecture } from "./extract.ts";

// 彻底独立、字段规范化、前端友好的最终存储结构
export interface MergedLecture {
  id: string;                 // 纯字母特征码 (例如: AJFNKQLB)
  seriesName: string;         // 讲座系列
  title: string;              // 讲座名称 (映射自 lectureName)
  creditHours: string;        // 学时
  department: string;         // 主办部门
  targetAudience: string;     // 面向对象 (映射自 targetedObjects)
  speaker: string;            // 主讲人 (映射自 lecturer)
  isAppointmentRequired: boolean; // 是否需要预约
  sourceUrl: string;          // 详情页地址 (映射自 detailUrl)

  // 统一处理后的绝对时间 (解决原始数据格式混乱问题)
  startTimestamp: number;     // 毫秒时间戳
  endTimestamp: number;       // 毫秒时间戳
  rawTimeStr: string;         // 保留原始时间字符串备用

  // 详情信息 (初始可能为空)
  mainVenue: string;          // 主会场
  parallelVenue: string;      // 分会场 (映射自 venueOfParallelSessions)
  introduction: string;       // 讲座简介

  // 元数据
  lastUpdatedAt: string;      // ISO 时间戳
}

// ================= 模拟网络请求函数 =================
// 实际使用时替换为你自己的爬虫逻辑
async function list_lectures(
  category: "humanity" | "science",
): Promise<ListLecture[]> {
  const ret: ListLecture[] = [];
  const MAX_PAGES = 1; // 根据实际情况调整分页数量
  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`正在抓取 ${category} 分类，第 ${page} 页...`);
    const lecture_list = await fetch_lecture_list(category, page === 1 ? undefined : page);
    if (!lecture_list) {
      console.log(`⚠️ 第 ${page} 页数据抓取失败或无数据，停止继续抓取后续页面。共抓取到 ${ret.length} 条数据。`);
      return ret;
    }
    const parsedLectures = parse_list_lectures(lecture_list);
    if (!parsedLectures || !(parsedLectures.length > 0)) {
      console.log(`第 ${page} 页数据解析失败或无有效数据，停止继续抓取后续页面。共抓取到 ${ret.length} 条数据。`);
      return ret;
    }
    const oldestTime = parsedLectures.reduce((oldest, lec) => {
      const timeStr = lec.lectureTime || '';
      const { start } = parseLectureTimeSafe(timeStr);
      return start > 0 && (oldest === 0 || start < oldest) ? start : oldest;
    }, 0);
    ret.push(...parsedLectures);
    console.log(`抓取到 ${parsedLectures.length} 条数据, 最早的讲座时间: ${oldestTime > 0 ? new Date(oldestTime).toLocaleString() : '未知'}`);
    if (oldestTime < Date.now() - 20 * 24 * 60 * 60 * 1000) {
      console.log(`检测到数据时间较旧，停止继续抓取后续页面。共抓取到 ${ret.length} 条数据。`);
      return ret;
    }
  }
  console.log(`达到分页上限，停止抓取。共抓取到 ${ret.length} 条数据。`);
  return ret;
}
async function lecture_detail(url: string): Promise<DetailLecture> {
  const content = await fetch_url(url);
  // success guard
  if (!content || !content.includes("查看讲座详情")) {
    // retry once after 2 second
    console.warn(`首次请求详情页失败，2秒后重试 URL: ${url}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const retryContent = await fetch_url(url);
    if (!retryContent || !retryContent.includes("查看讲座详情")) {
      console.error(`重试后仍然无法获取有效内容，返回默认详情 URL: ${url}`);
      return { ...DETAILED_LECTURE, lectureIntroduction: `详情页访问失败，URL: ${url}` };
    }
    return parse_lecture_detail(retryContent) ?? DETAILED_LECTURE;
  }
  return parse_lecture_detail(content) ?? DETAILED_LECTURE;
}

// ================= 核心工具函数 =================

/**
 * 极度健壮的时间解析器，处理空字符串、脏格式
 */
function parseLectureTimeSafe(timeStr: string): { start: number; end: number } {
  const fallback = { start: 0, end: 0 };
  if (!timeStr || timeStr.trim() === '') return fallback;

  try {
    const parts = timeStr.trim().split(' ');
    if (parts.length < 2) return fallback;

    const datePart = parts[0];
    const timeRange = parts[1];
    const [startStr, endStr] = timeRange.split('-');

    if (!startStr || !endStr) return fallback;

    const startTimestamp = new Date(`${datePart}T${startStr}:00+08:00`).getTime();
    const endTimestamp = new Date(`${datePart}T${endStr}:00+08:00`).getTime();

    return {
      start: isNaN(startTimestamp) ? 0 : startTimestamp,
      end: isNaN(endTimestamp) ? 0 : endTimestamp
    };
  } catch (e) {
    return fallback;
  }
}
/**
 * 生成纯字母的特征码 (Letter-Only FourCC/ID)
 */
function generateLetterID(url: string, duplicateIndex: number): string {
  const safeUrl = url || 'empty_url'; // 防止 url 为空
  const rawHash = createHash('md5').update(`${safeUrl}_${duplicateIndex}`).digest('hex');
  let letterOnlyID = '';

  for (let i = 0; i < 8; i++) {
    const charCode = rawHash.charCodeAt(i);
    if (charCode >= 48 && charCode <= 57) {
      letterOnlyID += String.fromCharCode(charCode + 17); // 0-9 映射到 A-J
    } else {
      letterOnlyID += String.fromCharCode(charCode - 22); // a-f 映射到 K-P
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

async function syncCategory(category: 'humanity' | 'science') {
  console.log(`\n=== 开始同步分类: ${category} ===`);
  const archiveDir = join(BASE_DIR, category, 'archive');
  await ensureDir(archiveDir);

  const rawList = await list_lectures(category);
  if (!rawList || rawList.length === 0) {
    console.log("未抓取到任何数据。");
    return;
  }

  const urlOccurrenceCount: Record<string, number> = {};
  const groupedNewLectures: Record<string, MergedLecture[]> = {};

  // 1. 数据映射与分组 (Data Mapping & Grouping)
  for (const item of rawList) {
    const safeUrl = item.detailUrl || '';
    const duplicateIndex = urlOccurrenceCount[safeUrl] || 0;
    urlOccurrenceCount[safeUrl] = duplicateIndex + 1;

    const letterID = generateLetterID(safeUrl, duplicateIndex);
    const { start, end } = parseLectureTimeSafe(item.lectureTime);

    // 如果时间解析失败(start === 0)，放入 unknown.json 以免干扰正常日历
    let monthKey = "unknown";
    if (start > 0) {
      const dateObj = new Date(start);
      monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    }

    if (!groupedNewLectures[monthKey]) {
      groupedNewLectures[monthKey] = [];
    }

    // 规范化字段映射，使用 || '' 彻底杜绝 undefined 漏网之鱼
    groupedNewLectures[monthKey].push({
      id: letterID,
      seriesName: item.seriesName || '',
      title: item.lectureName || '',
      creditHours: item.creditHours || '',
      department: item.department || '',
      targetAudience: item.targetedObjects || '',
      speaker: item.lecturer || '',
      isAppointmentRequired: !!item.appointmentRequired,
      sourceUrl: safeUrl,
      startTimestamp: start,
      endTimestamp: end,
      rawTimeStr: item.lectureTime || '',
      // 详情字段初始化为空
      mainVenue: '',
      parallelVenue: '',
      introduction: '',
      lastUpdatedAt: new Date().toISOString()
    });
  }

  // 2. 差异比对与详情抓取 (Diff & Fetch Details)
  let hasAnyUpdate = false;
  const allRecentLectures: MergedLecture[] = [];
  const SEVEN_DAYS_AGO = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_AFTER = Date.now() + 14 * 24 * 60 * 60 * 1000;

  for (const [monthKey, newLectures] of Object.entries(groupedNewLectures)) {
    const archivePath = join(archiveDir, `${monthKey}.json`);
    let localArchive: MergedLecture[] = [];

    try {
      const rawData = await readFile(archivePath, 'utf-8');
      localArchive = JSON.parse(rawData);
    } catch (e) {
      console.log(`创建全新归档: ${monthKey}.json`);
    }

    let isMonthUpdated = false;

    for (let newLec of newLectures) {
      const existingIndex = localArchive.findIndex(l => l.id === newLec.id);

      if (existingIndex === -1) {
        console.log(`[新增] 发现新讲座 (ID: ${newLec.id}): ${newLec.title}`);

        // 只有 URL 不为空时才去请求详情
        if (newLec.sourceUrl) {
          try {
            const detail = await lecture_detail(newLec.sourceUrl);
            // 补充详情字段并规范化命名
            newLec.mainVenue = detail.mainVenue || '';
            newLec.parallelVenue = detail.venueOfParallelSessions || '';
            newLec.introduction = detail.lectureIntroduction || '';
            // 注: detail 里的 lectureName 等字段通常和 list 里一致，以 list 为准即可
          } catch (e) {
            console.error(`请求详情失败 URL: ${newLec.sourceUrl}`, e);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        localArchive.push(newLec);
        isMonthUpdated = true;
        hasAnyUpdate = true;
      } else {
        // 讲座已存在，获取本地的旧记录
        const existingLec = localArchive[existingIndex];
        let isModified = false;

        // 核心 Diff 逻辑：只对比列表页能拿到的高频变动字段
        if (existingLec.title !== newLec.title ||
          existingLec.startTimestamp !== newLec.startTimestamp ||
          existingLec.endTimestamp !== newLec.endTimestamp ||
          existingLec.isAppointmentRequired !== newLec.isAppointmentRequired) {

          console.log(`[更新] 讲座信息发生变更 (ID: ${existingLec.id})`);
          if (existingLec.title !== newLec.title) console.log(`  - 标题: ${existingLec.title} -> ${newLec.title}`);
          if (existingLec.startTimestamp !== newLec.startTimestamp) console.log(`  - 时间变更!`);

          // 覆盖旧字段
          existingLec.title = newLec.title || existingLec.title;
          existingLec.startTimestamp = newLec.startTimestamp || existingLec.startTimestamp;
          existingLec.endTimestamp = newLec.endTimestamp || existingLec.endTimestamp;
          existingLec.rawTimeStr = newLec.rawTimeStr || existingLec.rawTimeStr;
          existingLec.isAppointmentRequired = newLec.isAppointmentRequired || existingLec.isAppointmentRequired;

          // 顺手覆盖其他列表层面的非关键信息（防止微调）
          existingLec.speaker = newLec.speaker || existingLec.speaker;
          existingLec.department = newLec.department || existingLec.department;
          existingLec.targetAudience = newLec.targetAudience || existingLec.targetAudience;
          existingLec.creditHours = newLec.creditHours || existingLec.creditHours;

          // 刷新最后更新时间，前端日历可以据此显示一个 "Updated" 的小角标
          existingLec.lastUpdatedAt = new Date().toISOString();

          isModified = true;
        }

        // 如果发生了修改，告诉外层系统需要保存文件
        if (isModified) {
          isMonthUpdated = true;
          hasAnyUpdate = true;
        }
      }
    }

    if (isMonthUpdated) {
      await writeFile(archivePath, JSON.stringify(localArchive, null, 2), 'utf-8');
    }

    // 热数据收集：过滤掉时间异常(0)的，且只保留最近及未来的数据
    const recentInThisMonth = localArchive.filter(l =>
      l.startTimestamp > 0 && l.startTimestamp >= SEVEN_DAYS_AGO && l.startTimestamp <= SEVEN_DAYS_AFTER
    );
    allRecentLectures.push(...recentInThisMonth);
  }

  // 3. 产出网页专用热数据 (Export Hot Data)
  if (hasAnyUpdate) {
    allRecentLectures.sort((a, b) => a.startTimestamp - b.startTimestamp);
    const latestPath = join(BASE_DIR, category, 'latest.json');

    await writeFile(latestPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: allRecentLectures.length,
      lectures: allRecentLectures
    }, null, 2), 'utf-8');

    console.log(`✅ ${category} 数据更新完毕，最新 latest.json 包含 ${allRecentLectures.length} 条记录。`);
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

await main();
