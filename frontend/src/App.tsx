import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { RABWorkOrderLedgerView } from "./components/RABWorkOrderLedgerView";
import { RABillDetail } from "./components/RABillDetail";
import { RABInvoiceDetail } from "./components/RABInvoiceDetail";
import { PaymentEntryDetail } from "./components/PaymentEntryDetail";
import { CreateUploadRecords } from "./components/CreateUploadRecords";
import { UserProfileDropdown } from "./components/UserProfileDropdown";
import { ItemLinkDropdown } from "./components/ItemLinkDropdown";
import { DocLinkDropdown } from "./components/DocLinkDropdown";
import {
	FrappeProvider,
	useFrappeAuth,
	useFrappeGetDocList,
	useFrappeGetDoc,
	useFrappeCreateDoc,
	useFrappeGetCall,
} from "frappe-react-sdk";
import {
	LayoutDashboard,
	FolderGit2,
	Receipt,
	FileCheck,
	CreditCard,
	Settings,
	Plus,
	RefreshCw,
	Eye,
	ArrowLeft,
	Search,
	UploadCloud,
	Layers,
	Bell,
	MessageSquare,
	Calendar,
	Star,
	Trash2,
	Save,
	Sun,
	Moon,
	TrendingUp,
	Coins,
	CheckCircle2,
	X,
	Info,
} from "lucide-react";

type NavTab =
	| "dashboard"
	| "create_upload"
	| "ra_bill"
	| "pi"
	| "pe"
	| "rab_ledger"
	| "settings";

const formatCurrency = (amount: number | undefined | null, currency = "INR") => {
	if (amount === undefined || amount === null) return "₹0.00";
	const isNegative = amount < 0;
	const formatted = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: currency || "INR",
		maximumFractionDigits: 2,
	}).format(Math.abs(amount));
	return isNegative ? `- ${formatted}` : formatted;
};
import { callFrappeMethod, parseFrappeError } from "./utils/frappeErrors";

// Official TRIDASA® Brand Logo Component (Dual Light / Dark Mode)
const TridasaLogo = ({ className = "" }: { className?: string }) => (
	<div className={`flex items-center gap-3 ${className}`}>
		<div className="bg-white p-2 rounded-xl shadow-xs border border-slate-200/80 flex items-center justify-center shrink-0">
			<svg viewBox="0 0 140 140" className="w-7 h-7" fill="none" xmlns="http://www.w3.org/2000/svg">
				{/* Left Navy Angled Bars */}
				<path d="M45 35 H80 L62 52 H27 L45 35 Z" fill="#1b365d" />
				<path d="M45 62 H80 L62 79 H27 L45 62 Z" fill="#1b365d" />
				<path d="M45 89 H80 L62 106 H27 L45 89 Z" fill="#1b365d" />
				{/* Right Red Angled Bars */}
				<path d="M82 25 H117 L99 42 H64 L82 25 Z" fill="#e64646" />
				<path d="M82 52 H117 L99 69 H64 L82 52 Z" fill="#e64646" />
				<path d="M82 79 H117 L99 96 H64 L82 79 Z" fill="#e64646" />
			</svg>
		</div>
		<div className="overflow-hidden">
			<div className="flex items-center">
				<span className="text-base font-black tracking-wider text-slate-900 dark:text-white">TRIDASA</span>
				<span className="text-[10px] font-bold ml-0.5 text-slate-600 dark:text-indigo-400">®</span>
			</div>
			<p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 leading-tight">Brightening lives</p>
		</div>
	</div>
);

export function PortalApp() {
	const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
	const [selectedWO, setSelectedWO] = useState<string | null>(null);
	const [selectedBill, setSelectedBill] = useState<string | null>(null);
	const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
	const [selectedPaymentEntryId, setSelectedPaymentEntryId] = useState<string | null>(null);
	const [isCreatingWO, setIsCreatingWO] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");

	// Theme Toggle System (Persistent in localStorage, defaults to dark)
	const [theme, setTheme] = useState<"dark" | "light">(() => {
		const saved = localStorage.getItem("theme");
		return saved === "light" ? "light" : "dark";
	});

	useEffect(() => {
		if (theme === "dark") {
			document.documentElement.classList.add("dark");
		} else {
			document.documentElement.classList.remove("dark");
		}
		localStorage.setItem("theme", theme);
	}, [theme]);

	const toggleTheme = () => {
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	};

	const { currentUser } = useFrappeAuth();

	// Fetch RA Bills from Frappe backend
	const {
		data: raBills,
		isLoading: isLoadingRABills,
		mutate: refreshRABills,
	} = useFrappeGetDocList("RA Bill", {
		fields: [
			"name",
			"project",
			"boq",
			"bill_type",
			"ra_bill_no",
			"posting_date",
			"gross_work_value",
			"cumulative_work_value",
			"total_deductions",
			"net_payable",
			"gst_amount",
			"retention_amount",
			"tds_amount",
			"mobilization_recovery_amount",
			"customer",
			"supplier",
			"docstatus",
			"company",
		],
		orderBy: { field: "creation", order: "desc" },
		limit: 0,
	});

	// Fetch RAB Work Orders from Frappe backend
	const {
		data: workOrders,
		isLoading: isLoadingWO,
		mutate: refreshWO,
	} = useFrappeGetDocList("RAB Work Order", {
		fields: [
			"name",
			"project",
			"boq_type",
			"customer",
			"supplier",
			"contract_date",
			"billing_method",
			"status",
			"total_boq_amount",
			"contract_value",
			"mobilization_advance_amount",
			"defect_liability_period_days",
		],
		orderBy: { field: "creation", order: "desc" },
		limit: 0,
	});

	// Fetch all advances across all Work Orders to ensure all advance types are accounted for
	// Uses whitelisted backend endpoint to avoid PermissionError on child table frappe.client.get_list
	const {
		data: allAdvancesRes,
		mutate: refreshAdvances,
	} = useFrappeGetCall<any>("ra_bill.api.get_work_order_advances");

	const allAdvances: any[] = useMemo(() => {
		if (Array.isArray(allAdvancesRes)) return allAdvancesRes;
		if (Array.isArray(allAdvancesRes?.message)) return allAdvancesRes.message;
		return [];
	}, [allAdvancesRes]);

	// Index advances by parent Work Order name
	const advancesByWO = useMemo(() => {
		const map: Record<string, any[]> = {};
		allAdvances.forEach((adv: any) => {
			if (adv.parent) {
				if (!map[adv.parent]) map[adv.parent] = [];
				map[adv.parent].push(adv);
			}
		});
		return map;
	}, [allAdvances]);

	// Navigation Tabs (GL & RAB Work Orders tab removed completely)
	const navItems = [
		{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
		{ id: "create_upload", label: "Create/Upload Records", icon: UploadCloud },
		{ id: "ra_bill", label: "RA Bills", icon: Receipt, badge: raBills?.length },
		{ id: "pi", label: "RAB Invoice", icon: FileCheck },
		{ id: "pe", label: "Payment Entries (PE)", icon: CreditCard },
		{ id: "rab_ledger", label: "RAB Work Order Ledger", icon: Layers },
		{ id: "settings", label: "Settings", icon: Settings },
	];

	const getStatusBadge = (docstatus: number | string) => {
		if (typeof docstatus === "string") {
			return (
				<span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-[#28c76f] border border-emerald-500/30">
					{docstatus}
				</span>
			);
		}
		switch (docstatus) {
			case 0:
				return (
					<span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-[#ff9f43] border border-amber-500/30">
						Draft
					</span>
				);
			case 1:
				return (
					<span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-[#28c76f] border border-emerald-500/30">
						Approved
					</span>
				);
			case 2:
				return (
					<span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-600 dark:text-[#ea5455] border border-rose-500/30">
						Cancelled
					</span>
				);
			default:
				return null;
		}
	};

	// Portfolio Metrics Calculation
	const dashboardMetrics = useMemo(() => {
		const totalWO = workOrders?.length || 0;
		const totalContractVal = workOrders?.reduce(
			(acc, wo) => acc + Number(wo.contract_value || wo.total_boq_amount || 0),
			0
		) || 0;

		const totalGrossBilled = raBills?.reduce(
			(acc, r) => acc + Number(r.gross_work_value || 0),
			0
		) || 0;

		const totalPendingToBill = Math.max(0, totalContractVal - totalGrossBilled);

		// Sum ALL advance types across ALL Work Orders' advances
		const childAdvancesSum = (allAdvances || []).reduce(
			(sum: number, adv: any) => sum + Number(adv.amount || 0),
			0
		);

		// Fallback for any legacy Work Orders with flat mobilization_advance_amount but no child rows
		const legacyFallbackSum = (workOrders || []).reduce((acc: number, wo: any) => {
			const hasChildRows = advancesByWO[wo.name] && advancesByWO[wo.name].length > 0;
			return hasChildRows ? acc : acc + Number(wo.mobilization_advance_amount || 0);
		}, 0);

		const totalAdvancesDisbursed = childAdvancesSum + legacyFallbackSum;

		const totalAdvanceRecovered = raBills?.reduce(
			(acc, r) => acc + Number(r.mobilization_recovery_amount || 0),
			0
		) || 0;

		const totalAdvancePending = Math.max(0, totalAdvancesDisbursed - totalAdvanceRecovered);

		return {
			totalWO,
			totalContractVal,
			totalGrossBilled,
			totalPendingToBill,
			totalAdvancesDisbursed,
			totalAdvancePending,
		};
	}, [workOrders, raBills, allAdvances, advancesByWO]);

	// Map connected RA Bills for each Work Order
	const woBilledMap = useMemo(() => {
		const map: Record<string, { grossBilled: number; count: number; advanceRecovered: number }> = {};
		if (raBills) {
			raBills.forEach((r) => {
				if (r.boq) {
					if (!map[r.boq]) {
						map[r.boq] = { grossBilled: 0, count: 0, advanceRecovered: 0 };
					}
					map[r.boq].grossBilled += Number(r.gross_work_value || 0);
					map[r.boq].advanceRecovered += Number(r.mobilization_recovery_amount || 0);
					map[r.boq].count += 1;
				}
			});
		}
		return map;
	}, [raBills]);

	return (
		<div className="min-h-screen bg-slate-50 dark:bg-[#151521] text-slate-800 dark:text-slate-100 font-sans flex antialiased transition-colors duration-200">

			{/* SIDEBAR NAVIGATION */}
			<aside className="w-64 bg-white dark:bg-[#1e1e2d] border-r border-slate-200 dark:border-[#2d2d3f] flex flex-col justify-between shrink-0 sticky top-0 h-screen z-30 transition-colors duration-200">
				<div>
					{/* TRIDASA Brand Logo Header */}
					<div className="p-4 border-b border-slate-200 dark:border-[#2d2d3f]">
						<TridasaLogo />
					</div>

					{/* Navigation Links */}
					<nav className="p-3 space-y-1">
						{navItems.map((item) => {
							const Icon = item.icon;
							const isActive = activeTab === item.id;
							return (
								<button
									key={item.id}
									onClick={() => {
										setActiveTab(item.id as NavTab);
										setSelectedWO(null);
										setSelectedBill(null);
										setSelectedInvoiceId(null);
										setSelectedPaymentEntryId(null);
										setIsCreatingWO(false);
									}}
									className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${isActive
											? "bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] border-r-4 border-indigo-600 dark:border-[#7367f0] shadow-xs"
											: "text-slate-600 dark:text-[#8f93a7] hover:bg-slate-100 dark:hover:bg-[#282a42] hover:text-slate-900 dark:hover:text-white"
										}`}
								>
									<div className="flex items-center gap-3">
										<Icon size={18} className={isActive ? "text-indigo-600 dark:text-[#7367f0]" : "text-slate-400 dark:text-[#8f93a7]"} />
										<span>{item.label}</span>
									</div>
									{item.badge !== undefined && item.badge > 0 && (
										<span
											className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isActive
													? "bg-indigo-600 dark:bg-[#7367f0] text-white"
													: "bg-slate-200 dark:bg-[#282a42] text-slate-700 dark:text-[#8f93a7]"
												}`}
										>
											{item.badge}
										</span>
									)}
								</button>
							);
						})}
					</nav>
				</div>

				{/* Sidebar Footer: Theme Toggle & User Card */}
				<div className="p-3 border-t border-slate-200 dark:border-[#2d2d3f] space-y-2">
					<button
						onClick={toggleTheme}
						className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-[#8f93a7] hover:bg-slate-100 dark:hover:bg-[#282a42] transition border border-slate-200 dark:border-[#32344d]"
					>
						<div className="flex items-center gap-2">
							{theme === "dark" ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-indigo-600" />}
							<span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
						</div>
						<div className={`w-8 h-4 rounded-full p-0.5 transition ${theme === "dark" ? "bg-[#7367f0]" : "bg-slate-300"}`}>
							<div className={`w-3 h-3 rounded-full bg-white transition transform ${theme === "dark" ? "translate-x-4" : ""}`} />
						</div>
					</button>

					<UserProfileDropdown align="up" />
				</div>
			</aside>

			{/* MAIN CONTENT AREA */}
			<div className="flex-1 flex flex-col min-w-0">

				{/* TOP HEADER BAR */}
				<header className="h-16 bg-white dark:bg-[#1e1e2d] border-b border-slate-200 dark:border-[#2d2d3f] px-6 flex items-center justify-between sticky top-0 z-20 shadow-xs transition-colors duration-200">
					<div className="flex items-center gap-4 text-slate-500 dark:text-[#8f93a7]">
						<button className="hover:text-slate-900 dark:hover:text-white transition"><MessageSquare size={18} /></button>
						<button className="hover:text-slate-900 dark:hover:text-white transition"><Calendar size={18} /></button>
						<button className="hover:text-slate-900 dark:hover:text-white transition"><Star size={18} /></button>
						<div className="relative">
							<button className="hover:text-slate-900 dark:hover:text-white transition"><Bell size={18} /></button>
							<span className="w-2 h-2 rounded-full bg-rose-500 absolute -top-0.5 -right-0.5 ring-2 ring-white dark:ring-[#1e1e2d]"></span>
						</div>

						<div className="h-4 w-[1px] bg-slate-200 dark:bg-[#2d2d3f] mx-1"></div>

						<div className="relative w-64 hidden sm:block">
							<Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#8f93a7]" />
							<input
								type="text"
								placeholder="Search (⌘K)"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-100 dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-[#8f93a7] focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0] transition"
							/>
						</div>
					</div>

					<div className="flex items-center gap-4">
						<button
							onClick={() => {
								refreshRABills();
								refreshWO();
							}}
							className="p-2 bg-slate-100 dark:bg-[#232333] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-600 dark:text-[#8f93a7] dark:hover:text-white rounded-xl border border-slate-200 dark:border-[#32344d] transition"
							title="Refresh Data"
						>
							<RefreshCw size={16} className={isLoadingRABills || isLoadingWO ? "animate-spin" : ""} />
						</button>

						<button
							onClick={() => {
								setSelectedWO(null);
								setSelectedBill(null);
								setIsCreatingWO(true);
							}}
							className="flex items-center gap-2 px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-semibold text-xs rounded-xl shadow-md transition"
						>
							<Plus size={16} />
							<span>+ New RAB Work Order</span>
						</button>
					</div>
				</header>

				{/* SCROLLABLE MAIN DASHBOARD CANVAS */}
				<main className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-50 dark:bg-[#151521] transition-colors duration-200">
					{isCreatingWO ? (
						<CreateRABWorkOrderForm
							onCancel={() => setIsCreatingWO(false)}
							onSuccess={(newWoName) => {
								setIsCreatingWO(false);
								if (newWoName) {
									setSelectedWO(newWoName);
								}
								refreshWO();
							}}
						/>
					) : selectedPaymentEntryId ? (
						<PaymentEntryDetail
							paymentEntryId={selectedPaymentEntryId}
							onBack={() => setSelectedPaymentEntryId(null)}
							onSelectInvoice={(invId) => {
								setSelectedPaymentEntryId(null);
								setSelectedInvoiceId(invId);
							}}
							onSelectWO={(woId) => {
								setSelectedPaymentEntryId(null);
								setSelectedWO(woId);
							}}
						/>
					) : selectedInvoiceId ? (
						<RABInvoiceDetail
							invoiceId={selectedInvoiceId}
							onBack={() => setSelectedInvoiceId(null)}
							onSelectPaymentEntry={(peId) => {
								setSelectedInvoiceId(null);
								setSelectedBill(null);
								setSelectedWO(null);
								setActiveTab("pe");
								setSelectedPaymentEntryId(peId);
							}}
						/>
					) : selectedBill ? (
						<RABillDetail
							billId={selectedBill}
							onBack={() => setSelectedBill(null)}
							onSelectBill={(siblingBillId) => setSelectedBill(siblingBillId)}
							onCreateInvoiceSuccess={(invoiceId) => {
								setSelectedBill(null);
								setSelectedWO(null);
								setSelectedPaymentEntryId(null);
								setActiveTab("pi");
								setSelectedInvoiceId(invoiceId);
							}}
						/>
					) : selectedWO ? (
						<RABWorkOrderDetail
							docName={selectedWO}
							onBack={() => setSelectedWO(null)}
							onSelectBill={(billName) => setSelectedBill(billName)}
							onNavigateToPE={() => {
								setSelectedWO(null);
								setActiveTab("pe");
							}}
							onAdvancesUpdated={() => refreshAdvances()}
						/>
					) : (
						<>
							{/* DASHBOARD VIEW (RAB Work Orders Portfolio Focus) */}
							{activeTab === "dashboard" && (
								<div className="space-y-6">

									{/* Top Metric Cards Strip */}
									<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
										<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] p-5 rounded-2xl shadow-sm space-y-2">
											<div className="flex justify-between items-center text-slate-500 dark:text-[#8f93a7]">
												<span className="text-[11px] font-bold uppercase tracking-wider">Total Work Orders</span>
												<FolderGit2 size={18} className="text-indigo-600 dark:text-[#7367f0]" />
											</div>
											<p className="text-2xl font-black text-slate-900 dark:text-slate-100">{dashboardMetrics.totalWO}</p>
											<p className="text-[10px] text-slate-400 dark:text-[#8f93a7]">Active BOQ Contracts</p>
										</div>

										<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] p-5 rounded-2xl shadow-sm space-y-2">
											<div className="flex justify-between items-center text-slate-500 dark:text-[#8f93a7]">
												<span className="text-[11px] font-bold uppercase tracking-wider">Cumulative Contract Value</span>
												<Coins size={18} className="text-indigo-600 dark:text-[#7367f0]" />
											</div>
											<p className="text-2xl font-black text-indigo-600 dark:text-[#7367f0]">{formatCurrency(dashboardMetrics.totalContractVal)}</p>
											<p className="text-[10px] text-slate-400 dark:text-[#8f93a7]">Billed to Date: {formatCurrency(dashboardMetrics.totalGrossBilled)}</p>
										</div>

										<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] p-5 rounded-2xl shadow-sm space-y-2">
											<div className="flex justify-between items-center text-slate-500 dark:text-[#8f93a7]">
												<span className="text-[11px] font-bold uppercase tracking-wider">Balance / Pending to Bill</span>
												<TrendingUp size={18} className="text-amber-500" />
											</div>
											<p className="text-2xl font-black text-amber-600 dark:text-[#ff9f43]">{formatCurrency(dashboardMetrics.totalPendingToBill)}</p>
											<p className="text-[10px] text-slate-400 dark:text-[#8f93a7]">Unbilled Portfolio Work</p>
										</div>

										<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] p-5 rounded-2xl shadow-sm space-y-2">
											<div className="flex justify-between items-center text-slate-500 dark:text-[#8f93a7]">
												<span className="text-[11px] font-bold uppercase tracking-wider">Advances Disbursed</span>
												<CreditCard size={18} className="text-emerald-500" />
											</div>
											<p className="text-2xl font-black text-emerald-600 dark:text-[#28c76f]">{formatCurrency(dashboardMetrics.totalAdvancesDisbursed)}</p>
											<p className="text-[10px] text-rose-500 dark:text-[#ea5455] font-semibold">Pending Recovery: {formatCurrency(dashboardMetrics.totalAdvancePending)}</p>
										</div>
									</div>

									{/* RAB Work Order Portfolio Table */}
									<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl shadow-sm overflow-hidden">
										<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
											<div>
												<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">RAB Work Orders Portfolio</h3>
												<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Click any row to inspect complete contract details & connected RA Bills</p>
											</div>
											<button
												onClick={() => setIsCreatingWO(true)}
												className="px-3.5 py-1.5 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white text-xs font-semibold rounded-xl shadow-xs transition flex items-center gap-1.5"
											>
												<Plus size={14} /> New Work Order
											</button>
										</div>

										<div className="overflow-x-auto">
											<table className="w-full text-left text-xs">
												<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
													<tr>
														<th className="p-4">WO Series ID</th>
														<th className="p-4">Project</th>
														<th className="p-4">Type & Party</th>
														<th className="p-4 text-right">Contract Value</th>
														<th className="p-4 text-center">Connected RA Bills</th>
														<th className="p-4 text-right">Balance Billed</th>
														<th className="p-4 text-right">Active Advances</th>
														<th className="p-4">Status</th>
														<th className="p-4 text-center">Action</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
													{isLoadingWO ? (
														<tr>
															<td colSpan={9} className="p-12 text-center text-slate-400 dark:text-[#8f93a7]">Loading Work Orders...</td>
														</tr>
													) : workOrders?.length === 0 ? (
														<tr>
															<td colSpan={9} className="p-12 text-center text-slate-400 dark:text-[#8f93a7]">No Work Orders found.</td>
														</tr>
													) : (
														workOrders?.map((wo) => {
															const woInfo = woBilledMap[wo.name] || { grossBilled: 0, count: 0, advanceRecovered: 0 };
															const contractVal = Number(wo.contract_value || wo.total_boq_amount || 0);
															const pendingBalance = Math.max(0, contractVal - woInfo.grossBilled);
															const woAdvList = advancesByWO[wo.name] || wo.advances || [];
															const totalAdv = woAdvList.length > 0
																? woAdvList.reduce((sum: number, adv: any) => sum + Number(adv.amount || 0), 0)
																: Number(wo.mobilization_advance_amount || 0);
															const activeAdv = Math.max(0, totalAdv - woInfo.advanceRecovered);

															return (
																<tr
																	key={wo.name}
																	onClick={() => setSelectedWO(wo.name)}
																	className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition cursor-pointer group"
																>
																	<td className="p-4 font-mono font-bold text-indigo-600 dark:text-[#7367f0] group-hover:underline">
																		{wo.name}
																	</td>
																	<td className="p-4 font-medium text-slate-900 dark:text-slate-100">{wo.project}</td>
																	<td className="p-4">
																		<div className="flex flex-col">
																			<span className="font-semibold text-slate-800 dark:text-slate-200">{wo.customer || wo.supplier || "-"}</span>
																			<span className="text-[10px] text-slate-400 dark:text-[#8f93a7] font-semibold">{wo.boq_type}</span>
																		</div>
																	</td>
																	<td className="p-4 text-right font-bold text-slate-900 dark:text-slate-100">
																		{formatCurrency(contractVal)}
																	</td>
																	<td className="p-4 text-center">
																		<span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] border border-indigo-200 dark:border-[#7367f0]/30">
																			{woInfo.count} Bill(s)
																		</span>
																	</td>
																	<td className="p-4 text-right font-semibold text-amber-600 dark:text-[#ff9f43]">
																		{formatCurrency(pendingBalance)}
																	</td>
																	<td className="p-4 text-right font-semibold text-emerald-600 dark:text-[#28c76f]">
																		{formatCurrency(activeAdv)}
																	</td>
																	<td className="p-4">{getStatusBadge(wo.status || "Active")}</td>
																	<td className="p-4 text-center">
																		<button
																			onClick={(e) => {
																				e.stopPropagation();
																				setSelectedWO(wo.name);
																			}}
																			className="p-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-indigo-50 dark:hover:bg-[#7367f0]/20 text-slate-500 dark:text-[#8f93a7] hover:text-indigo-600 dark:hover:text-[#7367f0] rounded-lg transition"
																		>
																			<Eye size={16} />
																		</button>
																	</td>
																</tr>
															);
														})
													)}
												</tbody>
											</table>
										</div>
									</div>
								</div>
							)}

							{/* CREATE/UPLOAD RECORDS TAB */}
							{activeTab === "create_upload" && (
								<CreateUploadRecords
									onOpenCreateWO={() => setIsCreatingWO(true)}
									onOpenCreateRABill={() => setIsCreatingWO(true)}
								/>
							)}

							{/* RA BILLS FULL TAB */}
							{activeTab === "ra_bill" && (
								<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl shadow-sm overflow-hidden">
									<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
										<div>
											<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">All Running Account (RA) Bills</h3>
											<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Valuation & Billing Records</p>
										</div>
									</div>
									<div className="overflow-x-auto">
										<table className="w-full text-left text-xs">
											<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
												<tr>
													<th className="p-4">Bill ID</th>
													<th className="p-4">RA No.</th>
													<th className="p-4">Project</th>
													<th className="p-4">Work Order (BOQ)</th>
													<th className="p-4">Posting Date</th>
													<th className="p-4 text-right">Gross Work</th>
													<th className="p-4 text-right">Net Payable</th>
													<th className="p-4">Status</th>
													<th className="p-4 text-center">Action</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
												{raBills?.map((row) => (
													<tr key={row.name} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
														<td className="p-4 font-mono font-bold text-indigo-600 dark:text-[#7367f0]">{row.name}</td>
														<td className="p-4 font-semibold text-slate-700 dark:text-slate-200">RA #{row.ra_bill_no || "-"}</td>
														<td className="p-4 font-medium text-slate-900 dark:text-slate-100">{row.project}</td>
														<td className="p-4 font-mono text-slate-500 dark:text-[#8f93a7]">{row.boq}</td>
														<td className="p-4 text-slate-500 dark:text-[#8f93a7]">{row.posting_date}</td>
														<td className="p-4 text-right font-medium text-slate-800 dark:text-slate-200">
															{formatCurrency(row.gross_work_value)}
														</td>
														<td className="p-4 text-right font-bold text-slate-900 dark:text-slate-100">
															{formatCurrency(row.net_payable)}
														</td>
														<td className="p-4">{getStatusBadge(row.docstatus)}</td>
														<td className="p-4 text-center">
															<button
																onClick={() => setSelectedBill(row.name)}
																className="p-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-indigo-50 dark:hover:bg-[#7367f0]/20 text-slate-500 dark:text-[#8f93a7] hover:text-indigo-600 dark:hover:text-[#7367f0] rounded-lg transition"
															>
																<Eye size={16} />
															</button>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}

							{/* RAB INVOICE (PI) TAB */}
							{activeTab === "pi" && (
								<RABInvoiceListView onSelectInvoice={(invoiceId) => setSelectedInvoiceId(invoiceId)} />
							)}

							{activeTab === "pe" && (
								<GenericAccountingList
									title="Payment Entries (PE)"
									doctype="Payment Entry"
									fields={["name", "payment_type", "party", "paid_amount", "posting_date"]}
									onRowSelect={(id) => setSelectedPaymentEntryId(id)}
									onSelectEntry={(id) => setSelectedPaymentEntryId(id)}
								/>
							)}

							{activeTab === "rab_ledger" && (
								<RABWorkOrderLedgerView
									initialWorkOrder={selectedWO || undefined}
									onSelectWO={(woId) => setSelectedWO(woId)}
									onSelectBill={(billId) => setSelectedBill(billId)}
									onSelectInvoice={(invoiceId) => setSelectedInvoiceId(invoiceId)}
									onSelectPaymentEntry={(paymentId) => setSelectedPaymentEntryId(paymentId)}
								/>
							)}

							{/* SETTINGS VIEW */}
							{activeTab === "settings" && (
								<div className="bg-white dark:bg-[#232333] p-6 rounded-2xl border border-slate-200/80 dark:border-[#32344d] shadow-sm space-y-4">
									<h3 className="text-base font-bold text-slate-900 dark:text-slate-100">RA Bill System Configuration</h3>
									<p className="text-xs text-slate-500 dark:text-[#8f93a7]">
										Frappe site connection: <span className="font-mono text-indigo-600 dark:text-[#7367f0] font-bold">frappe.local</span>
									</p>
									<div className="p-4 bg-slate-50 dark:bg-[#1e1e2d] rounded-xl border border-slate-200 dark:border-[#2d2d3f] text-xs space-y-2 text-slate-700 dark:text-slate-300">
										<p><strong>App Name:</strong> TRIDASA RA Valuation Suite</p>
										<p><strong>Version:</strong> 1.0.0 (Production-Grade Dual Theme)</p>
										<p><strong>Active User:</strong> {currentUser || "Administrator"}</p>
										<p><strong>Status:</strong> Connected to Frappe Backend</p>
									</div>
								</div>
							)}
						</>
					)}
				</main>
			</div>
		</div>
	);
}

// ----------------------------------------------------------------------
// FULL RAB WORK ORDER DETAIL INSPECTION VIEW (RABWorkOrderDetail)
// ----------------------------------------------------------------------
function RABWorkOrderDetail({
	docName,
	onBack,
	onSelectBill,
	onNavigateToPE,
	onAdvancesUpdated,
}: {
	docName: string;
	onBack: () => void;
	onSelectBill: (billName: string) => void;
	onNavigateToPE: () => void;
	onAdvancesUpdated?: () => void;
}) {
	const { data: wo, isLoading: isLoadingWO, mutate: mutateWO } = useFrappeGetDoc("RAB Work Order", docName);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isCreatingBill, setIsCreatingBill] = useState(false);
	const [createBillInfoMessage, setCreateBillInfoMessage] = useState<string | null>(null);

	// ── Advance dialog state ────────────────────────────────────────────────
	const [showAdvanceDialog, setShowAdvanceDialog] = useState(false);
	const [advanceType, setAdvanceType] = useState<"Mobilization Advance" | "Ad Hoc Advance" | "Other">("Mobilization Advance");
	const [advanceDescription, setAdvanceDescription] = useState("");
	const [advanceAmount, setAdvanceAmount] = useState<number | "">("");
	const [isCreatingAdvance, setIsCreatingAdvance] = useState(false);
	const [creatingPEForRow, setCreatingPEForRow] = useState<number | null>(null);

	// ── Payment Entry creation dialog state ─────────────────────────────────
	const [peDialogRow, setPeDialogRow] = useState<{ advance: any; rowIndex: number } | null>(null);
	const [mopList, setMopList] = useState<Array<{ name: string; type: string }>>([]);
	const [selectedMop, setSelectedMop] = useState("");
	const [mopAccountType, setMopAccountType] = useState<"Bank" | "Cash" | "">("" );
	const [paidFromAccount, setPaidFromAccount] = useState("");
	const [pePostingDate, setPePostingDate] = useState(new Date().toISOString().split("T")[0]);
	const [peReferenceNo, setPeReferenceNo] = useState("");
	const [peReferenceDate, setPeReferenceDate] = useState(new Date().toISOString().split("T")[0]);
	const [isSubmittingPE, setIsSubmittingPE] = useState(false);
	const [peError, setPeError] = useState("");

	// ── Deviation Tolerance edit state ──────────────────────────────────────
	const [isEditingTolerance, setIsEditingTolerance] = useState(false);
	const [editToleranceVal, setEditToleranceVal] = useState<number | "">("");
	const [isSavingTolerance, setIsSavingTolerance] = useState(false);

	const handleSaveTolerance = async () => {
		const val = editToleranceVal === "" ? 0 : Number(editToleranceVal);
		setIsSavingTolerance(true);
		try {
			await callFrappeMethod("frappe.client.set_value", {
				doctype: "RAB Work Order",
				name: wo.name,
				fieldname: "deviation_tolerance_percentage",
				value: val,
			});
			setIsEditingTolerance(false);
			mutateWO();
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Update Failed");
			alert("Failed to update deviation tolerance: " + parsed.message);
		} finally {
			setIsSavingTolerance(false);
		}
	};

	// Fetch connected RA Bills for this Work Order
	const { data: connectedBills, isLoading: isLoadingBills } = useFrappeGetDocList("RA Bill", {
		fields: [
			"name",
			"ra_bill_no",
			"posting_date",
			"gross_work_value",
			"net_payable",
			"docstatus",
		],
		filters: [["boq", "=", docName], ["docstatus", "!=", 2]],
		orderBy: { field: "creation", order: "asc" },
		limit: 0,
	});

	if (isLoadingWO) {
		return (
			<div className="p-8 space-y-6 animate-pulse">
				<div className="h-16 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
				<div className="h-32 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
				<div className="h-64 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
			</div>
		);
	}

	if (!wo) {
		return (
			<div className="p-12 text-center bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d] text-rose-600 dark:text-[#ea5455]">
				Work Order #{docName} not found.
			</div>
		);
	}

	const handleSubmitWO = async () => {
		setIsSubmitting(true);
		try {
			try {
				await callFrappeMethod("ra_bill.api.submit_document", { doctype: "RAB Work Order", name: wo.name });
			} catch (e1) {
				await callFrappeMethod("frappe.client.submit", { doc: wo });
			}
			mutateWO();
		} catch (err: any) {
			try {
				await callFrappeMethod("frappe.client.set_value", {
					doctype: "RAB Work Order",
					name: wo.name,
					fieldname: "docstatus",
					value: 1,
				});
				await callFrappeMethod("frappe.client.set_value", {
					doctype: "RAB Work Order",
					name: wo.name,
					fieldname: "status",
					value: "Submitted",
				});
				mutateWO();
			} catch (e2: any) {
				const parsed = parseFrappeError(err || e2, "Submit Failed");
				alert("Submit failed: " + parsed.message);
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleCreateRABill = async () => {
		setCreateBillInfoMessage(null);
		setIsCreatingBill(true);
		try {
			const woAdvList = wo.advances || [];
			let initialDeductions = [...(wo.deductions || [])];
			if (woAdvList.length > 0) {
				initialDeductions = initialDeductions.filter(
					(d: any) =>
						d.deduction_type !== "Mobilization Recovery" &&
						d.deduction_type !== "Advance Recovery" &&
						!(d.deduction_type === "Other" && (d.description?.toLowerCase().includes("advance") || d.description?.startsWith("Other -")))
				);
				woAdvList.forEach((adv: any) => {
					let deductionType = "Other";
					let description = adv.description ? `Other - ${adv.description}` : "Other Advance";
					if (adv.advance_type === "Mobilization Advance") {
						deductionType = "Mobilization Recovery";
						description = "Mobilization Advance";
					} else if (adv.advance_type === "Ad Hoc Advance") {
						deductionType = "Advance Recovery";
						description = "Ad Hoc Advance";
					}
					initialDeductions.push({
						deduction_type: deductionType,
						description: description,
						method: "Percentage",
						calculation_method: "Percentage",
						rate: 20,
						amount: 0,
					});
				});
			}

			let seededItems: any[] = [];
			try {
				const boqRes = await callFrappeMethod("ra_bill.ra_bill.doctype.ra_bill.ra_bill.get_boq_items", {
					boq: wo.name,
				});
				const list = Array.isArray(boqRes?.message) ? boqRes.message : (Array.isArray(boqRes) ? boqRes : []);
				if (list.length > 0) {
					seededItems = list.map((it: any) => ({
						boq_item: it.boq_item || it.name,
						item_code: it.item_code,
						description: it.description,
						uom: it.uom,
						rate: it.rate,
						boq_qty: Number(it.boq_qty ?? 0),
						previous_qty: Number(it.previous_qty || 0),
						cumulative_qty: Number(it.cumulative_qty || it.previous_qty || 0),
					}));
				}
			} catch (_) {}

			if (seededItems.length === 0) {
				seededItems = wo.items?.map((it: any) => ({
					boq_item: it.name,
					item_code: it.item_code,
					description: it.description,
					uom: it.uom,
					rate: it.rate,
					boq_qty: Number(it.boq_qty ?? it.qty ?? 0),
					previous_qty: 0,
					cumulative_qty: 0,
				})) || [];
			}

			const res = await callFrappeMethod("frappe.client.insert", {
				doc: {
					doctype: "RA Bill",
					project: wo.project,
					boq: wo.name,
					company: wo.company || "Tridasa",
					bill_type: wo.boq_type,
					supplier: wo.supplier,
					customer: wo.customer,
					posting_date: new Date().toISOString().split("T")[0],
					items: seededItems,
					deductions: initialDeductions,
					additions: wo.additions || [],
				},
			});
			const newBillName = res?.name || res?.message?.name || res;
			if (newBillName && typeof newBillName === "string") {
				onSelectBill(newBillName);
			} else if (res?.name) {
				onSelectBill(res.name);
			}
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Create RA Bill Failed");
			const rawMsg: string = parsed.message;
			if (
				rawMsg.includes("fully billed") ||
				rawMsg.includes("No further RA Bills") ||
				rawMsg.includes("already been fully billed")
			) {
				setCreateBillInfoMessage(
					"No further RA Bills can be generated — the full Work Order quantity has already been billed."
				);
			} else {
				alert("Failed to create RA Bill: " + rawMsg);
			}
		} finally {
			setIsCreatingBill(false);
		}
	};

	const handleSaveAdvance = async (e: React.FormEvent) => {
		e.preventDefault();
		const amt = Number(advanceAmount);
		if (!amt || amt <= 0) {
			alert("Please enter a valid advance amount.");
			return;
		}
		if (advanceType === "Other" && !advanceDescription.trim()) {
			alert("Please enter a description for Other advance type.");
			return;
		}

		setIsCreatingAdvance(true);
		try {
			const existingAdvances = wo.advances || [];
			const newRow = {
				advance_type: advanceType,
				description: advanceType === "Other" ? advanceDescription.trim() : "",
				amount: amt,
			};
			const updatedAdvances = [...existingAdvances, newRow];

			try {
				await callFrappeMethod("frappe.client.set_value", {
					doctype: "RAB Work Order",
					name: wo.name,
					fieldname: "advances",
					value: updatedAdvances,
				});
			} catch (e1) {
				await callFrappeMethod("frappe.client.save", {
					doc: {
						...wo,
						advances: updatedAdvances,
					},
				});
			}

			setShowAdvanceDialog(false);
			setAdvanceType("Mobilization Advance");
			setAdvanceDescription("");
			setAdvanceAmount("");
			mutateWO();
			onAdvancesUpdated?.();
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Save Advance Failed");
			alert("Failed to save advance: " + parsed.message);
		} finally {
			setIsCreatingAdvance(false);
		}
	};

	// Opens the PE dialog and fetches Mode of Payment list dynamically from Frappe
	const handleOpenPEDialog = async (advanceRow: any, rowIndex: number) => {
		if (!wo.supplier) {
			alert("Cannot create Payment Entry: No Supplier linked to this Work Order.");
			return;
		}
		setCreatingPEForRow(rowIndex);
		const today = new Date().toISOString().split("T")[0];
		setPePostingDate(today);
		setPeReferenceDate(today);
		setPeReferenceNo(`${wo.name}-${(advanceRow.advance_type || "").replace(/ /g, "-")}`);
		setPeError("");
		// Fetch MoP list from backend
		try {
			const mops = await callFrappeMethod("frappe.client.get_list", {
				doctype: "Mode of Payment",
				fields: ["name", "type"],
				limit: 50,
			});
			const list: Array<{ name: string; type: string }> = Array.isArray(mops) ? mops : [];
			setMopList(list);
			// Default: prefer Cash; else first entry
			const cashMop = list.find((m) => m.type === "Cash");
			const defaultMop = cashMop || list[0];
			if (defaultMop) {
				setSelectedMop(defaultMop.name);
				setMopAccountType((defaultMop.type as any) || "");
				// Fetch default account for this MoP + company matching Frappe Desk
				try {
					const accRes = await callFrappeMethod("ra_bill.api.get_default_payment_account", {
						mode_of_payment: defaultMop.name,
						company: wo.company || "Tridasa",
					});
					setPaidFromAccount(accRes?.account || "");
				} catch (_) {
					setPaidFromAccount("");
				}
			} else {
				setSelectedMop("");
				setMopAccountType("");
				setPaidFromAccount("");
			}
		} catch (_) {
			setMopList([]);
		}
		setPeDialogRow({ advance: advanceRow, rowIndex });
		setCreatingPEForRow(null);
	};

	// Called when MoP dropdown changes — re-fetch account and update Bank/Cash type
	const handleMopChange = async (mopName: string) => {
		setSelectedMop(mopName);
		const mop = mopList.find((m) => m.name === mopName);
		const mopType = (mop?.type as any) || "";
		setMopAccountType(mopType);
		// Fetch default account for newly selected MoP matching Frappe Desk
		try {
			const accRes = await callFrappeMethod("ra_bill.api.get_default_payment_account", {
				mode_of_payment: mopName,
				company: wo.company || "Tridasa",
			});
			setPaidFromAccount(accRes?.account || "");
		} catch (_) {
			setPaidFromAccount("");
		}
	};

	// Submits PE from modal with full ERPNext-compliant payload
	const handleSubmitPEFromModal = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!peDialogRow) return;
		setPeError("");

		// Client-side validation: if Bank MoP, reference fields are mandatory
		if (mopAccountType === "Bank") {
			if (!peReferenceNo.trim()) {
				setPeError("Reference No (UTR / Cheque) is mandatory for Bank transactions.");
				return;
			}
			if (!peReferenceDate) {
				setPeError("Reference Date is mandatory for Bank transactions.");
				return;
			}
		}

		setIsSubmittingPE(true);
		try {
			const advanceRow = peDialogRow.advance;
			const rowIndex = peDialogRow.rowIndex;

			let resolvedPaidFrom = paidFromAccount;
			if (!resolvedPaidFrom) {
				try {
					const accRes = await callFrappeMethod("ra_bill.api.get_default_payment_account", {
						mode_of_payment: selectedMop,
						company: wo.company || "Tridasa",
					});
					resolvedPaidFrom = accRes?.account || "";
				} catch (_) {}
			}

			const peDoc: Record<string, any> = {
				doctype: "Payment Entry",
				payment_type: "Pay",
				party_type: "Supplier",
				party: wo.supplier,
				company: wo.company || "Tridasa",
				posting_date: pePostingDate,
				mode_of_payment: selectedMop,
				paid_from: resolvedPaidFrom,
				paid_amount: Number(advanceRow.amount || 0),
				received_amount: Number(advanceRow.amount || 0),
				source_exchange_rate: 1,
				target_exchange_rate: 1,
				work_order: wo.name,
				remarks: `Advance for Work Order ${wo.name}: ${advanceRow.advance_type}${
					advanceRow.description ? ` - ${advanceRow.description}` : ""
				}`,
			};
			// Always include reference fields — ERPNext ignores them for Cash but requires them for Bank
			if (peReferenceNo.trim()) peDoc.reference_no = peReferenceNo.trim();
			if (peReferenceDate) peDoc.reference_date = peReferenceDate;
			if (advanceRow.advance_type === "Mobilization Advance") peDoc.is_mobilization_advance = 1;
			else if (advanceRow.advance_type === "Ad Hoc Advance") peDoc.is_adhoc_advance = 1;

			const res = await callFrappeMethod("frappe.client.insert", { doc: peDoc });
			const peName = res?.name || res?.message?.name || res;

			// Update the advance child row with linked PE
			try {
				const updatedAdvances = (wo.advances || []).map((a: any, i: number) =>
					i === rowIndex ? { ...a, payment_entry: peName } : a
				);
				await callFrappeMethod("frappe.client.set_value", {
					doctype: "RAB Work Order",
					name: wo.name,
					fieldname: "advances",
					value: updatedAdvances,
				});
			} catch (_) { /* non-fatal */ }

			// Auto-submit the newly created Payment Entry
			try {
				await callFrappeMethod("ra_bill.api.submit_document", {
					doctype: "Payment Entry",
					name: typeof peName === "string" ? peName : peName?.name,
				});
			} catch (subErr: any) {
				console.warn("Failed to auto-submit Payment Entry:", subErr);
			}

			setPeDialogRow(null);
			mutateWO();
			onNavigateToPE();
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Create Payment Entry Failed");
			setPeError(parsed.message);
		} finally {
			setIsSubmittingPE(false);
		}
	};

	const contractVal = Number(wo.contract_value || wo.total_boq_amount || 0);
	const totalBilled = connectedBills?.reduce((acc, b) => acc + Number(b.gross_work_value || 0), 0) || 0;
	const pendingBalance = Math.max(0, contractVal - totalBilled);
	// Sum all advances from the advances child table (all types) with fallback
	const totalAdvDisbursed = (wo.advances || []).reduce(
		(acc: number, adv: any) => acc + Number(adv.amount || 0),
		0
	) || Number(wo.mobilization_advance_amount || 0);

	return (
		<div className="space-y-6 text-slate-800 dark:text-slate-100 transition-colors duration-200">

			{/* Top Header & Navigation */}
			<div className="flex flex-wrap items-center justify-between bg-white dark:bg-[#232333] p-5 rounded-2xl border border-slate-200/80 dark:border-[#32344d] gap-4 shadow-sm">
				<div className="flex items-center gap-4">
					<button
						onClick={onBack}
						className="p-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-2 text-xs font-semibold"
					>
						<ArrowLeft size={16} />
						<span>Back to Dashboard</span>
					</button>
					<div>
						<div className="flex items-center gap-2.5">
							<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{wo.name}</h2>
							<span className="text-xs font-bold bg-indigo-50 dark:bg-[#7367f0]/20 text-indigo-600 dark:text-[#7367f0] px-3 py-0.5 rounded-full border border-indigo-200 dark:border-[#7367f0]/30">
								{wo.project || "No Project Linked"}
							</span>
						</div>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
							Type: <span className="font-semibold text-slate-800 dark:text-slate-200">{wo.boq_type}</span> | Party:{" "}
							<span className="font-semibold text-slate-800 dark:text-slate-200">{wo.customer || wo.supplier || "-"}</span>
						</p>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<span className={`px-3.5 py-1 text-xs font-bold rounded-full border ${wo.docstatus === 0 || wo.status === "Draft"
							? "bg-amber-500/15 text-amber-600 border-amber-500/30"
							: "bg-emerald-500/15 text-emerald-600 dark:text-[#28c76f] border-emerald-500/30"
						}`}>
						{wo.status || (wo.docstatus === 0 ? "Draft" : "Submitted")}
					</span>

					{/* Submit Button (Draft state) */}
					{(wo.docstatus === 0 || wo.status === "Draft") && (
						<button
							onClick={handleSubmitWO}
							disabled={isSubmitting}
							className="px-4 py-2 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 dark:hover:bg-[#24b263] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
						>
							<CheckCircle2 size={16} />
							<span>{isSubmitting ? "Submitting..." : "Submit Work Order"}</span>
						</button>
					)}

					{/* + Create RA Bill Action Button (Submitted state) */}
					{(wo.docstatus === 1 || wo.status !== "Draft") && (
						<button
							onClick={handleCreateRABill}
							disabled={isCreatingBill}
							className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
						>
							<Receipt size={16} />
							<span>{isCreatingBill ? "Creating..." : "+ Create RA Bill"}</span>
						</button>
					)}

					{/* Create Advance Button */}
					<button
						onClick={() => setShowAdvanceDialog(true)}
						className="px-4 py-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-1.5 cursor-pointer"
					>
						<Plus size={16} />
						<span>Create Advance</span>
					</button>
				</div>
			</div>

			{/* Quick Financial Summary Cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d]">
					<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#8f93a7]">Contract Value</p>
					<p className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mt-1">{formatCurrency(contractVal)}</p>
				</div>
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d]">
					<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#8f93a7]">Total Billed to Date</p>
					<p className="text-lg font-extrabold text-indigo-600 dark:text-[#7367f0] mt-1">{formatCurrency(totalBilled)}</p>
				</div>
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d]">
					<p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Balance Pending</p>
					<p className="text-lg font-extrabold text-amber-600 dark:text-[#ff9f43] mt-1">{formatCurrency(pendingBalance)}</p>
				</div>
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d]">
					<p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-[#8f93a7]">Connected RA Bills</p>
					<p className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mt-1">{connectedBills?.length || 0} Bills</p>
				</div>
				<div className="bg-white dark:bg-[#232333] p-4 rounded-2xl border border-slate-200/80 dark:border-[#32344d]">
					<p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Advances Disbursed</p>
					<p className="text-lg font-extrabold text-emerald-600 dark:text-[#28c76f] mt-1">{formatCurrency(totalAdvDisbursed)}</p>
				</div>
			</div>

			{/* Clean Info Box when Work Order is fully billed (Issue 4) */}
			{createBillInfoMessage && (
				<div className="p-4 bg-sky-50 dark:bg-[#1e1e2d] border border-sky-200 dark:border-[#32344d] rounded-2xl flex items-center justify-between text-xs text-slate-800 dark:text-slate-200 shadow-sm transition-all">
					<div className="flex items-center gap-2.5">
						<Info size={18} className="text-indigo-600 dark:text-[#7367f0] shrink-0" />
						<span className="font-semibold">{createBillInfoMessage}</span>
					</div>
					<button
						onClick={() => setCreateBillInfoMessage(null)}
						className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer transition"
						title="Dismiss"
					>
						<X size={15} />
					</button>
				</div>
			)}

			{/* Section 1: Connected RA Bills (Interactive Drill-down Table) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl shadow-sm overflow-hidden space-y-0">
				<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
					<div>
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Connected RA Bills</h3>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Click any RA Bill row to inspect line items, deductions, and payment details</p>
					</div>
					<span className="text-xs font-bold bg-indigo-50 dark:bg-[#7367f0]/15 text-indigo-600 dark:text-[#7367f0] px-3 py-1 rounded-full border border-indigo-200 dark:border-[#7367f0]/30">
						{connectedBills?.length || 0} Submitted Bill(s)
					</span>
				</div>

				<div className="overflow-x-auto">
					<table className="w-full text-left text-xs">
						<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
							<tr>
								<th className="p-3.5">Bill ID</th>
								<th className="p-3.5">RA Bill No</th>
								<th className="p-3.5">Posting Date</th>
								<th className="p-3.5 text-right">Gross Work Value</th>
								<th className="p-3.5 text-right">Net Payable</th>
								<th className="p-3.5">Status</th>
								<th className="p-3.5 text-center">Action</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
							{isLoadingBills ? (
								<tr><td colSpan={7} className="p-8 text-center text-slate-400 dark:text-[#8f93a7]">Loading connected bills...</td></tr>
							) : connectedBills?.length === 0 ? (
								<tr><td colSpan={7} className="p-8 text-center text-slate-400 dark:text-[#8f93a7]">No RA Bills filed for this Work Order yet.</td></tr>
							) : (
								connectedBills?.map((bill) => (
									<tr
										key={bill.name}
										onClick={() => onSelectBill(bill.name)}
										className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition cursor-pointer group"
									>
										<td className="p-3.5 font-mono font-bold text-indigo-600 dark:text-[#7367f0] group-hover:underline">
											{bill.name}
										</td>
										<td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
											RA #{bill.ra_bill_no || "-"}
										</td>
										<td className="p-3.5 text-slate-600 dark:text-[#8f93a7]">{bill.posting_date}</td>
										<td className="p-3.5 text-right font-medium text-slate-900 dark:text-slate-100">
											{formatCurrency(bill.gross_work_value)}
										</td>
										<td className="p-3.5 text-right font-bold text-indigo-600 dark:text-[#7367f0]">
											{formatCurrency(bill.net_payable)}
										</td>
										<td className="p-3.5">
											<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-[#28c76f]">
												Submitted
											</span>
										</td>
										<td className="p-3.5 text-center">
											<button
												onClick={(e) => {
													e.stopPropagation();
													onSelectBill(bill.name);
												}}
												className="p-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-indigo-50 dark:hover:bg-[#7367f0]/20 text-slate-500 dark:text-[#8f93a7] hover:text-indigo-600 dark:hover:text-[#7367f0] rounded-lg transition"
											>
												<Eye size={16} />
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>

			{/* Section 2: General Information (2-Column Grid) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
				<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">General Information</h3>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
					<div className="space-y-3">
						<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">Project:</span>
							<span className="font-semibold text-slate-900 dark:text-slate-100">{wo.project || "-"}</span>
						</div>
						<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">BOQ Type:</span>
							<span className="font-semibold text-indigo-600 dark:text-[#7367f0]">{wo.boq_type}</span>
						</div>
						<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">Party (Customer / Supplier):</span>
							<span className="font-semibold text-slate-900 dark:text-slate-100">{wo.customer || wo.supplier || "-"}</span>
						</div>
					</div>

					<div className="space-y-3">
						<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">Company:</span>
							<span className="font-semibold text-slate-900 dark:text-slate-100">{wo.company || "Tridasa"}</span>
						</div>
						<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">Billing Method:</span>
							<span className="font-semibold text-slate-900 dark:text-slate-100">{wo.billing_method || "Item Rate"}</span>
						</div>
						<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">Defect Liability Period:</span>
							<span className="font-semibold text-slate-900 dark:text-slate-100">{wo.defect_liability_period_days || 365} Days</span>
						</div>
						<div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
							<span className="text-slate-500 dark:text-[#8f93a7]">Deviation Tolerance:</span>
							<div className="flex items-center gap-2">
								{isEditingTolerance ? (
									<div className="flex items-center gap-1.5">
										<input
											type="number"
											step="any"
											min="0"
											value={editToleranceVal}
											onChange={(e) => setEditToleranceVal(e.target.value === "" ? "" : Number(e.target.value))}
											className="w-16 px-2 py-0.5 text-xs font-semibold bg-white dark:bg-[#1e1e2d] border border-indigo-500 rounded text-right text-slate-900 dark:text-slate-100 focus:outline-none"
											autoFocus
										/>
										<span className="text-xs font-bold">%</span>
										<button
											onClick={handleSaveTolerance}
											disabled={isSavingTolerance}
											className="px-2 py-0.5 bg-emerald-600 dark:bg-[#28c76f] text-white rounded text-[11px] font-semibold hover:bg-emerald-700 transition cursor-pointer"
										>
											{isSavingTolerance ? "..." : "Save"}
										</button>
										<button
											onClick={() => setIsEditingTolerance(false)}
											className="px-1.5 py-0.5 text-slate-400 hover:text-slate-600 text-[11px] cursor-pointer"
										>
											✕
										</button>
									</div>
								) : (
									<div className="flex items-center gap-1.5">
										<span className="font-semibold text-slate-900 dark:text-slate-100">
											{wo.deviation_tolerance_percentage ?? 0}%
										</span>
										<button
											onClick={() => {
												setEditToleranceVal(wo.deviation_tolerance_percentage ?? 0);
												setIsEditingTolerance(true);
											}}
											className="text-[11px] text-indigo-600 dark:text-[#7367f0] hover:underline font-medium ml-1 cursor-pointer"
											title="Edit Deviation Tolerance %"
										>
											Edit
										</button>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Section 3: Schedule of Items (BOQ Items Table) */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm space-y-0">
				<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
					<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Schedule of Items (BOQ Items)</h3>
					<span className="text-xs text-slate-500 dark:text-[#8f93a7]">
						{wo.items?.length || 0} Item Row(s)
					</span>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-xs">
						<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
							<tr>
								<th className="p-4">No.</th>
								<th className="p-4">Item Code</th>
								<th className="p-4">Description</th>
								<th className="p-4">UOM</th>
								<th className="p-4 text-right">Work Order Qty</th>
								<th className="p-4 text-right">Rate</th>
								<th className="p-4 text-right">Amount</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
							{wo.items?.map((item: any, idx: number) => (
								<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
									<td className="p-4 text-slate-400 dark:text-[#8f93a7]">{idx + 1}</td>
									<td className="p-4 font-mono font-bold text-indigo-600 dark:text-[#7367f0]">{item.item_code || "-"}</td>
									<td className="p-4 text-slate-800 dark:text-slate-200 max-w-xs truncate">{item.description || "-"}</td>
									<td className="p-4 text-slate-600 dark:text-slate-300 font-mono">{item.uom || "-"}</td>
									<td className="p-4 text-right font-medium text-slate-800 dark:text-slate-200 font-mono">{item.boq_qty ?? item.qty ?? 0}</td>
									<td className="p-4 text-right font-medium text-slate-800 dark:text-slate-200">{formatCurrency(item.rate)}</td>
									<td className="p-4 text-right font-bold text-slate-900 dark:text-slate-100">{formatCurrency(item.amount)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="p-4 bg-slate-50 dark:bg-[#1e1e2d] border-t border-slate-200 dark:border-[#32344d] flex justify-between items-center text-xs">
					<span className="font-bold text-slate-500 dark:text-[#8f93a7] uppercase tracking-wider">Total Schedule Amount</span>
					<span className="text-base font-black text-indigo-600 dark:text-[#7367f0]">{formatCurrency(wo.total_boq_amount)}</span>
				</div>
			</div>

			{/* Section 4 & 5: Additions & Deductions Tables */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Additions Table */}
				<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-5 shadow-sm space-y-3">
					<h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-2">
						Contract Additions
					</h4>
					{wo.additions && wo.additions.length > 0 ? (
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] font-bold border-b border-slate-200 dark:border-[#32344d]">
								<tr>
									<th className="p-2">Type</th>
									<th className="p-2">Method</th>
									<th className="p-2 text-right">Rate %</th>
									<th className="p-2 text-right">Amount</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
								{wo.additions.map((a: any, idx: number) => (
									<tr key={idx}>
										<td className="p-2 font-semibold text-slate-900 dark:text-slate-100">{a.addition_type}</td>
										<td className="p-2 text-slate-500">{a.calculation_method}</td>
										<td className="p-2 text-right font-mono">{a.rate}%</td>
										<td className="p-2 text-right font-bold text-emerald-600">{formatCurrency(a.amount)}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<p className="text-xs text-slate-400 dark:text-[#8f93a7] py-4 text-center">No contractual additions configured.</p>
					)}
				</div>

				{/* Deductions Table */}
				<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-5 shadow-sm space-y-3">
					<h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-2">
						Contract Deductions & Recoveries
					</h4>
					{wo.deductions && wo.deductions.length > 0 ? (
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] font-bold border-b border-slate-200 dark:border-[#32344d]">
								<tr>
									<th className="p-2">Deduction Type</th>
									<th className="p-2">Method</th>
									<th className="p-2 text-right">Rate %</th>
									<th className="p-2 text-right">Amount</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
								{wo.deductions.map((d: any, idx: number) => (
									<tr key={idx}>
										<td className="p-2 font-semibold text-slate-900 dark:text-slate-100">{d.deduction_type}</td>
										<td className="p-2 text-slate-500">{d.calculation_method}</td>
										<td className="p-2 text-right font-mono">{d.rate}%</td>
										<td className="p-2 text-right font-bold text-rose-600 dark:text-[#ea5455]">{formatCurrency(-d.amount)}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<p className="text-xs text-slate-400 dark:text-[#8f93a7] py-4 text-center">No contractual deductions configured.</p>
					)}
				</div>
			</div>

			{/* Section 6: Contract Advances Table */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-5 shadow-sm space-y-3">
				<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#32344d] pb-3">
					<div>
						<h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
							Contract Advances
						</h4>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7]">
							Mobilization, ad hoc, and other advances disbursed against this Work Order
						</p>
					</div>
					<button
						onClick={() => setShowAdvanceDialog(true)}
						className="px-3 py-1.5 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
					>
						<Plus size={14} />
						<span>Create Advance</span>
					</button>
				</div>

				{wo.advances && wo.advances.length > 0 ? (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] font-bold border-b border-slate-200 dark:border-[#32344d]">
								<tr>
									<th className="p-2.5">No.</th>
									<th className="p-2.5">Advance Type</th>
									<th className="p-2.5">Description</th>
									<th className="p-2.5 text-right">Amount</th>
									<th className="p-2.5">Linked Payment Entry</th>
									<th className="p-2.5 text-center">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
								{wo.advances.map((adv: any, idx: number) => {
									const hasPE = !!adv.payment_entry;
									const isCreatingThisPE = creatingPEForRow === idx;
									return (
										<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
											<td className="p-2.5 text-slate-400">{idx + 1}</td>
											<td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">{adv.advance_type}</td>
											<td className="p-2.5 text-slate-600 dark:text-[#8f93a7]">
												{adv.advance_type === "Other" ? adv.description || "-" : "-"}
											</td>
											<td className="p-2.5 text-right font-bold text-emerald-600 dark:text-[#28c76f]">
												{formatCurrency(adv.amount)}
											</td>
											<td className="p-2.5 font-mono text-indigo-600 dark:text-[#7367f0]">
												{adv.payment_entry || "-"}
											</td>
											<td className="p-2.5 text-center">
												{!hasPE ? (
													<button
														onClick={() => handleOpenPEDialog(adv, idx)}
														disabled={isCreatingThisPE}
														className="px-3 py-1 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 dark:hover:bg-[#24b263] text-white text-[11px] font-semibold rounded-lg shadow-sm transition flex items-center gap-1 mx-auto cursor-pointer"
													>
														<span>{isCreatingThisPE ? "Opening..." : "Create Payment Entry"}</span>
													</button>
												) : (
													<span className="text-[11px] font-medium text-slate-400">Payment Created</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : (
					<p className="text-xs text-slate-400 dark:text-[#8f93a7] py-4 text-center">
						No advances created yet. Click "Create Advance" to add one.
					</p>
				)}
			</div>

			{/* Create Advance Modal Dialog */}
			{showAdvanceDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
					<div className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5">
						<div className="flex items-center justify-between border-b border-slate-200 dark:border-[#32344d] pb-3">
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
								Create Advance
							</h3>
							<button
								type="button"
								onClick={() => setShowAdvanceDialog(false)}
								className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition"
							>
								<X size={18} />
							</button>
						</div>

						<form onSubmit={handleSaveAdvance} className="space-y-4 text-xs">
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Advance Type <span className="text-rose-500">*</span>
								</label>
								<select
									value={advanceType}
									onChange={(e) => setAdvanceType(e.target.value as any)}
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
								>
									<option value="Mobilization Advance">Mobilization Advance</option>
									<option value="Ad Hoc Advance">Ad Hoc Advance</option>
									<option value="Other">Other</option>
								</select>
							</div>

							{advanceType === "Other" && (
								<div>
									<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
										Description (Custom Name) <span className="text-rose-500">*</span>
									</label>
									<input
										type="text"
										required
										placeholder="e.g. Fuel Advance, Equipment Advance"
										value={advanceDescription}
										onChange={(e) => setAdvanceDescription(e.target.value)}
										className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
									/>
								</div>
							)}

							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Amount (INR) <span className="text-rose-500">*</span>
								</label>
								<input
									type="number"
									step="any"
									min="0.01"
									required
									placeholder="0.00"
									value={advanceAmount === 0 ? "" : advanceAmount}
									onChange={(e) => setAdvanceAmount(e.target.value === "" ? "" : Number(e.target.value))}
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 font-mono text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
								/>
							</div>

							<div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-[#32344d]">
								<button
									type="button"
									onClick={() => setShowAdvanceDialog(false)}
									disabled={isCreatingAdvance}
									className="px-4 py-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 rounded-xl font-semibold transition cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={isCreatingAdvance}
									className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer"
								>
									<span>{isCreatingAdvance ? "Saving..." : "Save Advance"}</span>
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* ── Payment Entry Creation Modal ── */}
			{peDialogRow && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
					<div className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
						<div className="flex items-center justify-between border-b border-slate-200 dark:border-[#32344d] pb-3">
							<div>
								<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Create Payment Entry</h3>
								<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
									{peDialogRow.advance.advance_type} · {formatCurrency(peDialogRow.advance.amount)}
								</p>
							</div>
							<button
								type="button"
								onClick={() => setPeDialogRow(null)}
								className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition"
							>
								<X size={18} />
							</button>
						</div>

						<form onSubmit={handleSubmitPEFromModal} className="space-y-4 text-xs">
							{/* Mode of Payment */}
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Mode of Payment <span className="text-rose-500">*</span>
								</label>
								<select
									value={selectedMop}
									onChange={(e) => handleMopChange(e.target.value)}
									required
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
								>
									{mopList.length === 0 && <option value="">Loading...</option>}
									{mopList.map((m) => (
										<option key={m.name} value={m.name}>{m.name} ({m.type})</option>
									))}
								</select>
								{mopAccountType === "Bank" && (
									<p className="mt-1 text-amber-600 dark:text-amber-400 font-semibold">Bank mode selected — Reference No &amp; Date are mandatory.</p>
								)}
							</div>

							{/* Paid From Account (auto-filled from MoP) */}
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Paid From Account
								</label>
								<input
									type="text"
									value={paidFromAccount}
									onChange={(e) => setPaidFromAccount(e.target.value)}
									placeholder="Auto-filled from Mode of Payment"
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
								/>
							</div>

							{/* Posting Date */}
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Posting Date <span className="text-rose-500">*</span>
								</label>
								<input
									type="date"
									required
									value={pePostingDate}
									onChange={(e) => setPePostingDate(e.target.value)}
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
								/>
							</div>

							{/* Reference No — required for Bank, optional for Cash */}
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Reference No (Cheque / UTR / Transaction Ref)
									{mopAccountType === "Bank" && <span className="text-rose-500"> *</span>}
								</label>
								<input
									type="text"
									value={peReferenceNo}
									onChange={(e) => setPeReferenceNo(e.target.value)}
									placeholder="UTR / Cheque / Transaction reference number"
									className={`w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
										mopAccountType === "Bank" && !peReferenceNo.trim()
											? "border-rose-400 dark:border-rose-500"
											: "border-slate-200 dark:border-[#32344d]"
									}`}
								/>
							</div>

							{/* Reference Date — required for Bank */}
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Reference Date (Cheque / Transaction Date)
									{mopAccountType === "Bank" && <span className="text-rose-500"> *</span>}
								</label>
								<input
									type="date"
									value={peReferenceDate}
									onChange={(e) => setPeReferenceDate(e.target.value)}
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
								/>
							</div>

							{/* Error banner */}
							{peError && (
								<div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-700 dark:text-rose-400 text-xs font-semibold">
									{peError}
								</div>
							)}

							<div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-[#32344d]">
								<button
									type="button"
									onClick={() => setPeDialogRow(null)}
									disabled={isSubmittingPE}
									className="px-4 py-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 rounded-xl font-semibold transition cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={isSubmittingPE}
									className="px-4 py-2 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
								>
									<span>{isSubmittingPE ? "Creating..." : "Create Payment Entry"}</span>
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</div>
	);
}

// RABillDetail is imported from ./components/RABillDetail

// ----------------------------------------------------------------------
// NEW RAB WORK ORDER FORM CREATION VIEW
// ----------------------------------------------------------------------
function CreateRABWorkOrderForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: (newWoName?: string) => void }) {
	const [namingSeries, setNamingSeries] = useState("RABWO-.YYYY.-");
	const [project, setProject] = useState("");
	const [boqType, setBoqType] = useState<"Client" | "Subcontractor">("Client");
	const [customer, setCustomer] = useState("");
	const [supplier, setSupplier] = useState("");
	const [company, setCompany] = useState("Tridasa");
	const [currency, setCurrency] = useState("INR");
	const [contractDate, setContractDate] = useState(new Date().toISOString().split("T")[0]);
	const [billingMethod, setBillingMethod] = useState("Item Rate (Measured)");
	const [dlpDays, setDlpDays] = useState(365);

	const [items, setItems] = useState<Array<{
		item_code: string;
		description: string;
		uom: string;
		qty: number;
		rate: number;
		amount: number;
	}>>([]);

	const [contractValue, setContractValue] = useState<number | "">("");
	const [deviationTolerance, setDeviationTolerance] = useState<number | "">(25);
	const [mobilizationAdvance, setMobilizationAdvance] = useState(0);
	const [applyGst, setApplyGst] = useState(true);
	const [gstPercentage, setGstPercentage] = useState(18);
	const [mobilizationPE, setMobilizationPE] = useState("");

	const [additions, setAdditions] = useState<Array<{
		addition_type: string;
		description: string;
		calculation_method: string;
		rate: number;
		amount: number;
	}>>([]);

	const [deductions, setDeductions] = useState<Array<{
		deduction_type: string;
		description: string;
		method?: string;
		calculation_method: string;
		rate: number;
		amount: number;
	}>>([
		{ deduction_type: "Retention", description: "Retention Money Deduction", method: "Percentage", calculation_method: "Percentage", rate: 5, amount: 0 },
		{ deduction_type: "TDS", description: "Tax Deducted at Source", method: "Percentage", calculation_method: "Percentage", rate: 2, amount: 0 },
		{ deduction_type: "Labour Cess", description: "BOCW Labour Welfare Cess", method: "Percentage", calculation_method: "Percentage", rate: 1, amount: 0 },
		{ deduction_type: "Mobilization Recovery", description: "Mobilization Advance Recovery", method: "Percentage", calculation_method: "Percentage", rate: 20, amount: 0 },
	]);

	const { data: projectList } = useFrappeGetDocList("Project", { fields: ["name", "project_name"], limit: 0 });
	const { data: uomList } = useFrappeGetDocList("UOM", { fields: ["name", "uom_name"], limit: 0 });
	const fileInputRef = React.useRef<HTMLInputElement>(null);

	const { createDoc, loading } = useFrappeCreateDoc();

	const totalBoqAmount = useMemo(() => {
		return items.reduce((acc, item) => acc + (Number(item.qty || 0) * Number(item.rate || 0)), 0);
	}, [items]);

	const finalContractValue = contractValue !== "" ? Number(contractValue) : totalBoqAmount;

	const handleAddItemRow = () => {
		setItems([...items, { item_code: "", description: "", uom: "Nos", qty: 0, rate: 0, amount: 0 }]);
	};

	const handleItemChange = (index: number, field: string, value: any) => {
		const updated = [...items];
		if (field === "item_select") {
			updated[index].item_code = value.item_code;
			updated[index].description = value.description || value.item_code;
			updated[index].uom = value.uom || "Nos";
		} else {
			(updated[index] as any)[field] = value;
		}
		if (field === "qty" || field === "rate" || field === "item_select") {
			updated[index].amount = Number(updated[index].qty || 0) * Number(updated[index].rate || 0);
		}
		setItems(updated);
	};

	const handleDeleteItemRow = (index: number) => {
		setItems(items.filter((_, i) => i !== index));
	};

	const handleDownloadCSVTemplate = () => {
		const sampleData = items.length > 0
			? items.map(i => ({
				"Item Code": i.item_code,
				"Description": i.description,
				"UOM": i.uom || "Nos",
				"Qty": Number(i.qty || 0),
				"Rate": Number(i.rate || 0),
				"Amount": Number(i.qty || 0) * Number(i.rate || 0),
			}))
			: [
				{ "Item Code": "ITEM-001", "Description": "Civil excavation work", "UOM": "Cum", "Qty": 100, "Rate": 250, "Amount": 25000 },
				{ "Item Code": "ITEM-002", "Description": "PCC 1:4:8 concrete work", "UOM": "Cum", "Qty": 50, "Rate": 4500, "Amount": 225000 },
			];
		const ws = XLSX.utils.json_to_sheet(sampleData);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "Schedule of Items");
		const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
		const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.setAttribute("download", "work_order_items_template.xlsx");
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	const handleUploadCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const isExcel = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");

		const mapRowObj = (rowObj: Record<string, any>) => {
			const keys = Object.keys(rowObj);
			const findVal = (matchers: string[]) => {
				for (const key of keys) {
					const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
					if (matchers.some((m) => norm === m || norm.includes(m))) {
						return rowObj[key];
					}
				}
				return undefined;
			};

			const item_code = String(findVal(["itemcode", "code", "item"]) ?? "").trim();
			const description = String(findVal(["description", "desc", "itemdescription", "itemname"]) ?? "").trim() || item_code;
			const uom = String(findVal(["uom", "unit"]) ?? "").trim() || "Nos";
			const qty = Number(findVal(["workorderqty", "boqqty", "quantity", "qty"]) ?? 0);
			const rate = Number(findVal(["unitrate", "rate", "price"]) ?? 0);
			const amount = qty * rate;

			if (item_code || description) {
				return { item_code, description, uom, qty, rate, amount };
			}
			return null;
		};

		if (isExcel) {
			const reader = new FileReader();
			reader.onload = (evt) => {
				try {
					const data = new Uint8Array(evt.target?.result as ArrayBuffer);
					const wb = XLSX.read(data, { type: "array" });
					const wsName = wb.SheetNames[0];
					const ws = wb.Sheets[wsName];
					const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

					const parsedItems = jsonRows.map(mapRowObj).filter((it): it is NonNullable<typeof it> => it !== null);
					if (parsedItems.length > 0) {
						setItems((prev) => [...prev, ...parsedItems]);
					} else {
						alert("No valid item rows found in the uploaded Excel file.");
					}
				} catch (err: any) {
					console.error("Error parsing Excel file:", err);
					alert("Failed to parse Excel file: " + (err.message || String(err)));
				}
			};
			reader.readAsArrayBuffer(file);
		} else {
			const reader = new FileReader();
			reader.onload = (evt) => {
				try {
					const text = evt.target?.result as string;
					if (!text) return;
					const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
					if (lines.length <= 1) return;

					const headers = lines[0].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
					const parsedItems: any[] = [];
					for (let i = 1; i < lines.length; i++) {
						const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
						const rowObj: Record<string, any> = {};
						headers.forEach((h, idx) => {
							rowObj[h] = cols[idx];
						});
						const mapped = mapRowObj(rowObj);
						if (mapped) {
							parsedItems.push(mapped);
						} else if (cols.length >= 3) {
							const item_code = cols[0] || "";
							const description = cols[1] || item_code;
							const uom = cols[2] || "Nos";
							const qty = Number(cols[3] || 0);
							const rate = Number(cols[4] || 0);
							const amount = qty * rate;
							if (item_code || description) {
								parsedItems.push({ item_code, description, uom, qty, rate, amount });
							}
						}
					}
					if (parsedItems.length > 0) {
						setItems((prev) => [...prev, ...parsedItems]);
					} else {
						alert("No valid item rows found in the uploaded CSV.");
					}
				} catch (err: any) {
					console.error("Error parsing CSV file:", err);
					alert("Failed to parse CSV file: " + (err.message || String(err)));
				}
			};
			reader.readAsText(file);
		}
		e.target.value = "";
	};

	const handleSave = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!project.trim()) {
			alert("Please enter a valid Project link.");
			return;
		}
		if (boqType === "Client" && !customer.trim()) {
			alert("Customer name is required for Client BOQ Type.");
			return;
		}
		if (boqType === "Subcontractor" && !supplier.trim()) {
			alert("Supplier / Subcontractor name is required for Subcontractor BOQ Type.");
			return;
		}

		const payload = {
			naming_series: namingSeries,
			project,
			boq_type: boqType,
			customer: boqType === "Client" ? customer : "",
			supplier: boqType === "Subcontractor" ? supplier : "",
			company,
			currency,
			contract_date: contractDate,
			billing_method: billingMethod,
			defect_liability_period_days: Number(dlpDays),
			status: "Draft",
			items: items.map((it) => ({
				item_code: it.item_code,
				description: it.description,
				uom: it.uom,
				qty: Number(it.qty),
				boq_qty: Number(it.qty),
				rate: Number(it.rate),
				amount: Number(it.qty) * Number(it.rate),
			})),
			total_boq_amount: totalBoqAmount,
			contract_value: finalContractValue,
			deviation_tolerance_percentage: deviationTolerance === "" ? 25 : Number(deviationTolerance),
			mobilization_advance_amount: Number(mobilizationAdvance),
			apply_gst: applyGst ? 1 : 0,
			gst_percentage: applyGst ? Number(gstPercentage) : 0,
			mobilization_payment_entry: mobilizationPE,
			additions: additions.map((a) => {
				const m = (a as any).method || a.calculation_method || "Percentage";
				return {
					addition_type: a.addition_type,
					description: a.description,
					method: m,
					calculation_method: m,
					rate: Number(a.rate),
					amount: Number(a.amount),
				};
			}),
			deductions: deductions.map((d) => {
				const m = (d as any).method || d.calculation_method || "Percentage";
				return {
					deduction_type: d.deduction_type,
					description: d.description,
					method: m,
					calculation_method: m,
					rate: Number(d.rate),
					amount: Number(d.amount),
				};
			}),
		};

		try {
			const res = await createDoc("RAB Work Order", payload);
			const newWoName = res?.name || res?.message?.name || res;
			onSuccess(typeof newWoName === "string" ? newWoName : undefined);
		} catch (err: any) {
			alert(err.message || "Failed to create RAB Work Order.");
		}
	};

	return (
		<form onSubmit={handleSave} className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 md:p-8 space-y-8 text-slate-800 dark:text-slate-100 shadow-xl transition-colors duration-200">

			<div className="flex flex-wrap items-center justify-between border-b border-slate-200 dark:border-[#32344d] pb-5 gap-4">
				<div className="flex items-center gap-4">
					<button
						type="button"
						onClick={onCancel}
						className="p-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-2 text-xs font-semibold"
					>
						<ArrowLeft size={16} />
						<span>Back</span>
					</button>
					<div>
						<div className="flex items-center gap-2.5">
							<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">New RAB Work Order</h2>
							<span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-[#ff9f43] border border-amber-500/30">
								Not Saved
							</span>
						</div>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
							Standard ERPNext BOQ Work Order Entry Form
						</p>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="px-4 py-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-600 dark:text-[#8f93a7] hover:text-slate-900 dark:hover:text-white rounded-xl border border-slate-200 dark:border-[#32344d] transition text-xs font-semibold"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={loading}
						className="flex items-center gap-2 px-6 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-semibold text-xs rounded-xl shadow-md transition"
					>
						<Save size={16} />
						<span>{loading ? "Saving..." : "Save Work Order"}</span>
					</button>
				</div>
			</div>

			{/* Primary Fields Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-[#1e1e2d] p-6 rounded-2xl border border-slate-200/80 dark:border-[#2d2d3f]">
				<div className="space-y-4 text-xs">
					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Naming Series</label>
						<select
							value={namingSeries}
							onChange={(e) => setNamingSeries(e.target.value)}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						>
							<option value="RABWO-.YYYY.-">RABWO-.YYYY.-</option>
							<option value="BOQ-.YYYY.-">BOQ-.YYYY.-</option>
						</select>
					</div>

					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Project Link *</label>
						<select
							value={project}
							onChange={(e) => setProject(e.target.value)}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
							required
						>
							<option value="">Select Project...</option>
							{projectList?.map((p: any) => (
								<option key={p.name} value={p.name}>
									{p.project_name ? `${p.project_name} (${p.name})` : p.name}
								</option>
							))}
						</select>
					</div>

					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">BOQ Type</label>
						<select
							value={boqType}
							onChange={(e) => setBoqType(e.target.value as "Client" | "Subcontractor")}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						>
							<option value="Client">Client</option>
							<option value="Subcontractor">Subcontractor</option>
						</select>
					</div>

					{boqType === "Client" ? (
						<div>
							<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Customer Name *</label>
							<DocLinkDropdown
								doctype="Customer"
								value={customer}
								onChange={setCustomer}
								placeholder="Select or search Customer..."
								required
							/>
						</div>
					) : (
						<div>
							<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Supplier / Subcontractor Name *</label>
							<DocLinkDropdown
								doctype="Supplier"
								value={supplier}
								onChange={setSupplier}
								placeholder="Select or search Supplier..."
								required
							/>
						</div>
					)}
				</div>

				<div className="space-y-4 text-xs">
					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Company *</label>
						<input
							type="text"
							placeholder="e.g. Tridasa"
							value={company}
							onChange={(e) => setCompany(e.target.value)}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
							required
						/>
					</div>

					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Currency</label>
						<input
							type="text"
							value={currency}
							onChange={(e) => setCurrency(e.target.value)}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						/>
					</div>

					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Contract Date</label>
						<input
							type="date"
							value={contractDate}
							onChange={(e) => setContractDate(e.target.value)}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						/>
					</div>

					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Billing Method</label>
						<select
							value={billingMethod}
							onChange={(e) => setBillingMethod(e.target.value)}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						>
							<option value="Item Rate (Measured)">Item Rate (Measured)</option>
							<option value="Percentage Completion">Percentage Completion</option>
							<option value="Milestone">Milestone</option>
							<option value="Lump Sum">Lump Sum</option>
						</select>
					</div>

					<div>
						<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Defect Liability Period (Days)</label>
						<input
							type="number"
							value={dlpDays === 0 ? "" : dlpDays}
							onChange={(e) => setDlpDays(e.target.value === "" ? 0 : Number(e.target.value))}
							className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
						/>
					</div>
				</div>
			</div>

			{/* Schedule of Items */}
			<div className="bg-slate-50 dark:bg-[#1e1e2d] p-6 rounded-2xl border border-slate-200/80 dark:border-[#2d2d3f] space-y-4">
				<input
					ref={fileInputRef}
					type="file"
					accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
					onChange={handleUploadCSV}
					className="hidden"
				/>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Schedule of Items</h3>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">Use Item master autocomplete or import CSV file to populate work order items.</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleDownloadCSVTemplate}
							className="px-3 py-1.5 bg-white dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-1.5"
						>
							<span>Download Template</span>
						</button>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="px-3 py-1.5 bg-indigo-50 dark:bg-[#7367f0]/15 hover:bg-indigo-100 dark:hover:bg-[#7367f0]/25 text-indigo-600 dark:text-[#7367f0] text-xs font-semibold rounded-xl border border-indigo-200 dark:border-[#7367f0]/30 transition flex items-center gap-1.5"
						>
							<span>Import CSV</span>
						</button>
					</div>
				</div>

				<div className="overflow-x-auto">
					<table className="w-full text-left text-xs">
						<thead className="bg-slate-100 dark:bg-[#232333] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
							<tr>
								<th className="p-3 w-12">No.</th>
								<th className="p-3 w-52">Item Code *</th>
								<th className="p-3">Description *</th>
								<th className="p-3 w-32">UOM</th>
								<th className="p-3 w-32 text-right">Work Order Qty</th>
								<th className="p-3 w-36 text-right">Rate</th>
								<th className="p-3 w-40 text-right">Amount</th>
								<th className="p-3 w-16 text-center">Action</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
							{items.length === 0 ? (
								<tr>
									<td colSpan={8} className="p-8 text-center text-slate-400 dark:text-[#8f93a7]">
										No items added yet. Click "+ Add Row" or "Import CSV" to start.
									</td>
								</tr>
							) : (
								items.map((item, idx) => (
									<tr key={idx} className="hover:bg-slate-100/70 dark:hover:bg-[#282a42]/50 transition">
										<td className="p-3 text-slate-500 dark:text-[#8f93a7] font-semibold">{idx + 1}</td>
										<td className="p-3">
											<ItemLinkDropdown
												value={item.item_code}
												onChange={(sel) => handleItemChange(idx, "item_select", sel)}
											/>
										</td>
										<td className="p-3">
											<input
												type="text"
												placeholder="Item description"
												value={item.description}
												onChange={(e) => handleItemChange(idx, "description", e.target.value)}
												className="w-full p-2 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-lg text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
												required
											/>
										</td>
										<td className="p-3">
											<select
												value={item.uom}
												onChange={(e) => handleItemChange(idx, "uom", e.target.value)}
												className="w-full p-2 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-lg text-slate-900 dark:text-slate-100 text-xs font-mono focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
											>
												<option value={item.uom || "Nos"}>{item.uom || "Nos"}</option>
												{uomList?.map((u: any) => (
													<option key={u.name} value={u.name}>
														{u.uom_name || u.name}
													</option>
												))}
											</select>
										</td>
										<td className="p-3">
											<input
												type="number"
												step="any"
												value={item.qty === 0 ? "" : (item.qty ?? "")}
												onChange={(e) => handleItemChange(idx, "qty", e.target.value === "" ? 0 : Number(e.target.value))}
												className="w-full p-2 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-lg text-slate-900 dark:text-slate-100 text-xs text-right focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
											/>
										</td>
										<td className="p-3">
											<input
												type="number"
												step="any"
												value={item.rate === 0 ? "" : (item.rate ?? "")}
												onChange={(e) => handleItemChange(idx, "rate", e.target.value === "" ? 0 : Number(e.target.value))}
												className="w-full p-2 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-lg text-slate-900 dark:text-slate-100 text-xs text-right focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
											/>
										</td>
										<td className="p-3 text-right font-bold text-indigo-600 dark:text-[#7367f0]">
											{formatCurrency(item.qty * item.rate)}
										</td>
										<td className="p-3 text-center">
											<button
												type="button"
												onClick={() => handleDeleteItemRow(idx)}
												className="p-1.5 text-slate-400 hover:text-rose-600 dark:text-[#8f93a7] dark:hover:text-[#ea5455] rounded-lg transition"
											>
												<Trash2 size={16} />
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>

				<div className="flex justify-between items-center pt-2">
					<button
						type="button"
						onClick={handleAddItemRow}
						className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#282a42] text-indigo-600 dark:text-[#7367f0] border border-indigo-200 dark:border-[#7367f0]/40 rounded-xl text-xs font-semibold transition"
					>
						<Plus size={14} />
						<span>+ Add Row</span>
					</button>

					<div className="text-right">
						<span className="text-xs text-slate-500 dark:text-[#8f93a7] uppercase font-bold mr-3">Total Work Order Amount:</span>
						<span className="text-lg font-black text-indigo-600 dark:text-[#7367f0]">{formatCurrency(totalBoqAmount)}</span>
					</div>
				</div>
			</div>

			{/* Contract Terms */}
			<div className="bg-slate-50 dark:bg-[#1e1e2d] p-6 rounded-2xl border border-slate-200/80 dark:border-[#2d2d3f] space-y-4">
				<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#2d2d3f] pb-3">Contract Terms</h3>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
					<div className="space-y-4">
						<div>
							<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Contract Value (₹)</label>
							<input
								type="number"
								step="any"
								placeholder={`Default: ${totalBoqAmount}`}
								value={contractValue === 0 ? "" : contractValue}
								onChange={(e) => setContractValue(e.target.value === "" ? "" : Number(e.target.value))}
								className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
							/>
						</div>

						<div>
							<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Deviation Tolerance %</label>
							<input
								type="number"
								step="any"
								min="0"
								placeholder="25"
								value={deviationTolerance}
								onChange={(e) => setDeviationTolerance(e.target.value === "" ? "" : Number(e.target.value))}
								className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
							/>
						</div>

						<div>
							<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Mobilization Advance Amount (₹)</label>
							<input
								type="number"
								step="any"
								value={mobilizationAdvance === 0 ? "" : mobilizationAdvance}
								onChange={(e) => setMobilizationAdvance(e.target.value === "" ? 0 : Number(e.target.value))}
								className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
							/>
						</div>
					</div>

					<div className="space-y-4">
						<div className="flex items-center gap-3 pt-2">
							<input
								type="checkbox"
								id="applyGst"
								checked={applyGst}
								onChange={(e) => setApplyGst(e.target.checked)}
								className="w-4 h-4 rounded bg-white dark:bg-[#232333] border-slate-300 dark:border-[#32344d] text-indigo-600 dark:text-[#7367f0] focus:ring-0 cursor-pointer"
							/>
							<label htmlFor="applyGst" className="font-semibold text-slate-900 dark:text-slate-100 cursor-pointer">
								Apply GST on RA Bills
							</label>
						</div>

						{applyGst && (
							<div>
								<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">GST Rate %</label>
								<input
									type="number"
									step="any"
									value={gstPercentage === 0 ? "" : gstPercentage}
									onChange={(e) => setGstPercentage(e.target.value === "" ? 0 : Number(e.target.value))}
									className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
								/>
							</div>
						)}

						<div>
							<label className="block font-semibold text-slate-600 dark:text-[#8f93a7] mb-1.5">Mobilization Payment Entry</label>
							<input
								type="text"
								placeholder="e.g. ACC-PAY-2026-00148"
								value={mobilizationPE}
								onChange={(e) => setMobilizationPE(e.target.value)}
								className="w-full p-2.5 bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 dark:focus:border-[#7367f0]"
							/>
						</div>
					</div>
				</div>
			</div>

			<div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-[#32344d]">
				<button
					type="button"
					onClick={onCancel}
					className="px-5 py-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-600 dark:text-[#8f93a7] hover:text-slate-900 dark:hover:text-white rounded-xl border border-slate-200 dark:border-[#32344d] transition text-xs font-semibold"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={loading}
					className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 dark:hover:bg-[#685dd8] text-white font-semibold text-xs rounded-xl shadow-md transition"
				>
					<Save size={16} />
					<span>{loading ? "Saving..." : "Save Work Order"}</span>
				</button>
			</div>
		</form>
	);
}

// RAB Invoice (Purchase Invoice) List View
function RABInvoiceListView({ onSelectInvoice }: { onSelectInvoice: (invoiceId: string) => void }) {
	const { data: invoices, isLoading, mutate } = useFrappeGetDocList("Purchase Invoice", {
		fields: ["name", "supplier", "posting_date", "due_date", "grand_total", "outstanding_amount", "status", "bill_no", "project"],
		limit: 0,
		orderBy: { field: "creation", order: "desc" },
	});

	if (isLoading) {
		return (
			<div className="p-8 space-y-4 animate-pulse bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]">
				<div className="h-8 bg-slate-200 dark:bg-[#1e1e2d] rounded w-1/4"></div>
				<div className="h-64 bg-slate-200 dark:bg-[#1e1e2d] rounded"></div>
			</div>
		);
	}

	return (
		<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl shadow-sm overflow-hidden">
			<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
				<div>
					<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">All RAB Invoices (Purchase Invoices)</h3>
					<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Subcontractor & Supplier Billing Records</p>
				</div>
				<button
					onClick={() => mutate()}
					className="px-3.5 py-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-600 dark:text-[#8f93a7] hover:text-slate-900 dark:hover:text-white text-xs font-semibold rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-1.5"
				>
					<RefreshCw size={14} /> Refresh
				</button>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-xs">
					<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
						<tr>
							<th className="p-4">Invoice No</th>
							<th className="p-4">Supplier</th>
							<th className="p-4">Project</th>
							<th className="p-4">Posting Date</th>
							<th className="p-4 text-right">Grand Total (₹)</th>
							<th className="p-4 text-right">Outstanding (₹)</th>
							<th className="p-4 text-center">Status</th>
							<th className="p-4 text-center">Action</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
						{invoices && invoices.length > 0 ? (
							invoices.map((row: any) => {
								const outstanding = Number(row.outstanding_amount ?? (row.status === "Paid" ? 0 : row.grand_total));
								return (
									<tr
										key={row.name}
										onClick={() => onSelectInvoice(row.name)}
										className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition cursor-pointer"
									>
										<td className="p-4 font-mono font-bold text-indigo-600 dark:text-[#7367f0]">{row.name}</td>
										<td className="p-4 font-semibold text-slate-900 dark:text-slate-100">{row.supplier || "-"}</td>
										<td className="p-4 text-slate-600 dark:text-[#8f93a7]">{row.project || "-"}</td>
										<td className="p-4 text-slate-600 dark:text-[#8f93a7]">{row.posting_date}</td>
										<td className="p-4 text-right font-bold text-slate-900 dark:text-slate-100">
											{formatCurrency(row.grand_total)}
										</td>
										<td className="p-4 text-right font-bold text-rose-600 dark:text-[#ea5455]">
											{formatCurrency(outstanding)}
										</td>
										<td className="p-4 text-center">
											<span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${outstanding === 0 || row.status === "Paid"
													? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
													: row.status === "Overdue"
														? "bg-rose-500/15 text-rose-600 border border-rose-500/30"
														: "bg-amber-500/15 text-amber-600 border border-amber-500/30"
												}`}>
												{row.status || (outstanding === 0 ? "Paid" : "Unpaid")}
											</span>
										</td>
										<td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
											<button
												onClick={() => onSelectInvoice(row.name)}
												className="p-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-indigo-50 dark:hover:bg-[#7367f0]/20 text-slate-500 dark:text-[#8f93a7] hover:text-indigo-600 dark:hover:text-[#7367f0] rounded-lg transition"
											>
												<Eye size={16} />
											</button>
										</td>
									</tr>
								);
							})
						) : (
							<tr>
								<td colSpan={8} className="p-8 text-center text-slate-400">No RAB Purchase Invoices found.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

// Generic Accounting List View
function GenericAccountingList({
	title,
	doctype,
	fields,
	onRowSelect,
	onSelectEntry,
}: {
	title: string;
	doctype: string;
	fields: string[];
	onRowSelect?: (name: string) => void;
	onSelectEntry?: (name: string) => void;
}) {
	const handleSelect = onSelectEntry || onRowSelect;
	const { data, isLoading, mutate } = useFrappeGetDocList(doctype, {
		fields,
		orderBy: { field: "creation", order: "desc" },
		limit: 0,
	});

	if (isLoading)
		return (
			<div className="p-12 text-center text-slate-400 dark:text-[#8f93a7] font-medium text-xs">
				Loading {title}...
			</div>
		);

	return (
		<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl shadow-sm overflow-hidden">
			<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
				<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">{title}</h3>
				<button
					onClick={() => mutate()}
					className="px-3.5 py-1.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-600 dark:text-[#8f93a7] hover:text-slate-900 dark:hover:text-white text-xs font-semibold rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-1.5"
				>
					<RefreshCw size={14} /> Refresh
				</button>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-xs">
					<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
						<tr>
							{fields.map((f) => (
								<th key={f} className="p-4">
									{f.replace(/_/g, " ")}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
						{data?.map((row: any, idx: number) => (
							<tr
								key={row.name || idx}
								onClick={() => handleSelect && row.name && handleSelect(row.name)}
								className={`hover:bg-indigo-50/70 dark:hover:bg-[#7367f0]/10 transition ${handleSelect ? "cursor-pointer" : ""}`}
							>
								{fields.map((f) => (
									<td
										key={f}
										className={`p-4 font-mono ${
											f === "name"
												? "font-bold text-indigo-600 dark:text-[#7367f0]"
												: "text-slate-800 dark:text-slate-200"
										}`}
									>
										{typeof row[f] === "number"
											? formatCurrency(row[f])
											: String(row[f] ?? "-")}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export default function App() {
	return (
		<FrappeProvider siteName="frappe.local">
			<PortalApp />
		</FrappeProvider>
	);
}