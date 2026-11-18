FreelanceHub: الخادم (Back-End)

منصة عمل حر تجمع أصحاب المشاريع بـ المستقلين، وتضمن أن المستقل يأخذ حقه وأن العميل لا يدفع إلا مقابل عمل استلمه.

صاحب المشروع ينشر مشروعاً، والمستقلون يقدمون عروضهم، فيقبل عرضاً فيُحجز ثمنه من محفظته. وبعد التسليم والموافقة يُدفع المبلغ المحجوز: 90% للمستقل و10% عمولة للمنصة.

هذا المستودع هو الخادم فقط. فريق آخر يبني الواجهات، والتوثيق الكامل لكل طلب في docs/API.md.

1. التقنيات
الطبقة	المستعمل
اللغة والإطار	TypeScript وNestJS (Module وController وService وDTO)، والمشروع ESM
قاعدة البيانات	PostgreSQL وPrisma 7 (مع @prisma/adapter-pg) مع Migrations
المصادقة	JWT: access لمدة 15 دقيقة وrefresh لمدة 7 أيام مع Rotation، وPassport (passport-jwt)، وbcrypt
التحقق من المدخلات	class-validator وclass-transformer و@nestjs/mapped-types
حد الطلبات	@nestjs/throttler
الأمان	helmet وCORS محدد وضغط الردود
الملفات	Multer مع التحقق من محتوى الملف بـ file-type
المهام المجدولة	@nestjs/schedule
الإعدادات	@nestjs/config مع التحقق عند الإقلاع بـ class-validator
2. المتطلبات
Node.js 22 أو أحدث (جُرّب على 24)
PostgreSQL 14 أو أحدث
npm
3. التشغيل
bash
# 1. تثبيت الحزم
npm install

# 2. الإعدادات: انسخ المثال ثم عدّل القيم (القسم 4)
cp .env.example .env          # في ويندوز: copy .env.example .env

# 3. قاعدة البيانات: تطبيق الـ migrations (فيها القيود المضافة يدوياً)
npx prisma migrate deploy

# 4. توليد Prisma Client (لا يُولَّد تلقائياً في Prisma 7)
npx prisma generate

# 5. إنشاء حساب المدير (حساب المنصة) ومحفظته
npx prisma db seed

# 6. تشغيل الخادم
npm run start:dev

للتحقق من أن كل شيء يعمل افتح http://localhost:<PORT>/health.

مهم: الخادم يرفض الإقلاع إن لم يجد حساب المنصة (الخطوة 5)، أو إن كان أحد المتغيرات خاطئاً، ويطبع قائمة بالمشكلات.

للإنتاج: npm run build ثم npm run start:prod.

4. متغيرات البيئة (.env)
المتغير	مطلوب	الوصف
DATABASE_URL	نعم	رابط PostgreSQL
JWT_SECRET	نعم	سر التوقيع، 32 حرفاً على الأقل (عشوائي وطويل)
JWT_ACCESS_EXPIRES_IN	نعم	مثل 15m
JWT_REFRESH_EXPIRES_IN	نعم	مثل 7d
PLATFORM_ADMIN_EMAIL	نعم	بريد حساب المدير/المنصة (تذهب إليه العمولة)
PLATFORM_ADMIN_NAME	نعم	اسمه
PLATFORM_ADMIN_PASSWORD	نعم	كلمة سره (8 أحرف على الأقل) وتُستعمل في الـ seed فقط
PORT	لا	المنفذ (الافتراضي 3000)
UPLOADS_DIR	لا	مجلد الملفات (الافتراضي ./uploads)
CORS_ORIGINS	لا	عناوين الواجهات مفصولة بفاصلة بلا / في آخرها. إن تُرك فارغاً تعطّل CORS
TRUST_PROXY	لا	عدد الوسطاء أمام الخادم (Nginx = 1). الافتراضي 0
RATE_LIMIT_PER_MINUTE	لا	حد الطلبات لكل عنوان IP (الافتراضي 50)

لتوليد JWT_SECRET قوي:

bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

.env لا يُرفع إلى git أبداً، و.env.example هو الذي يُرفع.

5. بنية المشروع
prisma/
  schema.prisma          النموذج
  migrations/            كل التعديلات على القاعدة (فيها القيود المضافة بـ SQL)
  seed.ts                إنشاء حساب المدير
prisma.config.ts         رابط القاعدة وأمر الـ seed (Prisma 7)
src/
  main.ts, app.module.ts
  config/                التحقق من متغيرات البيئة عند الإقلاع
  prisma/                PrismaModule (عام) وPrismaService
  platform/              يحدد محفظة المنصة عند الإقلاع
  storage/               حفظ الملفات والتحقق من نوعها
  common/                decorators وguards وfilters وinterceptors وdto وutils
  auth/                  التسجيل والدخول والـ refresh
  wallet/ categories/ projects/ offers/ deliveries/ freelancers/ admin/ health/
  tasks/                 المهام المجدولة
docs/                    التوثيق (API وERD وخطة الاختبار وPostman)
6. النموذج (ERD)

الصورة في docs/erd.png، وهذا مخطط تقريبي:

owns
has (freelancers)
owns (clients)
submits (freelancers)
sessions
groups
receives
has
linked to
records
USER
WALLET
FREELANCER_PROFILE
PROJECT
OFFER
REFRESH_TOKEN
CATEGORY
DELIVERY
TRANSACTION
7. الأدوار
الدور	يستطيع
CLIENT صاحب مشروع	ينشر مشاريعه ويعدّلها ويحذفها وهي مفتوحة، ويرى عروضها، ويقبل عرضاً (فيُحجز المال)، ويوافق على التسليم أو يرفضه، ويشحن رصيده
FREELANCER مستقل	يتصفح المشاريع المفتوحة، ويقدّم عروضاً ويعدّلها، ويرفع التسليم، ويدير ملفه
ADMIN مدير	يدير التصنيفات، ويحظر المستخدمين، ويلغي المشاريع العالقة ويُرجع المال

حساب المدير لا يُنشأ من التسجيل العادي، بل بالـ seed.

8. دورة المشروع والمال
مشروع:   OPEN ──(قبول عرض)──> IN_PROGRESS ──(موافقة على التسليم)──> COMPLETED
                                  ├──(المدير: المستقل محظور)──> CANCELLED
                                  └──(العميل: بعد الموعد بيومين، ولا تسليم معلّق)──> CANCELLED
عرض:     PENDING ──> ACCEPTED   (أو REJECTED لبقية العروض عند قبول واحد)
تسليم:   PENDING ──> APPROVED   (أو REJECTED مع ملاحظة، ثم تسليم جديد)

مثال (قصة الوصف): سارة تشحن 300$ وتنشر مشروعاً. أحمد وليلى يقدمان عرضين. سارة تقبل عرض أحمد بـ 200$: يُحجز من رصيدها (يبقى 100$) ويُرفض عرض ليلى. أحمد يرفع الملف وسارة توافق: أحمد 180$ والمنصة 20$ ويكتمل المشروع.

9. القرارات التي اتخذناها

الوصف ترك لنا الحالات التي لم يغطّها، وهذه قراراتنا فيها.

المال
المبلغ المحجوز يُمثَّل بسجل حركات (DEPOSIT وHOLD وRELEASE وCOMMISSION وREFUND)، لا بحقل heldBalance منفصل. والمحجوز هو سعر العرض لا ميزانية المشروع.
الخصم عند القبول أمر واحد شرطي في قاعدة البيانات (balance >= price)، لا قراءة ثم خصم، فلا يتجاوز رصيد أحد حدّه حتى مع طلبين متزامنين. وقيد CHECK (balance >= 0) في القاعدة نفسها شبكة أمان.
المال Decimal(12,2) ولا Float أبداً، ويرجع في الردود نصاً بخانتين ("100.00").
العمولة = 10% من السعر مقرّبة إلى خانتين (النصف للأعلى)، ويأخذ المستقل الباقي (السعر − العمولة)، فيبقى المجموع مطابقاً للسعر تماماً.
العمولة تذهب إلى محفظة حساب المدير الذي يُنشأ بالـ seed (يُحدَّد ببريده PLATFORM_ADMIN_EMAIL).
إيداع واحد لا يتجاوز 1,000,000.
الذرّية والتزامن
قبول العرض والموافقة على التسليم وإلغاء المشروع كل منها معاملة واحدة: فإما تنجح كل الخطوات أو لا يتغير شيء.
تُقفل صفوف المشروع والعرض والتسليم (SELECT ... FOR UPDATE) بترتيب ثابت، فلا يُدفع مبلغ مرتين ولا يُقبل عرضان لمشروع واحد.
فهرس فريد جزئي في القاعدة: عرض مقبول واحد فقط لكل مشروع.
عند القبول يرسل العميل expectedPrice (السعر الذي رآه): إن غيّره المستقل في اللحظة الأخيرة يُرفض القبول (409).
التسليم
يستطيع صاحب المشروع رفض التسليم مع ملاحظة، ويرفع المستقل تسليماً جديداً. ولا يُقبل تسليم جديد وفي المشروع تسليم معلّق.
موافقة تلقائية إن لم يردّ العميل خلال 3 أيام (مهمة كل ساعة)، وتستعمل دالة الدفع نفسها.
حظر مستقل أثناء التنفيذ: يستطيع المدير إلغاء المشروع فيعود المبلغ المحجوز للعميل (REFUND).
الموعد والتأخر وطلبات التعديل
موعد التسليم dueAt = وقت قبول العرض + مدة العرض (durationDays). وكل رد مشروع يحمل dueAt وisOverdue (فات الموعد والمشروع قيد التنفيذ) وcancellableAt.
طلب التعديل (رفض التسليم) يشترط extraDays من 1 إلى 30 يمنحها العميل للمستقل، فيُمدَّد الموعد من الأبعد بين الموعد الحالي والآن، فلا يضيع على المستقل الوقت المتبقي.
التأخر: بعد موعد التسليم بيومين يستطيع العميل إلغاء المشروع واسترداد المبلغ المحجوز كاملاً (POST /projects/:id/cancel)، بشرط ألا يكون هناك تسليم معلّق. فلا يبقى المال محجوزاً للأبد إن اختفى المستقل دون أن يُحظر.
إلغاء العميل وإلغاء المدير يستعملان دالة الاسترداد نفسها (حركة REFUND ثم المشروع CANCELLED في معاملة واحدة).
الحسابات والأمان
كلمة السر: SHA-256 ثم bcrypt بـ 12 جولة، حتى لا يقصّ bcrypt كلمات السر الطويلة أو العربية (حده 72 بايتاً).
Refresh token نص عشوائي لا يُخزَّن منه إلا تجزئته. التدوير عند كل استخدام، وإعادة استعمال token ملغى تُلغي كل جلسات صاحبه.
الدور والحظر يُقرآن من قاعدة البيانات في كل طلب (لا من الـ token)، فالحظر فوري.
الحماية افتراضية: JwtAuthGuard وRolesGuard عامّان، والمفتوح فقط يُعلَّم بـ @Public().
404 لا 403 عند الوصول إلى ما ليس لك، كي لا يكتشف أحد أي المعرّفات موجودة.
تسجيل الدخول: رسالة خطأ واحدة، وحد 5 محاولات في الدقيقة لكل (IP + بريد)، وحد عام 50 في الدقيقة لكل IP.
الملفات
التحقق من محتوى الملف الحقيقي (لا امتداده): صور JPG وPNG وWEBP (بلا SVG)، وPDF للمرفق، وPDF/ZIP للتسليم. الحدود: صورة المستقل 2MB، المرفق 5MB، التسليم 20MB.
أسماء الملفات: التاريخ + نص عشوائي (20261111-083512-a1b2c3d4.pdf).
المجلد uploads/public يُقدَّم على /uploads/.... وuploads/private (التسليمات) لا يُقدَّم أبداً ولا يُفتح إلا من GET /deliveries/:id/file بعد التحقق من الصلاحية.
التصنيفات والرؤية
قائمة التصنيفات مخزَّنة في ذاكرة الخادم، وتُمسح فور أي تعديل فيراه الجميع مباشرة.
لا يُحذف تصنيف فيه مشاريع.
تصفح المشاريع للمستقلين فقط (المفتوحة فقط)، والعميل يرى مشاريعه عبر /projects/mine.
10. شكل الردود

نجاح:

json
{ "success": true, "message": "...", "data": { }, "meta": { "total": 120, "page": 1, "limit": 10, "totalPages": 12 } }

(meta في القوائم فقط.)

خطأ:

json
{ "success": false, "statusCode": 409, "message": "...", "errors": [] }
المال نصوص: "100.00".
روابط الملفات نسبية: /uploads/...، والواجهة تضيف عنوان الخادم.
الترقيم: ?page=1&limit=10 والأقصى 50.
11. الطلبات (Endpoints)

الشرح الكامل لكل طلب (المدخلات والقواعد والأخطاء) في docs/API.md.

الطلب	من يستعمله
POST /auth/register	الجميع
POST /auth/login	الجميع (5 في الدقيقة)
POST /auth/refresh	الجميع
POST /auth/logout	الجميع
GET /auth/me	أي مسجّل
GET /wallet	أي مسجّل
GET /wallet/transactions	أي مسجّل
POST /wallet/deposit	CLIENT
GET /categories	الجميع
POST /categories · PATCH /categories/:id · DELETE /categories/:id	ADMIN
POST /projects	CLIENT
GET /projects	FREELANCER
GET /projects/mine	CLIENT
GET /projects/:id	حسب القاعدة (مالك/مدير/مستقل)
PATCH /projects/:id · DELETE /projects/:id	CLIENT (المالك، والمشروع مفتوح)
POST /projects/:id/cancel	CLIENT (المالك، بعد موعد التسليم بيومين)
POST /projects/:id/offers	FREELANCER
GET /projects/:id/offers	CLIENT (المالك)
GET /offers/mine	FREELANCER
PATCH /offers/:id	FREELANCER (صاحب العرض)
POST /offers/:id/accept	CLIENT (المالك)
POST /projects/:id/deliveries	FREELANCER (المقبول)
GET /projects/:id/deliveries	المالك والمستقل المقبول والمدير
GET /deliveries/:id/file	المالك والمستقل المقبول والمدير
POST /deliveries/:id/approve · POST /deliveries/:id/reject	CLIENT (المالك)
GET /freelancers/me · PATCH /freelancers/me	FREELANCER
GET /freelancers/:id	الجميع
GET /admin/users	ADMIN
POST /admin/users/:id/ban · POST /admin/users/:id/unban	ADMIN
GET /admin/projects/blocked · POST /admin/projects/:id/cancel	ADMIN
GET /health	الجميع
GET /uploads/*	الجميع (الملفات العامة فقط)
12. المهام المجدولة
كل ساعة: الموافقة التلقائية على التسليمات المعلّقة منذ 3 أيام (ودفعها).
يومياً 3 صباحاً: حذف الـ refresh tokens التي انتهت صلاحيتها منذ أكثر من يوم.
13. الاختبار

اختبرنا المشروع يدوياً بمجموعة Postman: docs/freelancehub.postman_collection.json، وخطتها بالخطوات في docs/manual-test-plan.md (173 خطوة تغطي القصة كاملة والحالات المرفوضة والمواعيد والإلغاء). الاختبارات التلقائية غير موجودة بعد.

14. قيود معروفة وتطويرات مستقبلية
نسخة واحدة من الخادم: الـ cache وحدّ الطلبات والمهام المجدولة في ذاكرة العملية. وعند التوسع إلى عدة نسخ يُنقل الأول والثاني إلى Redis، والثالث إلى طابور (BullMQ) كي لا تعمل المهمة في نسختين.
نشر: لا يوجد Dockerfile ولا docker-compose.yml بعد.
الرفع: الملفات تُحمَّل في ذاكرة الخادم مؤقتاً قبل حفظها (حد أقصى 20MB)، ويمكن استبدالها بتخزين مباشر على القرص عند كثرة الرفع المتزامن.
البحث في عناوين المشاريع يمسح الجدول (سريع مع آلاف الصفوف). وعند الحاجة يُضاف فهرس pg_trgm.
نظام نزاعات: لو رفض عميل سيئ النية كل تسليم بـ extraDays صغير ثم ألغى بعد المهلة، فقد يسترد ماله بعد أن استلم عملاً. حله الحقيقي نزاعات يتدخل فيها المدير، وهو خارج حدود الوصف.
بوابة دفع حقيقية: شحن الرصيد هنا مجرد إدخال مبلغ.
إشعارات لحظية (Socket.IO) وبريد: غير موجودة.