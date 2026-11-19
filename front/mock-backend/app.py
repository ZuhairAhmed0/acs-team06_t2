"""Wayn Alwaqood - Flask mock API for local frontend development only.

All data is in memory and resets whenever this process restarts.
This server is NOT suitable for production or real financial activity.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from functools import wraps
from uuid import uuid4

from flask import Flask, jsonify, request, session
from flask_cors import CORS

API_PREFIX = "/api/v1"
FRONTEND_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app = Flask(__name__)
app.config.update(
    SECRET_KEY="local-wayn-alwaqood-mock-secret-change-me",
    SESSION_COOKIE_NAME="wayn_mock_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=False,  # Local HTTP only. Use HTTPS + Secure in production.
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_PATH="/",
    JSON_SORT_KEYS=False,
)
CORS(app, origins=FRONTEND_ORIGINS, supports_credentials=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def response(data=None, status=200, message=None):
    payload = {"data": data}
    if message:
        payload["message"] = message
    return jsonify(payload), status


def error(message: str, status=400):
    return jsonify({"message": message, "error": message}), status


# ---------------------------------------------------------------------------
# In-memory sample data. Edit these objects to change what appears in React.
# ---------------------------------------------------------------------------
USERS = {
    "user-driver": {
        "id": "user-driver", "full_name": "أحمد محمد - سائق", "phone": "0911111111",
        "password": "Demo123!", "role": "USER", "system_role": "USER",
        "station_memberships": [], "created_at": now_iso(),
    },
    "user-owner": {
        "id": "user-owner", "full_name": "سارة عبد الله - مالكة محطة", "phone": "0922222222",
        "password": "Demo123!", "role": "USER", "system_role": "USER",
        "station_memberships": [{"station_id": "station-001", "role": "OWNER", "station_name": "محطة النيل"}],
        "created_at": now_iso(),
    },
    "user-attendant": {
        "id": "user-attendant", "full_name": "محمد الأمين - عامل محطة", "phone": "0933333333",
        "password": "Demo123!", "role": "USER", "system_role": "USER",
        "station_memberships": [{"station_id": "station-002", "role": "ATTENDANT", "station_name": "محطة الخرطوم"}],
        "created_at": now_iso(),
    },
    "user-admin": {
        "id": "user-admin", "full_name": "مدير النظام", "phone": "0900000000",
        "password": "Demo123!", "role": "ADMIN", "system_role": "ADMIN",
        "station_memberships": [], "created_at": now_iso(),
    },
}

STATIONS = {
    "station-001": {
        "id": "station-001", "name": "محطة النيل", "address": "شارع النيل، الخرطوم، السودان",
        "status": "ACTIVE", "owner_user_id": "user-owner", "minimum_settlement_amount": 10000.0,
        "payable_balance": 68500.0, "reserved_amount": 5000.0,
        "settlement_count": 3,
    },
    "station-002": {
        "id": "station-002", "name": "محطة الخرطوم", "address": "الخرطوم شرق، السودان",
        "status": "ACTIVE", "owner_user_id": None, "minimum_settlement_amount": 15000.0,
        "payable_balance": 42000.0, "reserved_amount": 0.0,
        "settlement_count": 1,
    },
    "station-003": {
        "id": "station-003", "name": "محطة أم درمان", "address": "شارع الوادي، أم درمان، السودان",
        "status": "ACTIVE", "owner_user_id": None, "minimum_settlement_amount": 20000.0,
        "payable_balance": 6500.0, "reserved_amount": 0.0,
        "settlement_count": 0,
    },
}

PRICES = {
    "station-001": [
        {"id": "price-101", "fuel_type": "PETROL", "price": 3200.0, "valid_from": "2026-11-01T00:00:00Z"},
        {"id": "price-102", "fuel_type": "DIESEL", "price": 2900.0, "valid_from": "2026-11-01T00:00:00Z"},
    ],
    "station-002": [
        {"id": "price-201", "fuel_type": "PETROL", "price": 3150.0, "valid_from": "2026-11-05T00:00:00Z"},
        {"id": "price-202", "fuel_type": "DIESEL", "price": 2850.0, "valid_from": "2026-11-05T00:00:00Z"},
    ],
    "station-003": [
        {"id": "price-301", "fuel_type": "PETROL", "price": 3250.0, "valid_from": "2026-11-03T00:00:00Z"},
    ],
}

WALLETS = {
    "user-driver": {"availableBalance": 145000.0, "allocatedBalance": 57000.0, "reservedBalance": 5000.0},
    "user-owner": {"availableBalance": 38000.0, "allocatedBalance": 12000.0, "reservedBalance": 0.0},
    "user-attendant": {"availableBalance": 12000.0, "allocatedBalance": 0.0, "reservedBalance": 0.0},
    "user-admin": {"availableBalance": 0.0, "allocatedBalance": 0.0, "reservedBalance": 0.0},
}

ALLOCATIONS = [
    {"id": "alloc-001", "user_id": "user-driver", "station_id": "station-001", "station_name": "محطة النيل", "amount": 35000.0, "available_amount": 30000.0, "status": "ACTIVE"},
    {"id": "alloc-002", "user_id": "user-driver", "station_id": "station-002", "station_name": "محطة الخرطوم", "amount": 22000.0, "available_amount": 22000.0, "status": "ACTIVE"},
    {"id": "alloc-003", "user_id": "user-owner", "station_id": "station-001", "station_name": "محطة النيل", "amount": 12000.0, "available_amount": 12000.0, "status": "ACTIVE"},
]

BANK_ACCOUNTS = {
    "user-driver": [{"id": "bank-u-1", "bank_name": "بنك الخرطوم", "account_holder_name": "أحمد محمد", "account_number": "XXXX-XXXX-1122"}],
    "user-owner": [{"id": "bank-u-2", "bank_name": "بنك أم درمان الوطني", "account_holder_name": "سارة عبد الله", "account_number": "XXXX-XXXX-3344"}],
    "user-attendant": [], "user-admin": [],
}

STATION_BANK_ACCOUNTS = {
    "station-001": [{"id": "bank-s-1", "bank_name": "بنك الخرطوم", "account_holder_name": "شركة محطة النيل", "account_number": "XXXX-XXXX-7788"}],
    "station-002": [{"id": "bank-s-2", "bank_name": "بنك فيصل الإسلامي", "account_holder_name": "محطة الخرطوم", "account_number": "XXXX-XXXX-9900"}],
    "station-003": [],
}

TOPUPS = [
    {"id": "topup-001", "user_id": "user-driver", "user_name": "أحمد محمد - سائق", "amount": 50000.0, "sender_bank_name": "بنك الخرطوم", "sender_account_number": "XXXX-1122", "bank_reference": "TRX-DR-20261114", "status": "PENDING", "created_at": now_iso()},
    {"id": "topup-002", "user_id": "user-owner", "user_name": "سارة عبد الله - مالكة محطة", "amount": 25000.0, "sender_bank_name": "بنك أم درمان الوطني", "sender_account_number": "XXXX-3344", "bank_reference": "TRX-OW-20261112", "status": "PENDING", "created_at": now_iso()},
    {"id": "topup-003", "user_id": "user-driver", "user_name": "أحمد محمد - سائق", "amount": 30000.0, "sender_bank_name": "بنك الخرطوم", "sender_account_number": "XXXX-1122", "bank_reference": "TRX-DR-OLD-01", "status": "APPROVED", "created_at": now_iso()},
]

TRANSACTIONS = [
    {"id": "txn-001", "user_id": "user-driver", "description": "شحن المحفظة", "transaction_type": "TOP_UP", "amount": 100000.0, "status": "COMPLETED", "created_at": now_iso()},
    {"id": "txn-002", "user_id": "user-driver", "description": "تخصيص لمحطة النيل", "transaction_type": "ALLOCATION", "amount": 35000.0, "status": "COMPLETED", "created_at": now_iso()},
    {"id": "txn-003", "user_id": "user-driver", "description": "شراء وقود", "transaction_type": "FUEL_PURCHASE", "amount": 5000.0, "status": "COMPLETED", "created_at": now_iso()},
]

PURCHASES = [
    {"id": "purchase-001", "user_id": "user-driver", "customer_name": "أحمد محمد", "station_id": "station-001", "station_name": "محطة النيل", "fuel_type": "PETROL", "maximum_amount": 5000.0, "amount": 5000.0, "quantity": 1.562, "status": "COMPLETED", "created_at": now_iso()},
    {"id": "purchase-002", "user_id": "user-driver", "customer_name": "أحمد محمد", "station_id": "station-002", "station_name": "محطة الخرطوم", "fuel_type": "DIESEL", "maximum_amount": 12000.0, "amount": 0.0, "quantity": 0.0, "status": "PENDING", "created_at": now_iso()},
    {"id": "purchase-003", "user_id": "user-owner", "customer_name": "سارة عبد الله", "station_id": "station-001", "station_name": "محطة النيل", "fuel_type": "PETROL", "maximum_amount": 7000.0, "amount": 7000.0, "quantity": 2.187, "status": "COMPLETED", "created_at": now_iso()},
]

SETTLEMENTS = [
    {"id": "settlement-001", "station_id": "station-001", "station_name": "محطة النيل", "amount": 22000.0, "bank_reference": "SETTLE-NILE-001", "status": "COMPLETED", "created_at": now_iso()},
    {"id": "settlement-002", "station_id": "station-001", "station_name": "محطة النيل", "amount": 15000.0, "bank_reference": "SETTLE-NILE-002", "status": "COMPLETED", "created_at": now_iso()},
    {"id": "settlement-003", "station_id": "station-002", "station_name": "محطة الخرطوم", "amount": 18000.0, "bank_reference": "SETTLE-KRT-001", "status": "COMPLETED", "created_at": now_iso()},
]


def public_user(user: dict) -> dict:
    return {k: deepcopy(v) for k, v in user.items() if k != "password"}


def current_user():
    user_id = session.get("user_id")
    return USERS.get(user_id)


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return error("يجب تسجيل الدخول أولاً.", 401)
        return fn(*args, **kwargs)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    @require_auth
    def wrapper(*args, **kwargs):
        if current_user().get("system_role") != "ADMIN":
            return error("هذه العملية متاحة لمدير النظام فقط.", 403)
        return fn(*args, **kwargs)
    return wrapper


def membership_for(user: dict, station_id: str, role: str | None = None):
    for membership in user.get("station_memberships", []):
        if membership.get("station_id") == station_id and (role is None or membership.get("role") == role):
            return membership
    return None


def owned_station_ids(user: dict, role: str | None = None):
    return [m["station_id"] for m in user.get("station_memberships", []) if role is None or m.get("role") == role]


def user_allocations(user_id: str):
    return [a for a in ALLOCATIONS if a["user_id"] == user_id]


def add_transaction(user_id: str, description: str, transaction_type: str, amount: float, status="COMPLETED"):
    item = {"id": make_id("txn"), "user_id": user_id, "description": description,
            "transaction_type": transaction_type, "amount": round(float(amount), 2),
            "status": status, "created_at": now_iso()}
    TRANSACTIONS.insert(0, item)
    return item


@app.get(f"{API_PREFIX}/health")
def health():
    return response({"status": "ok", "service": "wayn-alwaqood-mock-api", "mode": "mock"})


# Authentication + session cookie ------------------------------------------
@app.post(f"{API_PREFIX}/auth/register")
def register():
    body = request.get_json(silent=True) or {}
    full_name, phone, password = body.get("full_name", "").strip(), body.get("phone", "").strip(), body.get("password", "")
    if len(full_name) < 3 or len(phone) < 7 or len(password) < 8:
        return error("أدخل الاسم ورقم الهاتف وكلمة مرور من 8 أحرف على الأقل.")
    if any(u["phone"] == phone for u in USERS.values()):
        return error("رقم الهاتف مسجل بالفعل.", 409)
    user_id = make_id("user")
    USERS[user_id] = {"id": user_id, "full_name": full_name, "phone": phone, "password": password,
                      "role": "USER", "system_role": "USER", "station_memberships": [], "created_at": now_iso()}
    WALLETS[user_id] = {"availableBalance": 0.0, "allocatedBalance": 0.0, "reservedBalance": 0.0}
    BANK_ACCOUNTS[user_id] = []
    return response({"user": public_user(USERS[user_id])}, 201, "تم إنشاء الحساب التجريبي.")


@app.post(f"{API_PREFIX}/auth/login")
def login():
    body = request.get_json(silent=True) or {}
    phone, password = body.get("phone", "").strip(), body.get("password", "")
    user = next((u for u in USERS.values() if u["phone"] == phone and u["password"] == password), None)
    if not user:
        return error("رقم الهاتف أو كلمة المرور غير صحيحة.", 401)
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    return response({"user": public_user(user)}, message="تم تسجيل الدخول وإنشاء جلسة تجريبية.")


@app.post(f"{API_PREFIX}/auth/refresh")
@require_auth
def refresh():
    return response({"user": public_user(current_user())}, message="الجلسة ما زالت فعالة.")


@app.post(f"{API_PREFIX}/auth/logout")
@require_auth
def logout():
    session.clear()
    return response({"logged_out": True}, message="تم تسجيل الخروج.")


@app.get(f"{API_PREFIX}/users/me")
@require_auth
def me():
    return response({"user": public_user(current_user())})


# Driver wallet -------------------------------------------------------------
@app.get(f"{API_PREFIX}/wallet")
@require_auth
def wallet():
    return response({"wallet": deepcopy(WALLETS.get(current_user()["id"], {"availableBalance": 0, "allocatedBalance": 0, "reservedBalance": 0}))})


@app.get(f"{API_PREFIX}/wallet/transactions")
@require_auth
def wallet_transactions():
    uid = current_user()["id"]
    rows = [t for t in TRANSACTIONS if t["user_id"] == uid]
    return response({"items": deepcopy(rows)})


@app.post(f"{API_PREFIX}/topups")
@require_auth
def create_topup():
    body = request.get_json(silent=True) or {}
    try:
        amount = round(float(body.get("amount", 0)), 2)
    except (TypeError, ValueError):
        return error("المبلغ غير صحيح.")
    if amount <= 0 or not body.get("bank_reference"):
        return error("أدخل مبلغاً صحيحاً والمرجع البنكي.")
    user = current_user()
    item = {"id": make_id("topup"), "user_id": user["id"], "user_name": user["full_name"],
            "amount": amount, "sender_bank_name": body.get("sender_bank_name", ""),
            "sender_account_number": body.get("sender_account_number", ""),
            "bank_reference": body["bank_reference"], "status": "PENDING", "created_at": now_iso()}
    TOPUPS.insert(0, item)
    return response(item, 201, "تم إرسال طلب الشحن للمراجعة.")


@app.get(f"{API_PREFIX}/topups/me")
@require_auth
def my_topups():
    uid = current_user()["id"]
    return response({"items": deepcopy([t for t in TOPUPS if t["user_id"] == uid])})


@app.get(f"{API_PREFIX}/admin/topups")
@require_admin
def admin_topups():
    return response({"items": deepcopy(TOPUPS)})


@app.post(f"{API_PREFIX}/admin/topups/<topup_id>/approve")
@require_admin
def approve_topup(topup_id):
    item = next((t for t in TOPUPS if t["id"] == topup_id), None)
    if not item:
        return error("طلب الشحن غير موجود.", 404)
    if item["status"] != "PENDING":
        return error("تمت معالجة هذا الطلب مسبقاً.", 409)
    body = request.get_json(silent=True) or {}
    item["status"] = "APPROVED"
    item["verified_bank_reference"] = body.get("verified_bank_reference", item["bank_reference"])
    WALLETS[item["user_id"]]["availableBalance"] += item["amount"]
    add_transaction(item["user_id"], "اعتماد طلب شحن المحفظة", "TOP_UP", item["amount"])
    return response(item, message="تم اعتماد الشحن التجريبي وإضافة الرصيد.")


@app.post(f"{API_PREFIX}/admin/topups/<topup_id>/reject")
@require_admin
def reject_topup(topup_id):
    item = next((t for t in TOPUPS if t["id"] == topup_id), None)
    if not item:
        return error("طلب الشحن غير موجود.", 404)
    if item["status"] != "PENDING":
        return error("تمت معالجة هذا الطلب مسبقاً.", 409)
    body = request.get_json(silent=True) or {}
    item["status"] = "REJECTED"
    item["rejection_reason"] = body.get("reason", "لم يتم التحقق من العملية.")
    return response(item, message="تم رفض طلب الشحن التجريبي.")


# Bank accounts -------------------------------------------------------------
@app.route(f"{API_PREFIX}/users/me/bank-accounts", methods=["GET", "POST"])
@require_auth
def user_bank_accounts():
    uid = current_user()["id"]
    if request.method == "GET":
        return response({"items": deepcopy(BANK_ACCOUNTS.setdefault(uid, []))})
    body = request.get_json(silent=True) or {}
    if not all(body.get(k) for k in ("bank_name", "account_holder_name", "account_number")):
        return error("أكمل بيانات الحساب البنكي.")
    item = {"id": make_id("bank"), **body}
    BANK_ACCOUNTS.setdefault(uid, []).append(item)
    return response(item, 201, "تمت إضافة الحساب البنكي التجريبي.")


@app.route(f"{API_PREFIX}/stations/<station_id>/bank-accounts", methods=["GET", "POST"])
@require_auth
def station_bank_accounts(station_id):
    if station_id not in STATIONS:
        return error("المحطة غير موجودة.", 404)
    user = current_user()
    if user["system_role"] != "ADMIN" and not membership_for(user, station_id, "OWNER"):
        return error("هذه العملية متاحة لمالك المحطة فقط.", 403)
    if request.method == "GET":
        return response({"items": deepcopy(STATION_BANK_ACCOUNTS.setdefault(station_id, []))})
    body = request.get_json(silent=True) or {}
    if not all(body.get(k) for k in ("bank_name", "account_holder_name", "account_number")):
        return error("أكمل بيانات الحساب البنكي.")
    item = {"id": make_id("bank-station"), **body}
    STATION_BANK_ACCOUNTS.setdefault(station_id, []).append(item)
    return response(item, 201, "تمت إضافة الحساب البنكي للمحطة.")


# Stations + prices ----------------------------------------------------------
@app.route(f"{API_PREFIX}/stations", methods=["GET", "POST"])
def stations_collection():
    if request.method == "GET":
        return response({"items": deepcopy(list(STATIONS.values()))})
    if not current_user() or current_user()["system_role"] != "ADMIN":
        return error("هذه العملية متاحة لمدير النظام فقط.", 403)
    body = request.get_json(silent=True) or {}
    if not body.get("name"):
        return error("اسم المحطة مطلوب.")
    station_id = make_id("station")
    STATIONS[station_id] = {"id": station_id, "name": body["name"], "address": body.get("address", ""),
                            "status": "ACTIVE", "owner_user_id": None, "minimum_settlement_amount": 10000.0,
                            "payable_balance": 0.0, "reserved_amount": 0.0, "settlement_count": 0}
    PRICES[station_id] = []
    return response(STATIONS[station_id], 201)


@app.route(f"{API_PREFIX}/stations/<station_id>", methods=["GET", "PATCH"])
@require_auth
def station_detail(station_id):
    station = STATIONS.get(station_id)
    if not station:
        return error("المحطة غير موجودة.", 404)
    if request.method == "GET":
        return response(deepcopy(station))
    user = current_user()
    if user["system_role"] != "ADMIN" and not membership_for(user, station_id, "OWNER"):
        return error("غير مصرح بتعديل هذه المحطة.", 403)
    body = request.get_json(silent=True) or {}
    for key in ("name", "address", "status"):
        if key in body:
            station[key] = body[key]
    return response(station)


@app.route(f"{API_PREFIX}/stations/<station_id>/prices", methods=["GET", "POST"])
@require_auth
def station_prices(station_id):
    if station_id not in STATIONS:
        return error("المحطة غير موجودة.", 404)
    if request.method == "GET":
        return response({"items": deepcopy(PRICES.setdefault(station_id, []))})
    user = current_user()
    if user["system_role"] != "ADMIN" and not membership_for(user, station_id, "OWNER"):
        return error("إضافة الأسعار متاحة لمالك المحطة فقط.", 403)
    body = request.get_json(silent=True) or {}
    if body.get("fuel_type") not in ("PETROL", "DIESEL") or float(body.get("price", 0) or 0) <= 0:
        return error("نوع الوقود أو السعر غير صحيح.")
    item = {"id": make_id("price"), "fuel_type": body["fuel_type"], "price": float(body["price"]),
            "valid_from": body.get("valid_from") or now_iso()}
    PRICES.setdefault(station_id, []).insert(0, item)
    return response(item, 201, "تمت إضافة السعر التجريبي.")


# Allocations + transfers ----------------------------------------------------
@app.route(f"{API_PREFIX}/allocations", methods=["GET", "POST"])
@require_auth
def allocations():
    user = current_user()
    uid = user["id"]
    if request.method == "GET":
        return response({"items": deepcopy(user_allocations(uid))})
    body = request.get_json(silent=True) or {}
    station_id = body.get("station_id")
    try:
        amount = round(float(body.get("amount", 0)), 2)
    except (TypeError, ValueError):
        return error("المبلغ غير صحيح.")
    wallet_data = WALLETS[uid]
    if station_id not in STATIONS or amount <= 0:
        return error("اختر محطة ومبلغاً صحيحاً.")
    if wallet_data["availableBalance"] < amount:
        return error("الرصيد المتاح غير كافٍ.", 409)
    wallet_data["availableBalance"] -= amount
    wallet_data["allocatedBalance"] += amount
    existing = next((a for a in ALLOCATIONS if a["user_id"] == uid and a["station_id"] == station_id), None)
    if existing:
        existing["amount"] += amount
        existing["available_amount"] += amount
        item = existing
    else:
        item = {"id": make_id("alloc"), "user_id": uid, "station_id": station_id,
                "station_name": STATIONS[station_id]["name"], "amount": amount,
                "available_amount": amount, "status": "ACTIVE"}
        ALLOCATIONS.append(item)
    add_transaction(uid, f"تخصيص رصيد إلى {STATIONS[station_id]['name']}", "ALLOCATION", amount)
    return response(item, 201, "تم تخصيص الرصيد.")


@app.post(f"{API_PREFIX}/allocation-transfers")
@require_auth
def allocation_transfer():
    user = current_user()
    body = request.get_json(silent=True) or {}
    source_id, destination_id = body.get("source_station_id"), body.get("destination_station_id")
    try:
        amount = round(float(body.get("amount", 0)), 2)
    except (TypeError, ValueError):
        return error("المبلغ غير صحيح.")
    if source_id == destination_id or amount <= 0:
        return error("اختر محطتين مختلفتين ومبلغاً صحيحاً.")
    source = next((a for a in ALLOCATIONS if a["user_id"] == user["id"] and a["station_id"] == source_id), None)
    if not source or source["available_amount"] < amount:
        return error("الرصيد المتاح في المحطة المصدر غير كافٍ.", 409)
    if destination_id not in STATIONS:
        return error("المحطة المستقبلة غير موجودة.", 404)
    dest = next((a for a in ALLOCATIONS if a["user_id"] == user["id"] and a["station_id"] == destination_id), None)
    source["available_amount"] -= amount
    if dest:
        dest["available_amount"] += amount
        dest["amount"] += amount
    else:
        dest = {"id": make_id("alloc"), "user_id": user["id"], "station_id": destination_id,
                "station_name": STATIONS[destination_id]["name"], "amount": amount,
                "available_amount": amount, "status": "ACTIVE"}
        ALLOCATIONS.append(dest)
    add_transaction(user["id"], "تحويل رصيد بين المحطات", "TRANSFER", amount)
    return response({"source": source, "destination": dest, "amount": amount}, message="تم التحويل التجريبي.")


# Fuel purchases -------------------------------------------------------------
@app.route(f"{API_PREFIX}/purchases", methods=["GET", "POST"])
@require_auth
def purchases_collection():
    user = current_user()
    if request.method == "GET":
        attendant_stations = owned_station_ids(user, "ATTENDANT")
        if attendant_stations:
            rows = [p for p in PURCHASES if p["station_id"] in attendant_stations and p["status"] in ("PENDING", "APPROVED", "PROCESSING")]
        else:
            rows = [p for p in PURCHASES if p["user_id"] == user["id"]]
        return response({"items": deepcopy(rows)})
    if user["system_role"] == "ADMIN":
        return error("حساب الإدارة لا ينشئ مشتريات سائق.", 403)
    body = request.get_json(silent=True) or {}
    station_id, fuel_type = body.get("station_id"), body.get("fuel_type")
    try:
        maximum_amount = round(float(body.get("maximum_amount", 0)), 2)
    except (TypeError, ValueError):
        return error("المبلغ غير صحيح.")
    allocation = next((a for a in ALLOCATIONS if a["user_id"] == user["id"] and a["station_id"] == station_id), None)
    if station_id not in STATIONS or fuel_type not in ("PETROL", "DIESEL") or maximum_amount <= 0:
        return error("بيانات طلب الشراء غير مكتملة.")
    if not allocation or allocation["available_amount"] < maximum_amount:
        return error("خصص رصيداً كافياً لهذه المحطة أولاً.", 409)
    allocation["available_amount"] -= maximum_amount  # Mock reservation
    wallet_data = WALLETS[user["id"]]
    wallet_data["reservedBalance"] += maximum_amount
    purchase = {"id": make_id("purchase"), "user_id": user["id"], "customer_name": user["full_name"],
                "station_id": station_id, "station_name": STATIONS[station_id]["name"],
                "fuel_type": fuel_type, "maximum_amount": maximum_amount, "amount": 0.0,
                "quantity": 0.0, "status": "PENDING", "created_at": now_iso()}
    PURCHASES.insert(0, purchase)
    add_transaction(user["id"], "حجز مبلغ لطلب شراء وقود", "FUEL_PURCHASE", maximum_amount, status="PENDING")
    return response(purchase, 201, "تم إنشاء طلب شراء الوقود.")


@app.get(f"{API_PREFIX}/purchases/<purchase_id>")
@require_auth
def purchase_detail(purchase_id):
    purchase = next((p for p in PURCHASES if p["id"] == purchase_id), None)
    if not purchase:
        return error("طلب الشراء غير موجود.", 404)
    user = current_user()
    if user["system_role"] != "ADMIN" and purchase["user_id"] != user["id"] and not membership_for(user, purchase["station_id"], "ATTENDANT"):
        return error("غير مصرح بعرض هذا الطلب.", 403)
    return response(deepcopy(purchase))


@app.post(f"{API_PREFIX}/purchases/<purchase_id>/confirm")
@require_auth
def confirm_purchase(purchase_id):
    purchase = next((p for p in PURCHASES if p["id"] == purchase_id), None)
    if not purchase:
        return error("طلب الشراء غير موجود.", 404)
    user = current_user()
    if user["system_role"] != "ADMIN" and not membership_for(user, purchase["station_id"], "ATTENDANT"):
        return error("تأكيد الصرف متاح لعامل المحطة المنتسب إليها فقط.", 403)
    if purchase["status"] not in ("PENDING", "APPROVED", "PROCESSING"):
        return error("تمت معالجة الطلب مسبقاً.", 409)
    body = request.get_json(silent=True) or {}
    try:
        amount, quantity = round(float(body.get("amount", 0)), 2), round(float(body.get("quantity", 0)), 3)
    except (TypeError, ValueError):
        return error("الكمية أو المبلغ غير صحيح.")
    if amount <= 0 or quantity <= 0 or amount > purchase["maximum_amount"]:
        return error("يجب أن تكون الكمية والمبلغ موجبين وألا يتجاوز المبلغ الحد المصرح.")
    purchase.update({"amount": amount, "quantity": quantity, "fuel_type": body.get("fuel_type", purchase["fuel_type"]),
                     "status": "COMPLETED", "attendant_id": user["id"], "completed_at": now_iso()})
    uid, station_id = purchase["user_id"], purchase["station_id"]
    WALLETS[uid]["reservedBalance"] = max(0.0, WALLETS[uid]["reservedBalance"] - purchase["maximum_amount"])
    # Release unused part to the user's station allocation; capture actual amount.
    allocation = next((a for a in ALLOCATIONS if a["user_id"] == uid and a["station_id"] == station_id), None)
    if allocation:
        allocation["available_amount"] += purchase["maximum_amount"] - amount
    WALLETS[uid]["allocatedBalance"] = max(0.0, WALLETS[uid]["allocatedBalance"] - amount)
    STATIONS[station_id]["payable_balance"] += amount
    add_transaction(uid, "شراء وقود - تم تأكيد الصرف", "FUEL_PURCHASE", amount)
    return response(purchase, message="تم تأكيد صرف الوقود وتحديث البيانات التجريبية.")


# Station owner dashboard ----------------------------------------------------
@app.get(f"{API_PREFIX}/station/finance")
@require_auth
def station_finance():
    user = current_user()
    station_ids = owned_station_ids(user, "OWNER")
    if user["system_role"] == "ADMIN":
        station_ids = list(STATIONS.keys())
    if not station_ids:
        return error("هذا الحساب غير مرتبط بعضوية مالك محطة.", 403)
    station = STATIONS[station_ids[0]]
    payable = station["payable_balance"]
    reserved = station["reserved_amount"]
    completed_count = sum(1 for s in SETTLEMENTS if s["station_id"] == station["id"])
    return response({"finance": {"station_id": station["id"], "station_name": station["name"],
                                  "payable_balance": payable, "reserved_amount": reserved,
                                  "available_for_settlement": max(0.0, payable - reserved),
                                  "settlement_count": completed_count}})


@app.route(f"{API_PREFIX}/station/settlement-settings", methods=["GET", "PATCH"])
@require_auth
def station_settlement_settings():
    user = current_user()
    station_ids = owned_station_ids(user, "OWNER")
    if user["system_role"] == "ADMIN":
        station_ids = list(STATIONS.keys())
    if not station_ids:
        return error("هذه الإعدادات متاحة لمالك المحطة.", 403)
    station = STATIONS[station_ids[0]]
    if request.method == "GET":
        return response({"settings": {"minimum_settlement_amount": station["minimum_settlement_amount"]}})
    body = request.get_json(silent=True) or {}
    try:
        value = round(float(body.get("minimum_settlement_amount", 0)), 2)
    except (TypeError, ValueError):
        return error("قيمة الحد الأدنى غير صحيحة.")
    if value <= 0:
        return error("يجب أن يكون الحد الأدنى أكبر من صفر.")
    station["minimum_settlement_amount"] = value
    return response({"settings": {"minimum_settlement_amount": value}}, message="تم تحديث حد التسوية التجريبي.")


@app.get(f"{API_PREFIX}/station/settlements")
@require_auth
def station_settlements():
    user = current_user()
    station_ids = owned_station_ids(user, "OWNER")
    if user["system_role"] == "ADMIN":
        station_ids = list(STATIONS.keys())
    if not station_ids:
        return error("هذا الحساب غير مرتبط بعضوية مالك محطة.", 403)
    rows = [s for s in SETTLEMENTS if s["station_id"] in station_ids]
    return response({"items": deepcopy(rows)})


@app.get(f"{API_PREFIX}/admin/settlements/eligible")
@require_admin
def eligible_settlements():
    rows = []
    for station in STATIONS.values():
        available = max(0.0, station["payable_balance"] - station["reserved_amount"])
        if available >= station["minimum_settlement_amount"]:
            rows.append({"id": station["id"], "station_id": station["id"], "station_name": station["name"],
                         "payable_balance": station["payable_balance"],
                         "minimum_settlement_amount": station["minimum_settlement_amount"],
                         "available_amount": available})
    return response({"items": rows})


@app.post(f"{API_PREFIX}/admin/settlements/<station_id>/execute")
@require_admin
def execute_settlement(station_id):
    station = STATIONS.get(station_id)
    if not station:
        return error("المحطة غير موجودة.", 404)
    body = request.get_json(silent=True) or {}
    try:
        amount = round(float(body.get("amount", 0)), 2)
    except (TypeError, ValueError):
        return error("المبلغ غير صحيح.")
    reference = body.get("bank_reference", "").strip()
    available = max(0.0, station["payable_balance"] - station["reserved_amount"])
    if amount < station["minimum_settlement_amount"] or amount > available or not reference:
        return error("يجب أن يكون المبلغ فوق الحد الأدنى وألا يتجاوز المتاح، مع إدخال المرجع البنكي.", 409)
    station["payable_balance"] -= amount
    station["settlement_count"] += 1
    item = {"id": make_id("settlement"), "station_id": station_id, "station_name": station["name"],
            "amount": amount, "bank_reference": reference, "status": "COMPLETED", "created_at": now_iso()}
    SETTLEMENTS.insert(0, item)
    return response(item, 201, "تم تسجيل التسوية التجريبية.")


@app.get(f"{API_PREFIX}/admin/settlements")
@require_admin
def admin_settlements():
    return response({"items": deepcopy(SETTLEMENTS)})


@app.errorhandler(404)
def not_found(_error):
    return error("المسار غير موجود في خادم Mock API.", 404)


@app.errorhandler(500)
def internal_error(_error):
    return error("حدث خطأ داخلي في خادم Mock API.", 500)


if __name__ == "__main__":
    print("\nWayn Alwaqood Mock API is running")
    print("API: http://localhost:5000/api/v1")
    print("Demo password for all accounts: Demo123!\n")
    app.run(host="0.0.0.0", port=5000, debug=True)
