import { partnerUrl, upsertUser } from './_utils.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const userId = Number(url.searchParams.get('uid'));

  if (userId) {
    await upsertUser(env, {
      user_id: userId,
      clicked: true,
      blocked: true,
      reason: 'partner_click',
    }).catch(() => {});
  }

  return Response.redirect(partnerUrl(env), 302);
}
