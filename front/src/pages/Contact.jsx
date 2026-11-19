import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Phone, MapPin, Clock3, MessageCircle, Send, Headphones, Building2, ArrowUpLeft, CheckCircle2, ShieldCheck } from "lucide-react";

const demoContact = {
  email: "support@wayn-alwaqood.example",
  phone: "+249 000 000 000",
  address: "الخرطوم، السودان — عنوان تجريبي للمشروع",
  hours: "الأحد إلى الخميس، 9:00 صباحاً – 5:00 مساءً"
};

const topics = ["مشكلة في الحساب أو تسجيل الدخول", "طلب شحن أو مرجع تحويل", "رصيد المحفظة أو التحويل بين المحطات", "طلب شراء وقود", "المحطات والأسعار", "استفسار عن الخصوصية", "اقتراح أو موضوع آخر"];

function InfoCard({ icon: Icon, title, value, note, href }) {
  const content = <><div className="contact-info-icon"><Icon size={21}/></div><div className="min-w-0"><p className="text-sm font-bold text-[#101d2d]">{title}</p><p className="mt-1 break-words text-sm font-semibold text-[#087f70]">{value}</p><p className="mt-1 text-xs leading-6 text-slate-500">{note}</p></div></>;
  return href ? <a className="contact-info-card surface" href={href}>{content}</a> : <div className="contact-info-card surface">{content}</div>;
}

export function Contact() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", topic: topics[0], message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [reference, setReference] = useState("");

  function update(field, value) {
    setForm(current => ({ ...current, [field]: value }));
    if (submitted) setSubmitted(false);
  }

  function handleSubmit(event) {
    event.preventDefault();
    // This page is intentionally a frontend-only demo; no contact API is called.
    const suffix = Math.floor(1000 + Math.random() * 9000);
    setReference(`DEMO-${suffix}`);
    setSubmitted(true);
  }

  return (
    <main dir="rtl" className="contact-page">
      <section className="contact-hero">
        <div className="shell relative z-10 py-14 md:py-20">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-200 hover:text-white"><ArrowUpLeft size={16}/> العودة للرئيسية</Link>
          <div className="mt-8 max-w-3xl">
            <span className="contact-kicker"><MessageCircle size={15}/> مركز التواصل والمساعدة</span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight text-white md:text-5xl">نحن هنا لنساعدك،<br/><span className="text-emerald-300">خطوة بخطوة.</span></h1>
            <p className="mt-5 max-w-2xl text-sm leading-8 text-slate-200 md:text-base">سواء كان استفسارك عن المحفظة أو طلب شحن أو محطة مشاركة، اجمع تفاصيلك وأرسل لنا رسالة تجريبية. صممنا هذه الصفحة لتوضيح تجربة التواصل قبل ربطها بخدمة الدعم الفعلية.</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3 text-xs text-slate-200"><span className="contact-hero-chip"><Headphones size={15}/> دعم المستخدمين</span><span className="contact-hero-chip"><Building2 size={15}/> دعم المحطات</span><span className="contact-hero-chip"><Clock3 size={15}/> ساعات عمل تجريبية</span></div>
        </div>
      </section>

      <section className="shell contact-content py-10 md:py-14">
        <div className="contact-demo-notice"><span className="contact-demo-pulse"/><p><strong>تنبيه: هذه بيانات تجريبية.</strong> البريد والهاتف والعنوان أدناه غير مخصصة للتواصل الحقيقي، والنموذج لا يرسل البيانات إلى خادم أو بريد إلكتروني؛ بل يعرض تأكيداً محلياً لتجربة الواجهة فقط.</p></div>

        <div className="grid items-start gap-7 lg:grid-cols-[.82fr_1.18fr]">
          <aside className="space-y-5">
            <div><p className="text-xs font-bold tracking-[.16em] text-[#087f70]">تواصل مع الفريق</p><h2 className="mt-2 text-2xl font-extrabold text-[#101d2d]">قنوات الاتصال</h2><p className="mt-2 text-sm leading-7 text-slate-500">اختر القناة الأنسب، أو استخدم النموذج لإرسال رسالة اختبارية.</p></div>
            <div className="grid gap-3">
              <InfoCard icon={Mail} title="البريد الإلكتروني" value={demoContact.email} note="صندوق بريد افتراضي لغرض العرض فقط" href={`mailto:${demoContact.email}`}/>
              <InfoCard icon={Phone} title="الهاتف" value={demoContact.phone} note="رقم توضيحي غير مخصص للاتصال" href={`tel:${demoContact.phone.replaceAll(" ", "")}`}/>
              <InfoCard icon={MapPin} title="المكتب" value={demoContact.address} note="موقع افتراضي لملء بيانات صفحة التواصل"/>
              <InfoCard icon={Clock3} title="ساعات العمل" value={demoContact.hours} note="جدول تجريبي قابل للتعديل"/>
            </div>
            <div className="contact-help-card"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-white/10 text-emerald-300"><ShieldCheckIcon/></div><div><h3 className="font-bold text-white">قبل إرسال استفسار مالي</h3><p className="mt-1 text-xs text-slate-300">جهّز رقم المعاملة أو مرجع الطلب فقط.</p></div></div><p className="mt-4 text-sm leading-7 text-slate-300">لا ترسل كلمة المرور أو رمز الجلسة أو الرقم السري أو رمز التحقق البنكي. فريق الدعم لا يحتاج إلى هذه المعلومات لمعالجة استفسارك.</p></div>
          </aside>

          <section className="contact-form-card surface">
            <div className="mb-6 flex items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-[.14em] text-[#087f70]">SEND A MESSAGE</p><h2 className="mt-2 text-2xl font-extrabold text-[#101d2d]">أرسل لنا رسالة</h2><p className="mt-2 text-sm leading-7 text-slate-500">املأ الحقول التالية وسنعرض لك نتيجة تجريبية مباشرة.</p></div><div className="contact-form-mark"><Send size={22}/></div></div>
            {submitted && <div role="status" className="contact-success mb-5"><CheckCircle2 size={21}/><div className="min-w-0"><p className="font-bold">تم إنشاء رسالة تجريبية بنجاح</p><p className="mt-1 text-xs leading-6">المرجع: <b dir="ltr" className="font-mono">{reference}</b> — لم تُرسل الرسالة إلى أي خادم أو بريد.</p></div></div>}
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="contact-field"><span>الاسم الكامل <b>*</b></span><input required maxLength={100} value={form.name} onChange={e => update("name", e.target.value)} placeholder="اكتب اسمك" autoComplete="name"/></label>
                <label className="contact-field"><span>البريد الإلكتروني <b>*</b></span><input required type="email" maxLength={160} value={form.email} onChange={e => update("email", e.target.value)} placeholder="name@example.com" dir="ltr" autoComplete="email"/></label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="contact-field"><span>رقم الهاتف <small>(اختياري)</small></span><input type="tel" maxLength={30} value={form.phone} onChange={e => update("phone", e.target.value)} placeholder="+249 ..." dir="ltr" autoComplete="tel"/></label>
                <label className="contact-field"><span>موضوع الرسالة <b>*</b></span><select required value={form.topic} onChange={e => update("topic", e.target.value)}>{topics.map(topic => <option key={topic}>{topic}</option>)}</select></label>
              </div>
              <label className="contact-field"><span>تفاصيل الرسالة <b>*</b></span><textarea required minLength={10} maxLength={1500} rows={6} value={form.message} onChange={e => update("message", e.target.value)} placeholder="اشرح لنا ما الذي حدث، وأضف رقم الطلب إن كان ذلك مفيداً..."/><small className="text-left" dir="ltr">{form.message.length}/1500</small></label>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="max-w-sm text-xs leading-6 text-slate-400">بالإرسال، أنت تستخدم نموذجاً تجريبياً ولا يتم حفظ بياناته بعد تحديث الصفحة.</p><button type="submit" className="btn btn-primary min-w-40 rounded-xl"><Send size={17}/> إرسال تجريبي</button></div>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}

function ShieldCheckIcon() { return <ShieldCheck size={20}/>; }
