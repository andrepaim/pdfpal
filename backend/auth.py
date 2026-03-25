import os
import time
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from authlib.integrations.httpx_client import AsyncOAuth2Client
from jose import jwt, JWTError

# ---------------------------------------------------------------------------
# Config (from env)
# ---------------------------------------------------------------------------

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
ALLOWED_EMAILS = [e.strip() for e in os.getenv("ALLOWED_EMAILS", "andrepaim@gmail.com").split(",") if e.strip()]
SESSION_SECRET = os.getenv("SESSION_SECRET", "change-me-in-production")
SESSION_MAX_AGE = int(os.getenv("SESSION_MAX_AGE", str(30 * 24 * 3600)))  # 30 days
PUBLIC_URL = os.getenv("PUBLIC_URL", "https://pdfpal.duckdns.org")
SESSION_COOKIE = "pdfpal_session"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_session_token(user: dict) -> str:
    payload = {
        "email": user["email"],
        "name": user.get("name", ""),
        "picture": user.get("picture", ""),
        "exp": int(time.time()) + SESSION_MAX_AGE,
    }
    return jwt.encode(payload, SESSION_SECRET, algorithm="HS256")


def verify_session_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SESSION_SECRET, algorithms=["HS256"])
    except JWTError:
        return None

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/google")
async def google_login():
    state = secrets.token_urlsafe(32)
    redirect_uri = f"{PUBLIC_URL}/auth/google/callback"
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
    }
    response = RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{urlencode(params)}")
    response.set_cookie("oauth_state", state, max_age=600, httponly=True, secure=True, samesite="lax")
    return response


@router.get("/google/callback")
async def google_callback(request: Request, code: str, state: str):
    stored_state = request.cookies.get("oauth_state")
    if not stored_state or stored_state != state:
        return JSONResponse({"detail": "Invalid OAuth state"}, status_code=400)

    redirect_uri = f"{PUBLIC_URL}/auth/google/callback"
    async with AsyncOAuth2Client(
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        redirect_uri=redirect_uri,
    ) as client:
        await client.fetch_token(GOOGLE_TOKEN_URL, code=code)
        resp = await client.get(GOOGLE_USERINFO_URL)
        userinfo = resp.json()

    email = userinfo.get("email", "")
    if email not in ALLOWED_EMAILS:
        return JSONResponse({"detail": "Access denied. This app is private."}, status_code=403)

    token = create_session_token({
        "email": email,
        "name": userinfo.get("name", ""),
        "picture": userinfo.get("picture", ""),
    })
    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_MAX_AGE, httponly=True, secure=True, samesite="lax", path="/")
    response.delete_cookie("oauth_state")
    return response


@router.get("/me")
async def get_me(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    user = verify_session_token(token)
    if not user:
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return {"email": user.get("email"), "name": user.get("name"), "picture": user.get("picture")}


@router.post("/logout")
async def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
