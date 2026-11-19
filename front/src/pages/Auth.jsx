import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import Logo from "../components/Logo";
import { useAuth } from "../features/AuthProvider";
import { errorMessage } from "../lib/api";
import { roleOf } from "../lib/format";

const loginSchema = z.object({ phone: z.string().min(7, "أدخل رقم هاتف صحيحاً"), password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل") });
const registerSchema = z.object({ full_name: z.string().min(3, "أدخل الاسم كاملاً"), phone: z.string().min(7, "أدخل رقم هاتف صحيحاً"), password: z.string().min(12, "كلمة المرور 12 حرفاً على الأقل"), password_confirmation: z.string().min(12, "أعد كتابة كلمة المرور") }).refine(v => v.password === v.password_confirmation, { path: ["password_confirmation"], message: "كلمتا المرور غير متطابقتين" });

export function Login() {
  const { login } = useAuth(), nav = useNavigate(), [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(loginSchema) });
  async function submit(values) { setBusy(true); try { const user = await login(values); toast.success("تم تسجيل الدخول بنجاح"); nav(roleOf(user) === "ADMIN" ? "/app/admin/topups" : "/app", { replace: true }); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }
  return <AuthShell title="مرحباً بعودتك"><form onSubmit={handleSubmit(submit)} className="grid gap-4"><Field label="رقم الهاتف" error={errors.phone?.message}><input autoComplete="tel" className="input input-bordered w-full" {...register("phone")} /></Field><Field label="كلمة المرور" error={errors.password?.message}><input type="password" autoComplete="current-password" className="input input-bordered w-full" {...register("password")} /></Field><button className="btn btn-primary w-full" disabled={busy}>{busy ? "جارٍ الدخول..." : "تسجيل الدخول"}</button></form><p className="mt-5 text-center text-sm">ليس لديك حساب؟ <Link className="text-[#087f70]" to="/register">إنشاء حساب</Link></p></AuthShell>;
}

export function Register() {
  const { register: createAccount } = useAuth(), nav = useNavigate(), [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(registerSchema) });
  async function submit(values) { setBusy(true); try { const { password_confirmation, ...body } = values; await createAccount(body); toast.success("تم إنشاء الحساب. سجّل الدخول للمتابعة."); nav("/login"); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }
  return <AuthShell title="إنشاء حساب جديد"><form onSubmit={handleSubmit(submit)} className="grid gap-4"><Field label="الاسم الكامل" error={errors.full_name?.message}><input className="input input-bordered w-full" autoComplete="name" {...register("full_name")} /></Field><Field label="رقم الهاتف" error={errors.phone?.message}><input className="input input-bordered w-full" autoComplete="tel" {...register("phone")} /></Field><Field label="كلمة المرور" error={errors.password?.message}><input type="password" className="input input-bordered w-full" autoComplete="new-password" {...register("password")} /></Field><Field label="تأكيد كلمة المرور" error={errors.password_confirmation?.message}><input type="password" className="input input-bordered w-full" autoComplete="new-password" {...register("password_confirmation")} /></Field><button className="btn btn-primary w-full" disabled={busy}>{busy ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}</button></form><p className="mt-5 text-center text-sm">لديك حساب؟ <Link className="text-[#087f70]" to="/login">تسجيل الدخول</Link></p></AuthShell>;
}
function Field({ label, error, children }) { return <label><span className="mb-2 block text-sm">{label}</span>{children}{error && <small className="text-rose-600">{error}</small>}</label>; }
function AuthShell({ title, children }) { return <main dir="rtl" className="grid min-h-screen place-items-center p-4"><div className="surface w-full max-w-md p-8"><Link to="/"><Logo /></Link><h1 className="mb-6 mt-8 text-2xl font-bold">{title}</h1>{children}<p className="mt-7 text-center text-xs text-slate-400">بالمتابعة توافق على <Link className="text-[#087f70]" to="/terms">سياسة الاستخدام</Link> و<Link className="text-[#087f70]" to="/privacy">الخصوصية</Link>.</p></div></main>; }
