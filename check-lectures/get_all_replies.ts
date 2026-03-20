import { graphql } from "@octokit/graphql";

/**
 * 获取特定 Discussion Comment 的所有回复正文
 * @param commentNodeId Discussion Comment 的 GraphQL Node ID (Base64 字符串)
 * @param token GitHub Personal Access Token 或 GITHUB_TOKEN
 * @returns 回复内容的字符串数组
 */
export async function get_all_replies(
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


const token = process.env.GITHUB_TOKEN || "";
const commentId = "DC_kwDORqBAz84A93qz"; // 替换为真实的 Node ID
const content = await get_all_replies(commentId, token);