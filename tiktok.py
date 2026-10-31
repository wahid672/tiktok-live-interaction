#!/usr/bin/env python3
"""TikTok web session reuse and RTMP push URL retrieval.
Never logs or stores cookies or tokens in plain text.
"""
import configparser, hashlib, shutil, sqlite3, subprocess, tempfile, time
from pathlib import Path
import requests

H = Path.home()
FIREFOX = [("Firefox", [".mozilla/firefox", ".config/mozilla/firefox", "snap/firefox/common/.mozilla/firefox",
                        ".var/app/org.mozilla.firefox/.mozilla/firefox", ".var/app/org.mozilla.firefox/config/mozilla/firefox"]),
           ("LibreWolf", [".librewolf", ".var/app/io.gitlab.librewolf-community/.librewolf"]),
           ("Waterfox", [".waterfox"]), ("Floorp", [".floorp", ".var/app/one.ablaze.floorp/.floorp"]),
           ("Zen", [".zen", ".var/app/app.zen_browser.zen/.zen"])]
CHROMIUM = [("Chrome", "Chrome", [".config/google-chrome", ".var/app/com.google.Chrome/config/google-chrome"]),
            ("Chromium", "Chromium", [".config/chromium", "snap/chromium/common/chromium", ".var/app/org.chromium.Chromium/config/chromium"]),
            ("Brave", "Brave", [".config/BraveSoftware/Brave-Browser", ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"]),
            ("Edge", "Microsoft Edge", [".config/microsoft-edge", ".var/app/com.microsoft.Edge/config/microsoft-edge"]),
            ("Vivaldi", "Chrome", [".config/vivaldi", ".var/app/com.vivaldi.Vivaldi/config/vivaldi"]),
            ("Opera", "Chromium", [".config/opera", ".var/app/com.opera.Opera/config/opera"])]
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0"

_keys = {}

def _default_log(msg):
    print(f"[TikTok] {msg}")

def _copy_query(db, sql):
    with tempfile.TemporaryDirectory() as td:
        for suf in ("", "-wal"):
            if Path(str(db) + suf).exists():
                shutil.copy2(str(db) + suf, Path(td) / ("c.db" + suf))
        con = sqlite3.connect(Path(td) / "c.db")
        try:
            return [con.execute(q).fetchall() for q in sql]
        finally:
            con.close()

def _firefox_rows(db):
    rows = _copy_query(db, ["select host,name,value,path,isSecure,expiry from moz_cookies where host like '%tiktok.com'"])[0]
    return [(h, n, v, pa, se, e / 1000 if e > 1e11 else e) for h, n, v, pa, se, e in rows]

def _keyring_password(name):
    if name in _keys:
        return _keys[name]
    pw = None
    try:
        import gi; gi.require_version("Secret", "1")
        from gi.repository import Secret
        svc = Secret.Service.get_sync(Secret.ServiceFlags.LOAD_COLLECTIONS, None)
        for col in svc.get_collections() or []:
            if col.get_locked(): svc.unlock_sync([col], None)
            col.load_items_sync(None)
            for it in col.get_items() or []:
                if it.get_label() == f"{name} Safe Storage":
                    it.load_secret_sync(None); pw = it.get_secret().get_text(); break
            if pw: break
    except Exception:
        pass
    if not pw and shutil.which("kwallet-query"):
        try:
            r = subprocess.run(["kwallet-query", "-r", f"{name} Safe Storage", "-f", f"{name} Keys", "kdewallet"],
                               capture_output=True, text=True, timeout=10)
            pw = r.stdout.strip() if r.returncode == 0 and "Failed" not in r.stdout else None
        except Exception:
            pass
    _keys[name] = pw
    return pw

def _chromium_decrypt(enc, name, strip_hash):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    pw = b"peanuts" if enc[:3] == b"v10" else (_keyring_password(name) or "").encode()
    if not pw:
        return None
    key = hashlib.pbkdf2_hmac("sha1", pw, b"saltysalt", 1, 16)
    d = Cipher(algorithms.AES(key), modes.CBC(b" " * 16)).decryptor()
    out = d.update(enc[3:]) + d.finalize()
    if not 1 <= out[-1] <= 16:
        return None
    out = out[:-out[-1]]
    return (out[32:] if strip_hash else out).decode()

def _chromium_rows(db, name):
    rows, meta = _copy_query(db, ["select host_key,name,value,encrypted_value,path,is_secure,expires_utc from cookies "
                                  "where host_key like '%tiktok.com'", "select value from meta where key='version'"])
    strip = int(meta[0][0]) >= 24 if meta else False
    out = []
    for h, n, v, enc, pa, se, e in rows:
        if not v and enc:
            try:
                v = _chromium_decrypt(enc, name, strip) if enc[:3] in (b"v10", b"v11") else None
            except Exception:
                v = None
        if v:
            out.append((h, n, v, pa, se, e / 1e6 - 11644473600 if e else 0))
    return out

def _candidate_homes():
    homes = [Path.home()]
    for p in [Path("/data/home"), Path("/home/user")] + list(Path("/home").glob("*")):
        if p.is_dir() and p not in homes:
            homes.append(p)
    return homes

def _profiles():
    seen = set()
    for h in _candidate_homes():
        for name, dirs in FIREFOX:
            for d in dirs:
                ff = h / d; c = configparser.RawConfigParser(); c.read(ff / "profiles.ini")
                for sec in c.sections():
                    if sec.startswith("Profile") and c[sec].get("Path"):
                        p = Path(c[sec]["Path"]); p = ff / p if c[sec].get("IsRelative", "1") == "1" else p
                        db = p / "cookies.sqlite"
                        if db.exists() and db not in seen:
                            seen.add(db)
                            yield f"{name} ({p.name})", lambda db=db: _firefox_rows(db)
        for name, kr, dirs in CHROMIUM:
            for d in dirs:
                for p in sorted((h / d).glob("*")):
                    for db in (p / "Network/Cookies", p / "Cookies"):
                        if db.is_file() and db not in seen:
                            seen.add(db)
                            yield f"{name} ({p.name})", lambda db=db, kr=kr: _chromium_rows(db, kr); break

def find_session():
    best = (0, None, [])
    for label, load in _profiles():
        try:
            rows = load()
        except Exception:
            continue
        exp = max((r[5] for r in rows if r[1] == "sessionid" and r[2]), default=0)
        if exp > max(best[0], time.time()):
            best = (exp, label, rows)
    return best[1], best[2]

def session_status():
    label, rows = find_session()
    if not label:
        return {"ok": False, "browser": None, "expires": None}
    exp = max(r[5] for r in rows if r[1] == "sessionid")
    return {"ok": True, "browser": label, "expires": time.strftime("%d/%m/%Y", time.localtime(exp))}

API = "https://webcast.tiktok.com/webcast/"
WEB = {"aid": "1988", "app_name": "tiktok_web", "device_platform": "web", "channel": "web"}

def _session(log=_default_log):
    p, rows = find_session()
    if not p:
        log("No active TikTok session found in any browser. Please log in to tiktok.com in Chrome.")
        raise RuntimeError("No active TikTok session found in any browser.")
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                      "Referer": "https://www.tiktok.com/live", "Origin": "https://www.tiktok.com"})
    for h, n, v, pa, se, _ in rows:
        s.cookies.set(n, v, domain=h, path=pa or "/", secure=bool(se))
    return s

def _json(log, tag, call):
    try:
        r = call(); d = r.json()
    except Exception as e:
        log(f"{tag}=FAIL request_error={type(e).__name__}")
        return None
    log(f"{tag}_HTTP={r.status_code} status_code={d.get('status_code')}")
    return d

def _csrf(log, s):
    try:
        r = s.head(API + "room/create/", params=WEB, timeout=10,
                   headers={"x-secsdk-csrf-request": "1", "x-secsdk-csrf-version": "1.2.22"})
        parts = r.headers.get("x-ware-csrf-token", "").split(",")
        token = parts[1] if len(parts) > 1 else ""
    except Exception:
        token = ""
    log("CSRF=" + ("OBTAINED" if token else "NONE"))
    return token

ACTIVE_ROOM_FILE = Path(__file__).resolve().parent / ".active_room.json"

def save_active_room(room):
    try:
        import json
        with open(ACTIVE_ROOM_FILE, "w", encoding="utf-8") as f:
            json.dump(room, f)
    except Exception as e:
        print(f"Error saving active room to file: {e}")

def get_active_room():
    if ACTIVE_ROOM_FILE.exists():
        try:
            import json
            with open(ACTIVE_ROOM_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None

def clear_active_room():
    if ACTIVE_ROOM_FILE.exists():
        try:
            ACTIVE_ROOM_FILE.unlink(missing_ok=True)
        except Exception:
            pass

def create_room(log=_default_log, title=""):
    title = (title or "").strip() or "LIVE"
    s = _session(log)
    try:
        hdr = {"Content-Type": "application/x-www-form-urlencoded"}
        token = _csrf(log, s)
        if token:
            hdr["x-secsdk-csrf-token"] = token
        q = {**WEB, "title": title, "cover_uri": "", "screenshot_cover_status": "1"}
        d = _json(log, "CREATE_POST", lambda: s.post(API + "room/create/", params=q, headers=hdr, timeout=15))
        if not ((d or {}).get("data") or {}).get("stream_url", {}).get("rtmp_push_url"):
            d = _json(log, "CREATE_GET", lambda: s.get(API + "room/create/", params=WEB, timeout=15))
    finally:
        s.close()

    if d is None:
        raise RuntimeError("Could not contact TikTok server")
    data = d.get("data") or {}
    url = (data.get("stream_url") or {}).get("rtmp_push_url", "")
    if d.get("status_code") != 0 or not url.startswith("rtmp"):
        msg = str(data.get("message") or data.get("prompts") or d.get("message") or "unknown error")[:200]
        log(f"RTMP=NOT_OBTAINED reason={msg}")
        raise RuntimeError(f"TikTok did not return an RTMP URL: {msg}")
    log("RTMP=OBTAINED")
    room_id = data.get("id_str") or str(data.get("id") or "")
    owner = data.get("owner") or {}
    room_obj = {
        "url": url,
        "user": owner.get("display_id") or owner.get("unique_id") or "",
        "title": title,
        "room_id": room_id,
        "stream_id": data.get("stream_id_str") or str(data.get("stream_id") or "")
    }
    save_active_room(room_obj)
    return room_obj

def get_session_id(log=_default_log):
    try:
        s = _session(log)
        for c in s.cookies:
            if c.name in ("sessionid", "sessionid_ss") and c.value:
                return c.value
    except Exception:
        pass
    return ""

def finish_room(log=_default_log, room=None):
    if not room:
        room = get_active_room()
    if not room or not (room.get("room_id") and room.get("stream_id")):
        log("ROOM_FINISH=SKIPPED no_active_room_found")
        clear_active_room()
        return False

    s = _session(log)
    ok = False
    try:
        hdr = {"Content-Type": "application/x-www-form-urlencoded"}
        token = _csrf(log, s)
        if token:
            hdr["x-secsdk-csrf-token"] = token
        payload = {
            "status": "4",
            "room_id": str(room["room_id"]),
            "stream_id": str(room["stream_id"])
        }
        d = _json(log, "ROOM_FINISH", lambda: s.post(API + "room/ping/anchor/", params={**WEB, **payload}, data=payload, headers=hdr, timeout=15))
        ok = bool(d) and d.get("status_code") == 0
    finally:
        s.close()
        clear_active_room()
    log("ROOM_FINISH=" + ("PASS" if ok else "FAIL"))
    return ok

if __name__ == "__main__":
    print("Testing session status...")
    print(session_status())
