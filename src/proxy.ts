import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optional login gate in front of the whole app, delegated to an external
 * auth server that speaks the nginx `auth_request` protocol — Authelia's
 * /api/authz/auth-request, or any compatible service.
 *
 *   AUTH_REQUEST_URL  e.g. https://auth.example.com/api/authz/auth-request
 *   AUTH_LOGIN_URL    e.g. https://auth.example.com/   (where to send visitors)
 *
 * Unset AUTH_REQUEST_URL = no gate (local dev, or an instance protected some
 * other way). The check is done here rather than in the reverse proxy so the
 * instance works behind any proxy, and across servers: forward-auth headers
 * (X-Forwarded-*) are stripped by a proxy in front of the auth server,
 * auth-request's X-Original-* headers are not.
 *
 * Fails closed: if the auth server can't be reached, nobody gets in.
 */
const USER_HEADER = 'x-openseo-user';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Never trust an identity header sent by the client.
  const headers = new Headers(request.headers);
  headers.delete(USER_HEADER);

  const authUrl = process.env.AUTH_REQUEST_URL?.trim();
  if (!authUrl) return NextResponse.next({ request: { headers } });

  const appUrl = process.env.APP_URL?.trim() || request.nextUrl.origin;
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, appUrl).toString();

  let res: Response;
  try {
    res = await fetch(authUrl, {
      method: 'GET',
      headers: {
        'X-Original-URL': target,
        'X-Original-Method': request.method,
        Cookie: request.headers.get('cookie') ?? '',
      },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return new NextResponse('Sign-in service unavailable. Try again in a minute.', { status: 503 });
  }

  if (res.status === 200) {
    const user = res.headers.get('remote-user');
    if (user) headers.set(USER_HEADER, user);
    return NextResponse.next({ request: { headers } });
  }

  if (res.status === 401) {
    const loginUrl = process.env.AUTH_LOGIN_URL?.trim();
    const wantsPage = (request.method === 'GET' || request.method === 'HEAD') && !!loginUrl;
    if (wantsPage) {
      const login = new URL(loginUrl!);
      login.searchParams.set('rd', target);
      login.searchParams.set('rm', request.method);
      return NextResponse.redirect(login, 302);
    }
    return new NextResponse('Sign in required.', { status: 401 });
  }

  return new NextResponse('You do not have access to this OpenSEO instance.', { status: 403 });
}

export const config = {
  // Everything except the liveness probe and static build assets.
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
