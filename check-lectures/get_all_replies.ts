import { graphql } from "@octokit/graphql";

/**
 * 获取特定 Discussion Comment 的所有回复正文
 * @param commentNodeId Discussion Comment 的 GraphQL Node ID (Base64 字符串)
 * @param token GitHub Personal Access Token 或 GITHUB_TOKEN
 * @returns 回复内容的字符串数组
 */
export async function get_all_replies_old(
  commentNodeId: string,
  token: string
): Promise<string[]> {
  const allReplies: string[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  // 使用 GraphQL 强类型定义查询
  const query = `
    query($id: ID!, $after: String) {
      node(id: $id) {
        ... on DiscussionComment {
          replies(first: 100, after: $after) {
            nodes {
              body
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  try {
    const headers: any = {};
    if (token.length > 0) {
      headers["authorization"] = `token ${token}`;
    }

    while (hasNextPage) {
      const response: any = await graphql(query, {
        id: commentNodeId,
        after: cursor,
        headers,
      });

      const repliesData = response.node?.replies;

      if (!repliesData) break;

      // 提取当前页的所有 body
      const batch = repliesData.nodes.map((node: { body: string }) => node.body);
      allReplies.push(...batch);

      // 更新分页状态
      hasNextPage = repliesData.pageInfo.hasNextPage;
      cursor = repliesData.pageInfo.endCursor;
    }
  } catch (error) {
    console.error("读取 Discussion 回复时出错:", error);
    throw error;
  }

  return allReplies;
}

/**
 * 使用原生 Fetch 获取所有回复
 */
export async function get_all_replies(
  commentNodeId: string,
  token: string
): Promise<string[]> {
  const allReplies: string[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  const query = `
    query($id: ID!, $after: String) {
      node(id: $id) {
        ... on DiscussionComment {
          replies(first: 100, after: $after) {
            nodes { body }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        // 重要：GraphQL 建议使用这个 Authorization 格式
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        // Node 24 fetch 必须手动指定 User-Agent，否则 GitHub 有时会拒绝
        "User-Agent": "node-fetch-script"
      },
      body: JSON.stringify({
        query,
        variables: {
          id: commentNodeId,
          after: cursor
        }
      })
    });

    const result: any = await response.json();

    // 捕捉 GraphQL 内部错误
    if (result.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(result.errors)}`);
    }

    // 捕捉身份验证错误
    if (response.status === 401) {
      throw new Error("身份验证失败：请检查 Token 权限或格式");
    }

    const repliesData = result.data?.node?.replies;
    if (!repliesData) break;

    allReplies.push(...repliesData.nodes.map((n: any) => n.body));
    
    hasNextPage = repliesData.pageInfo.hasNextPage;
    cursor = repliesData.pageInfo.endCursor;
  }

  return allReplies;
}

const token = process.env.GITHUB_TOKEN!;
if (!token || token.length === 0) {
  throw new Error("请设置 GITHUB_TOKEN 环境变量");
}
const commentId = "DC_kwDORqBAz84A93qz"; // 替换为真实的 Node ID
const content = await get_all_replies(commentId, token);
console.log(content);