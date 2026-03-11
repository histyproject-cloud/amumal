// api/og.js - Vercel Edge Function
// GitHub에 api/og.js 경로로 올려주세요

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://oathqvxogecbrpswnjxk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdGhxdnhvZ2VjYnJwc3duanhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTA5NDYsImV4cCI6MjA4ODYyNjk0Nn0.zrieOYKfxDB4r_czc8dz-bA33Yr_LR7BdWqWA_SZQb8';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const postId = searchParams.get('post');

  // post ID 없으면 메인으로 리다이렉트
  if (!postId) {
    return Response.redirect('https://amumal.site', 302);
  }

  let title = '아무말 - 익명 커뮤니티';
  let description = '로그인 없이 아무 말이나 써보세요. 완전 익명 커뮤니티.';
  let image = 'https://amumal.site/og-image.png';
  let redirectUrl = `https://amumal.site/?post=${postId}`;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=tag,title,content,images`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    const post = data?.[0];

    if (post) {
      const tag = post.tag || '잡담';
      const postTitle = post.title ? post.title : (post.content || '').slice(0, 40);
      title = `[${tag}] ${postTitle} - 아무말`;
      description = (post.content || '').slice(0, 120).replace(/\n/g, ' ');
      if (post.images && post.images.length > 0) {
        image = post.images[0]; // base64 or URL
      }
    }
  } catch (e) {}

  // 이미지가 base64면 og:image로 못 씀 → 기본 이미지 사용
  if (image && image.startsWith('data:')) {
    image = 'https://amumal.site/og-image.png';
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="아무말">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${image}">
  <meta property="og:url" content="${redirectUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${image}">
  <!-- 카카오톡 -->
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta http-equiv="refresh" content="0;url=${redirectUrl}">
  <script>location.href="${redirectUrl}";</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 's-maxage=60' }
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
