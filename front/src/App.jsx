import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "./features/AuthProvider";
import { PublicLayout, DashboardLayout } from "./components/Layouts";
import { Home, Stations as PublicStations } from "./pages/Public";
import { Contact } from "./pages/Contact";
import { Terms, Privacy } from "./pages/Legal";
import { Login, Register } from "./pages/Auth";
import { Dashboard, WalletPage, Transactions, Topups, Stations, StationDetail, Allocations, Transfers, Purchases, BankAccounts, OwnerDashboard, OwnerFinance, OwnerPrices, OwnerBankAccounts, OwnerSettlements, AttendantPurchases, AdminDashboard, AdminTopups, AdminSettlements, ApiNotAvailable } from "./pages/AppPages";
import { roleOf } from "./lib/format";

function Guard({ children, roles, membershipRole }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center">جارٍ التحقق من الجلسة...</div>;
  if (!user) return <Navigate to="/login" replace />;
  const role = roleOf(user);
  const memberships = user.station_memberships ?? user.stationMemberships ?? user.memberships ?? [];
  const hasMembership = membershipRole ? memberships.some(m => String(m.role ?? m.membership_role).toUpperCase() === membershipRole) : true;
  if (roles && !roles.includes(role)) return <Navigate to="/app" replace />;
  if (membershipRole && !hasMembership && role !== "ADMIN") return <Navigate to="/app" replace />;
  return children;
}
function StationDetailsRoute() { const { id } = useParams(); return <StationDetail stationId={id} />; }
function RoutesView() {
 return <Routes>
  <Route element={<PublicLayout/>}><Route index element={<Home/>}/><Route path="stations" element={<PublicStations/>}/><Route path="contact" element={<Contact/>}/><Route path="terms" element={<Terms/>}/><Route path="privacy" element={<Privacy/>}/></Route>
  <Route path="login" element={<Login/>}/><Route path="register" element={<Register/>}/>
  <Route path="app" element={<Guard><DashboardLayout/></Guard>}>
   <Route index element={<Dashboard/>}/>
   <Route path="wallet" element={<WalletPage/>}/><Route path="transactions" element={<Transactions/>}/><Route path="topups" element={<Topups/>}/>
   <Route path="stations" element={<Stations/>}/><Route path="stations/:id" element={<StationDetailsRoute/>}/><Route path="allocations" element={<Allocations/>}/><Route path="transfers" element={<Transfers/>}/><Route path="purchases" element={<Purchases/>}/><Route path="bank-accounts" element={<BankAccounts/>}/>
   <Route path="owner" element={<Guard membershipRole="OWNER"><OwnerDashboard/></Guard>}/><Route path="owner/finance" element={<Guard membershipRole="OWNER"><OwnerFinance/></Guard>}/><Route path="owner/prices" element={<Guard membershipRole="OWNER"><OwnerPrices/></Guard>}/><Route path="owner/bank-accounts" element={<Guard membershipRole="OWNER"><OwnerBankAccounts/></Guard>}/><Route path="owner/settlements" element={<Guard membershipRole="OWNER"><OwnerSettlements/></Guard>}/>
   <Route path="attendant/purchases" element={<Guard membershipRole="ATTENDANT"><AttendantPurchases/></Guard>}/>
   <Route path="admin" element={<Guard roles={["ADMIN"]}><AdminDashboard/></Guard>}/><Route path="admin/topups" element={<Guard roles={["ADMIN"]}><AdminTopups/></Guard>}/><Route path="admin/settlements" element={<Guard roles={["ADMIN"]}><AdminSettlements/></Guard>}/>
   <Route path="withdrawals" element={<ApiNotAvailable title="السحب البنكي" desc="سحب الرصيد المتاح من المحفظة."/>}/><Route path="deallocations" element={<ApiNotAvailable title="فك تخصيص الرصيد" desc="إرجاع الرصيد غير المحجوز من المحطة إلى الرصيد المتاح."/>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>;
}
export default function App(){return <RoutesView/>;}
