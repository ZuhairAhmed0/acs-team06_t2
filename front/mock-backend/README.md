# Wayn Alwaqood — Flask Mock API

خادم تجريبي فقط لتغذية واجهة React ببيانات وهمية قبل انتهاء الـBackend الحقيقي.

## المتطلبات

- Python 3.10 أو أحدث
- الحزم في `requirements.txt`

## التشغيل على Windows PowerShell

من داخل مجلد `mock-backend`:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
py app.py
```

## التشغيل على Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

سيعمل الخادم على `http://localhost:5000`، والـAPI تحت `/api/v1`.
جرّب فحص الصحة من `http://localhost:5000/api/v1/health`.

## حسابات التجربة

كلمة المرور لجميع الحسابات: `Demo123!`

| الدور | رقم الهاتف | ما ستراه |
|---|---|---|
| سائق USER | `0911111111` | محفظة، تخصيصات، طلبات شحن ومشتريات |
| مالك محطة OWNER | `0922222222` | لوحة مالك محطة النيل، المالية، الأسعار والتسويات |
| عامل محطة ATTENDANT | `0933333333` | قائمة طلبات الوقود لمحطة الخرطوم وتأكيد الصرف |
| مدير ADMIN | `0900000000` | مراجعة طلبات الشحن وتنفيذ التسويات التجريبية |

## توصيل React

في الواجهة، غيّر عنوان `baseURL` في `src/lib/api.js` إلى:

```js
baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api/v1",
```

ويمكنك بدلاً من ذلك وضع السطر التالي في ملف `.env` بجانب `package.json`:

```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

ثم أعد تشغيل Vite بعد تعديل `.env`.
لا تحتاج إلى تغيير أي مسار في `src/lib/endpoints.js`.

## ملاحظات مهمة

- الجلسة تستخدم Flask session cookie باسم `wayn_mock_session` وخصائص مناسبة للتجربة المحلية.
- البيانات محفوظة في ذاكرة العملية فقط؛ إعادة تشغيل Flask تعيد البيانات إلى القيم الأولية.
- تسجيل الدخول وإنشاء الطلبات وتأكيد الوقود واعتماد الشحن والتسويات كلها محاكاة محلية.
- لا يتصل الخادم ببنك أو محطة حقيقية ولا يستخدم قاعدة بيانات.
- لا تستخدم هذا الخادم أو سر الجلسة أو كلمات المرور في الإنتاج.
