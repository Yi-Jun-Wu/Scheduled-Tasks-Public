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
        "Authorization": `token ${token}`,
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
      console.log("Token Length:", token?.length);
      throw new Error("身份验证失败：请检查 Token 权限或格式:" + token.slice(0, 10) + "****");
    }

    const repliesData = result.data?.node?.replies;
    if (!repliesData) break;

    allReplies.push(...repliesData.nodes.map((n: any) => n.body));

    hasNextPage = repliesData.pageInfo.hasNextPage;
    cursor = repliesData.pageInfo.endCursor;
  }

  return allReplies;
}

if(import.meta.main) {
  const token = process.env.DISCUSSION_READ_TOKEN;
  if (!token || token.length === 0) {
    throw new Error("请设置 DISCUSSION_READ_TOKEN 环境变量");
  }
  const commentId = "DC_kwDORqBAz84A93qz";
  const content = await get_all_replies(commentId, token);
  console.log("Api Content:", content);
}