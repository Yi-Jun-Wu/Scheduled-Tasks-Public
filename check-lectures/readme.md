## 代码和结构

### Github 项目结构

```log

Scheduled Task
│   README.md
│   .gitignore
│   package-lock.json               # ignored
│   package.json                    # ignored
│   tsconfig.json                   # ignored
│   
├───.github
│   └───workflows
│           check-lectures.yml      # 触发器位置
│           
├───check-lectures
│   │   main.ts                     # 程序入口
│   │   captcha.ts
│   │   extract.ts
│   │   login.ts
│   │   notification.ts
│   │   .gitignore
│   │   humanity_lectures.json      # ignored
│   │   science_lectures.json       # ignored
│   │   session_cookies.json        # ignored
│   │   
│   └───dist                        # ignored
│           
├───other_projects
│           
└───node_modules                    # ignored
```

首先是 Github Actions 触发器, 其主要目的是定时调度任务, 核心代码全部由 node/typescirpt 执行. 因此, 关键是 `on: { schedule: [cron: 'SCHEDULE_CONFIG', cron: 'SCHEDULE_CONFIG', ...] }` 这里安排任务周期.
由于任务要频繁多次执行, 每次执行时间均不足一分钟(Github Actions 计量按一分钟算), 因此我们要合理安排周期, 让任务在讲座系统更新的时间段频繁监控, 在深夜几乎停止.
我的设计是: **下午4点到7点每十分钟一次, 早上8点到晚上9点每小时两次, 其余时间每小时一次).**
这样每天运行 49 次, 一个月 1470 分钟, 略小于私有库的额度 2000min/mon. 为了防止挤占我的 Actions 额度, 这个仓库挂在 ucas.ac.edu.cn 下的小号里执行.

此外, 对于访问时用到的 SESSION 与讲座系统的历史记录, 我不希望频繁push这个仓库, 考虑到这个脚本是一直运行的, 可以放心地将数据放在 GitHub Actions 的缓存中, 每次运行前拉取, 运行后再保存. 简单高效.

*.github\workflows\check-lectures.yml*
```yml
name: Check UCAS Lecture

on:
  # Allows you to run this workflow manually from the Actions tab
  workflow_dispatch:
  schedule:
    # see: https://crontab.guru/ for corn format.
    # UTC  0 => 8 am (GMT+8)
    # UTC  8 => 4 pm (GMT+8)
    # UTC 11 => 7 pm (GMT+8)
    # UTC 13 => 9 pm (GMT+8)
    # ==================
    # At every 10th minute past every hour from 8 through 10. (4pm-7pm)
    - cron: '*/10 8-10 * * *'       # 18 times
    # At every 30th minute past every hour from 0 through 7 and every hour from 11 through 12. (8am-4pm, 7pm-9pm)
    - cron: '*/30 0-7,11-12 * * *'  # 20 times
    # At minute 30 past every hour from 13 through 23. (9pm-8am)
    - cron: '30 13-23 * * *'        # 11 times

    ## totally 49 runs per day, 1470 minutes per month
    ## limits: 2000 minutes per month for private repo (73.5%)


concurrency:
  group: check-lecture
  cancel-in-progress: true

# A workflow run is made up of one or more jobs that can run sequentially or in parallel
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      # Checks-out repo
      - uses: actions/checkout@v6

      # Set up Node
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      
      # 核心步骤：恢复上一次的 Cookie 缓存, 以及
      - name: Restore Session Cookie
        id: cache-cookie-restore
        uses: actions/cache/restore@v5
        with:
          key: check-lecture-cache
          path: |
            ./check-lectures/session_cookies.json
            ./check-lectures/humanity_lectures.json
            ./check-lectures/science_lectures.json
      
      # Install dependencies and run main script
      - run: |
          cd check-lectures
          npm install axios axios-cookiejar-support sharp tesseract.js tough-cookie @thednp/domparser
          node main.ts
        env:
          USERNAME: ${{ secrets.SEP_USERNAME }}
          PASSWORD: ${{ secrets.SEP_PASSWORD }}
          API_KEY: ${{ secrets.SERVER_CHAN_KEY }}

      # 核心步骤：保存当前的 Cookie 缓存
      - name: Restore Session Cookie
        if: always()
        id: cache-cookie-save
        uses: actions/cache/save@v5
        with:
          key: check-lecture-cache
          path: |
            ./check-lectures/session_cookies.json
            ./check-lectures/humanity_lectures.json
            ./check-lectures/science_lectures.json
```