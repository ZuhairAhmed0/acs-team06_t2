import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Menu, X, LayoutDashboard, Wallet, Fuel, ArrowLeftRight, Receipt, LogOut, PlusCircle, Building2, Settings, ClipboardCheck, Banknote, ShoppingCart, Landmark, Home as HomeIcon } from "lucide-react";
import Logo from "./Logo";
import { useAuth } from "../features/AuthProvider";
import { roleOf } from "../lib/format";

export function PublicLayout(){
 return <div dir="rtl" className="min-h-screen">
  <header className="public-header sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
   <div className="shell flex h-20 items-center justify-between gap-4">
    <Link to="/" className="shrink-0"><Logo/></Link>
    <nav className="hidden items-center gap-6 text-sm lg:flex"><Link to="/">الرئيسية</Link><a href="/#how">كيف يعمل؟</a><Link to="/stations">المحطات</Link><Link to="/contact">تواصل معنا</Link><Link to="/terms">الشروط</Link><Link to="/privacy">الخصوصية</Link></nav>
    <div className="flex shrink-0 gap-2"><Link className="btn btn-ghost" to="/login">دخول</Link><Link className="btn btn-primary rounded-xl" to="/register">إنشاء حساب</Link></div>
   </div>
  </header>
  <Outlet/>
  <footer className="site-footer mt-12 py-14 text-slate-200">
   <div className="shell grid gap-9 md:grid-cols-3">
    <div><Logo light/><p className="mt-4 max-w-sm text-sm leading-8 text-slate-200/85">محفظة رقمية لإدارة رصيد الوقود واستخدامه في المحطات المشاركة. تجربة أسهل وعمليات أوضح في مكان واحد.</p></div>
    <div><b className="text-white">روابط سريعة</b><div className="mt-4 grid gap-3 text-sm"><Link to="/">الصفحة الرئيسية</Link><Link to="/stations">المحطات</Link><Link to="/contact">تواصل معنا</Link><Link to="/terms">الشروط والأحكام</Link><Link to="/privacy">سياسة الخصوصية</Link></div></div>
    <div><b className="text-white">تنويه مهم</b><p className="mt-4 text-sm leading-8 text-slate-200/85">عرض المحطة لا يضمن توفر الوقود. التحويلات البنكية تتم خارج النظام في النسخة الأولية، وتخضع طلبات الشحن للتحقق اليدوي.</p></div>
   </div>
   <div className="shell mt-10 border-t border-white/20 pt-5 text-xs text-slate-300">© {new Date().getFullYear()} وين الوقود؟ — جميع الحقوق محفوظة</div>
  </footer>
 </div>;
}

const driverLinks=[ ["/app","الرئيسية",LayoutDashboard],["/app/wallet","المحفظة",Wallet],["/app/topups","طلبات الشحن",PlusCircle],["/app/bank-accounts","حساباتي البنكية",Landmark],["/app/stations","المحطات",Fuel],["/app/allocations","التخصيصات",Wallet],["/app/transfers","تحويل بين المحطات",ArrowLeftRight],["/app/purchases","شراء الوقود",ShoppingCart],["/app/transactions","المعاملات",Receipt] ];
const ownerLinks=[["/app/owner","نظرة عامة",LayoutDashboard],["/app/owner/finance","المالية والتسويات",Banknote],["/app/owner/settlements","سجل التسويات",Receipt],["/app/owner/prices","أسعار الوقود",Fuel],["/app/owner/bank-accounts","الحساب البنكي",Landmark]];
const attendantLinks=[["/app/attendant/purchases","طلبات صرف الوقود",ClipboardCheck]];
const adminLinks=[["/app/admin","نظرة عامة",LayoutDashboard],["/app/admin/topups","مراجعة الشحن",Receipt],["/app/admin/settlements","التسويات",Banknote]];
const platformHomeLink=["/","الصفحة الرئيسية",HomeIcon];
export function DashboardLayout(){
 const [open,setOpen]=useState(false); const {user,logout}=useAuth(); const navigate=useNavigate(); const role=roleOf(user);
 const memberships=user?.station_memberships??user?.stationMemberships??user?.memberships??[];
 const links=[platformHomeLink,...(role==="ADMIN"?adminLinks:[...driverLinks,...(memberships.some(m=>String(m.role??m.membership_role).toUpperCase()==="OWNER")?ownerLinks:[]),...(memberships.some(m=>String(m.role??m.membership_role).toUpperCase()==="ATTENDANT")?attendantLinks:[])])];
 return <div dir="rtl" className="dashboard-shell min-h-screen bg-[#f4f7f9]">
  {open&&<button aria-label="إغلاق القائمة" className="sidebar-backdrop fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={()=>setOpen(false)}/>}
  <aside className={`dashboard-sidebar fixed inset-y-0 right-0 z-50 flex w-72 max-w-[86vw] flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-300 lg:translate-x-0 lg:shadow-none ${open?"translate-x-0":"translate-x-full lg:translate-x-0"}`}>
   <div className="flex h-20 shrink-0 items-center justify-between border-b border-slate-100 px-5"><Logo/><button className="btn btn-ghost btn-sm lg:hidden" onClick={()=>setOpen(false)} aria-label="إغلاق القائمة"><X size={19}/></button></div>
   <nav className="dashboard-nav min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
    <p className="px-3 pb-2 pt-1 text-[11px] font-bold tracking-wide text-slate-400">روابط المنصة ومساحة العمل</p>
    <div className="grid gap-1.5">{links.map(([to,label,Icon])=><NavLink end={to==="/"||to==="/app"||to==="/app/owner"||to==="/app/admin"} key={to} to={to} onClick={()=>setOpen(false)} className={({isActive})=>`dashboard-nav-link group flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3 text-sm leading-6 ${isActive?"active":"text-slate-600"}`}><Icon className="shrink-0" size={19}/><span className="min-w-0 flex-1 whitespace-normal break-words">{label}</span></NavLink>)}</div>
   </nav>
   <div className="dashboard-account shrink-0 border-t border-slate-100 bg-white p-4">
    <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl bg-slate-50 p-3"><div className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-100 font-bold text-[#087f70]">{String(user?.full_name||user?.name||"م").trim().slice(0,1)}</div><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{user?.full_name||user?.name||"حساب المستخدم"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{user?.phone||""}</p></div></div>
    <button className="btn btn-ghost w-full justify-start rounded-xl text-rose-600 hover:bg-rose-50" onClick={async()=>{try{await logout();navigate("/login",{replace:true});}catch{navigate("/login",{replace:true});}}}><LogOut size={18}/>تسجيل الخروج</button>
   </div>
  </aside>
  <div className="min-w-0 lg:mr-72">
   <header className="dashboard-topbar sticky top-0 z-30 flex h-20 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-7"><div className="flex min-w-0 items-center gap-3"><button aria-label="فتح القائمة" className="btn btn-ghost btn-square lg:hidden" onClick={()=>setOpen(true)}><Menu/></button><div><b className="block">مساحة العمل</b><span className="text-xs text-slate-400">مرحباً بعودتك</span></div></div><span className="max-w-[42vw] truncate rounded-full bg-slate-50 px-3 py-2 text-xs text-slate-500">{user?.phone||""}</span></header>
   <main className="min-w-0 p-4 md:p-7 xl:p-8"><Outlet/></main>
  </div>
 </div>;
}
