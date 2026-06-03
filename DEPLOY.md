# رفع LiveChat KAWI Secure على Render

1. ارفع محتويات هذا الفولدر على GitHub وليس ملف ZIP نفسه.
2. في Render اختر New → Web Service.
3. Build Command:
```bash
npm install
```
4. Start Command:
```bash
npm start
```
5. أضف Environment Variables:
```text
OWNER_USERNAME=admin
OWNER_PASSWORD=اكتب_كلمة_سر_قوية
```
6. بعد أول دخول افتح لوحة التحكم وغيّر كلمة المرور.

مهم: الملفات يجب أن تكون في أول مستوى من الريبو: server.js, package.json, public/.
