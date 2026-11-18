from pathlib import Path
import os

BASE = Path(__file__).resolve().parent
STATE = Path(os.environ.get("PRIVATE_WEB_STATE", "/var/lib/aw-private-auth"))
SECRET_KEY = (STATE / "key").read_text().strip()
DEBUG = False
ALLOWED_HOSTS = ["autofind.tech"]
ROOT_URLCONF = "gateway"
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions"]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": STATE / "auth.sqlite3"}}
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates",
              "DIRS": [BASE / "templates"], "APP_DIRS": False}]
LANGUAGE_CODE = "fr"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_NAME = "__Host-aw-session"
CSRF_COOKIE_NAME = "__Host-aw-csrf"
SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 4 * 60 * 60
SESSION_COOKIE_EXPIRE_AT_BROWSER_CLOSE = True
LOGIN_REDIRECT_URL = "/demo"
DATA_UPLOAD_MAX_MEMORY_SIZE = 16384
DATA_UPLOAD_MAX_NUMBER_FIELDS = 8
CSRF_FAILURE_VIEW = "gateway.csrf_error"
# Request paths and form fields do not belong in operational logs.
LOGGING = {"version": 1, "disable_existing_loggers": False,
           "handlers": {"discard": {"class": "logging.NullHandler"}},
           "loggers": {"django": {"handlers": ["discard"], "propagate": False}}}
