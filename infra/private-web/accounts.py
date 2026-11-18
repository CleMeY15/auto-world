"""Local terminal only. Removal invalidates every session for the user."""
import argparse
import getpass
import sys

import django
django.setup()
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import MinimumLengthValidator, CommonPasswordValidator
from django.core.exceptions import ValidationError
from django.db import IntegrityError

parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["add", "remove"])
parser.add_argument("username")
args = parser.parse_args()
User = get_user_model()
if args.action == "remove":
    deleted, _ = User.objects.filter(username=args.username).delete()
    sys.exit(0 if deleted else "Compte introuvable.")
if not sys.stdin.isatty():
    sys.exit("Un terminal privé est requis.")
user = User(username=args.username)
password = getpass.getpass("Mot de passe : ")
if password != getpass.getpass("Confirmer : "):
    sys.exit("Saisies différentes.")
try:
    MinimumLengthValidator(14).validate(password, user)
    CommonPasswordValidator().validate(password, user)
    user.set_password(password)
    user.full_clean()
    user.save(force_insert=True)
except (IntegrityError, ValidationError):
    sys.exit("Identifiant indisponible ou mot de passe refusé (14 caractères minimum).")
