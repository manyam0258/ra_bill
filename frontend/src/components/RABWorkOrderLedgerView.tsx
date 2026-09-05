import React, { useState, useEffect, useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import {
	Layers,
	RefreshCw,
	Printer,
	ExternalLink,
	FileText,
	ChevronDown,
	Building2,
	CreditCard,
	Receipt,
	DollarSign,
	AlertCircle,
	CheckCircle2,
} from "lucide-react";

interface RABWorkOrderLedgerViewProps {
	initialWorkOrder?: string;
	onBack?: () => void;
	onSelectWO?: (woId: string) => void;
	onSelectBill?: (billId: string) => void;
	onSelectInvoice?: (invoiceId: string) => void;
	onSelectPaymentEntry?: (paymentId: string) => void;
}

interface ReportColumn {
	fieldname: string;
	label: string;
	fieldtype: string;
	width: number;
}

interface LedgerRow {
	posting_date: string;
	account: string;
	debit?: number;
	credit?: number;
	amount: number | null;
	entry_type: string;
	voucher_no: string;
	source_voucher: string;
	source_doctype?: string;
	is_header: number;
	status?: string;
	docstatus?: number;
}

interface ReportSummaryItem {
	value: number;
	label: string;
	datatype: string;
	indicator?: string;
}

interface ReportResponse {
	columns: ReportColumn[];
	result: LedgerRow[];
	message?: string;
	report_summary: ReportSummaryItem[];
}

function getFrappeCSRFToken(): string {
	const fromFrappe = (window as any).frappe?.csrf_token;
	if (fromFrappe && fromFrappe !== "Guest") return fromFrappe;
	const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
	if (match) return decodeURIComponent(match[1]);
	return "";
}

async function callFrappeMethod(method: string, args: Record<string, any>) {
	const response = await fetch(`/api/method/${method}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Frappe-CSRF-Token": getFrappeCSRFToken(),
		},
		body: JSON.stringify(args),
	});
	if (!response.ok) {
		const errText = await response.text();
		let detail = errText;
		try {
			const parsed = JSON.parse(errText);
			detail = parsed?.exception || parsed?.message || parsed?.exc || errText;
		} catch (_) {}
		throw new Error(`Frappe API Error: ${detail}`);
	}
	const json = await response.json();
	if (json._error_message || json.exc) {
		throw new Error(json._error_message || json.exc);
	}
	return json.message ?? json;
}

const formatCurrency = (amount: number | undefined | null, currency = "INR") => {
	if (amount === undefined || amount === null) return "-";
	const isNegative = amount < 0;
	const formatted = new Intl.NumberFormat("en-IN", {
		style: "currency",
		currency: currency || "INR",
		maximumFractionDigits: 2,
	}).format(Math.abs(amount));
	return isNegative ? `-${formatted}` : formatted;
};

export function RABWorkOrderLedgerView({
	initialWorkOrder,
	onBack,
	onSelectWO,
	onSelectBill,
	onSelectInvoice,
	onSelectPaymentEntry,
}: RABWorkOrderLedgerViewProps) {
	// 1. Fetch available RAB Work Orders for the filter dropdown
	const { data: rawWorkOrders, isLoading: isLoadingWOs } = useFrappeGetDocList("RAB Work Order", {
		fields: ["name", "supplier", "project", "contract_value", "total_boq_amount", "creation"],
		orderBy: { field: "creation", order: "desc" },
		limit: 100,
	});

	const workOrders = useMemo(() => {
		return (rawWorkOrders || []) as Array<{
			name: string;
			supplier?: string;
			project?: string;
			contract_value?: number;
			total_boq_amount?: number;
		}>;
	}, [rawWorkOrders]);

	// Fetch Suppliers for Supplier-wise filter mode (Task 2)
	const { data: rawSuppliers, isLoading: isLoadingSuppliers } = useFrappeGetDocList("Supplier", {
		fields: ["name", "supplier_name"],
		orderBy: { field: "name", order: "asc" },
		limit: 0,
	});

	const suppliersList = useMemo(() => {
		return (rawSuppliers || []) as Array<{ name: string; supplier_name?: string }>;
	}, [rawSuppliers]);

	const [filterMode, setFilterMode] = useState<"by_wo" | "by_supplier" | "by_project">("by_wo");
	const [selectedSupplier, setSelectedSupplier] = useState<string>("");
	const [selectedProject, setSelectedProject] = useState<string>("");

	const supplierWorkOrders = useMemo(() => {
		if (!selectedSupplier) return [];
		return workOrders.filter((w) => w.supplier === selectedSupplier);
	}, [workOrders, selectedSupplier]);

	const projectsList = useMemo(() => {
		const set = new Set<string>();
		workOrders.forEach((w) => {
			if (w.project) set.add(w.project);
		});
		return Array.from(set).sort();
	}, [workOrders]);

	const projectWorkOrders = useMemo(() => {
		if (!selectedProject) return [];
		return workOrders.filter((w) => w.project === selectedProject);
	}, [workOrders, selectedProject]);

	const [selectedWO, setSelectedWO] = useState<string>(initialWorkOrder || "");
	const [submittingPE, setSubmittingPE] = useState<string | null>(null);

	// Initialize selectedWO once work orders are fetched if not yet set
	useEffect(() => {
		if (!selectedWO && workOrders.length > 0) {
			setSelectedWO(initialWorkOrder || workOrders[0].name);
		}
	}, [workOrders, initialWorkOrder, selectedWO]);

	// Update selectedWO if initialWorkOrder prop changes
	useEffect(() => {
		if (initialWorkOrder) {
			setSelectedWO(initialWorkOrder);
		}
	}, [initialWorkOrder]);

	// 2. Report data state
	const [reportData, setReportData] = useState<ReportResponse | null>(null);
	const [isLoadingReport, setIsLoadingReport] = useState<boolean>(false);
	const [reportError, setReportError] = useState<string | null>(null);

	const fetchLedger = async (woName: string) => {
		if (!woName) return;
		setIsLoadingReport(true);
		setReportError(null);
		try {
			// First try the whitelisted wrapper in ra_bill.api
			let res: ReportResponse;
			try {
				res = await callFrappeMethod("ra_bill.api.run_rab_work_order_ledger", {
					rab_work_order: woName,
				});
			} catch (apiErr) {
				// Fallback to Frappe's standard desk query report runner
				res = await callFrappeMethod("frappe.desk.query_report.run", {
					report_name: "RAB Work Order Ledger",
					filters: { rab_work_order: woName },
				});
			}
			setReportData(res);
		} catch (err: any) {
			console.error("Failed to load RAB Work Order Ledger report:", err);
			setReportError(err?.message || "Failed to load report from server");
		} finally {
			setIsLoadingReport(false);
		}
	};

	const handleSubmitPE = async (peName: string) => {
		if (!peName || submittingPE) return;
		setSubmittingPE(peName);
		try {
			await callFrappeMethod("ra_bill.api.submit_document", {
				doctype: "Payment Entry",
				name: peName,
			});
			if (selectedWO) {
				fetchLedger(selectedWO);
			}
		} catch (err: any) {
			alert(`Failed to submit Payment Entry: ${err.message || String(err)}`);
		} finally {
			setSubmittingPE(null);
		}
	};

	useEffect(() => {
		if (selectedWO) {
			fetchLedger(selectedWO);
		}
	}, [selectedWO]);

	// Current selected Work Order details
	const currentWOInfo = useMemo(() => {
		return workOrders.find((w) => w.name === selectedWO);
	}, [workOrders, selectedWO]);

	// Extract financial metrics from report_summary for the 3 summary cards
	const summaryMap = useMemo(() => {
		const map: Record<string, number> = {};
		if (reportData?.report_summary) {
			for (const item of reportData.report_summary) {
				map[item.label] = Number(item.value || 0);
			}
		}
		return map;
	}, [reportData]);

	// Navigation drill-down handler
	const handleVoucherClick = (voucherNo: string, voucherType?: string) => {
		if (!voucherNo) return;
		const type = voucherType || "";

		if (type === "Purchase Invoice" || voucherNo.startsWith("PINV-") || voucherNo.startsWith("ACC-PINV-")) {
			if (onSelectInvoice) onSelectInvoice(voucherNo);
		} else if (type === "Payment Entry" || voucherNo.startsWith("ACC-PAY-") || voucherNo.startsWith("PAY-")) {
			if (onSelectPaymentEntry) onSelectPaymentEntry(voucherNo);
		} else if (type === "RA Bill" || voucherNo.startsWith("RA-")) {
			if (onSelectBill) onSelectBill(voucherNo);
		} else if (type === "RAB Work Order" || voucherNo.startsWith("RABWO-")) {
			if (onSelectWO) onSelectWO(voucherNo);
		} else {
			// Fallback heuristics based on prefix
			if (voucherNo.startsWith("RABWO-") && onSelectWO) {
				onSelectWO(voucherNo);
			} else if (voucherNo.startsWith("RA-") && onSelectBill) {
				onSelectBill(voucherNo);
			} else if (voucherNo.startsWith("PINV") && onSelectInvoice) {
				onSelectInvoice(voucherNo);
			} else if (onSelectPaymentEntry) {
				onSelectPaymentEntry(voucherNo);
			}
		}
	};

	// Clean HTML from header string
	const cleanHeaderText = (str: string) => {
		return str.replace(/<\/?[^>]+(>|$)/g, "");
	};

	// Badge styling for entry types matching Desk GL conventions
	const getEntryTypeStyle = (type: string) => {
		const lower = type.toLowerCase();
		if (lower.includes("invoice liability")) {
			return "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30";
		}
		if (lower.includes("gross work")) {
			return "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30";
		}
		if (lower.includes("gst")) {
			return "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30";
		}
		if (lower.includes("net payment") || lower.includes("net advance")) {
			return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
		}
		if (lower.includes("deduction")) {
			return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
		}
		if (lower.includes("recovery")) {
			return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
		}
		if (lower.includes("advance disbursed")) {
			return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
		}
		return "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30";
	};

	return (
		<div className="space-y-6 text-slate-800 dark:text-slate-100 transition-colors duration-200 pb-16">
			{/* 1. TOP HEADER & FILTER BAR */}
			<div className="flex flex-wrap items-center justify-between bg-white dark:bg-[#232333] p-5 rounded-2xl border border-slate-200/80 dark:border-[#32344d] gap-4 shadow-sm">
				<div className="flex items-center gap-3">
					<div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-[#7367f0] rounded-xl">
						<Layers size={22} />
					</div>
					<div>
						<div className="flex items-center gap-2">
							<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
								RAB Work Order Ledger
							</h2>
							<span className="px-2.5 py-0.5 text-[11px] font-semibold bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] rounded-full border border-slate-200 dark:border-[#32344d]">
								Desk Report
							</span>
						</div>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
							Direct GL ledger accounting trail and financial position summary matching Frappe Desk
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					{/* Mode Toggle: By Work Order vs By Supplier vs By Project (Task 3) */}
					<div className="flex bg-slate-100 dark:bg-[#1e1e2d] p-1 rounded-xl border border-slate-200 dark:border-[#32344d] text-xs font-semibold">
						<button
							onClick={() => setFilterMode("by_wo")}
							className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
								filterMode === "by_wo"
									? "bg-white dark:bg-[#232333] text-indigo-600 dark:text-[#7367f0] shadow-xs font-bold"
									: "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
							}`}
						>
							By Work Order
						</button>
						<button
							onClick={() => setFilterMode("by_supplier")}
							className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
								filterMode === "by_supplier"
									? "bg-white dark:bg-[#232333] text-indigo-600 dark:text-[#7367f0] shadow-xs font-bold"
									: "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
							}`}
						>
							By Supplier
						</button>
						<button
							onClick={() => setFilterMode("by_project")}
							className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
								filterMode === "by_project"
									? "bg-white dark:bg-[#232333] text-indigo-600 dark:text-[#7367f0] shadow-xs font-bold"
									: "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
							}`}
						>
							By Project
						</button>
					</div>

					{filterMode === "by_project" ? (
						<>
							{/* 1. Project Dropdown */}
							<div className="flex items-center gap-2">
								<label className="text-xs font-semibold text-slate-500 dark:text-[#8f93a7]">
									Project:
								</label>
								<div className="relative min-w-[200px]">
									<select
										value={selectedProject}
										onChange={(e) => {
											const proj = e.target.value;
											setSelectedProject(proj);
											const matchingWOs = workOrders.filter((w) => w.project === proj);
											if (matchingWOs.length > 0) {
												setSelectedWO(matchingWOs[0].name);
											} else {
												setSelectedWO("");
											}
										}}
										className="w-full appearance-none px-3.5 py-2 pr-9 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-sm"
									>
										<option value="">-- Select Project --</option>
										{projectsList.map((p) => (
											<option key={p} value={p}>
												{p}
											</option>
										))}
									</select>
									<ChevronDown
										size={14}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
									/>
								</div>
							</div>

							{/* 2. Filtered Work Order Dropdown */}
							<div className="flex items-center gap-2">
								<label className="text-xs font-semibold text-slate-500 dark:text-[#8f93a7]">
									Work Order:
								</label>
								<div className="relative min-w-[200px]">
									<select
										value={selectedWO}
										onChange={(e) => setSelectedWO(e.target.value)}
										disabled={!selectedProject || projectWorkOrders.length === 0}
										className="w-full appearance-none px-3.5 py-2 pr-9 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-sm disabled:opacity-50"
									>
										{!selectedProject ? (
											<option value="">Select a Project first</option>
										) : projectWorkOrders.length === 0 ? (
											<option value="">No Work Orders for this Project</option>
										) : (
											projectWorkOrders.map((wo) => (
												<option key={wo.name} value={wo.name}>
													{wo.name} {wo.supplier ? `(${wo.supplier})` : ""}
												</option>
											))
										)}
									</select>
									<ChevronDown
										size={14}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
									/>
								</div>
							</div>
						</>
					) : filterMode === "by_supplier" ? (
						<>
							{/* 1. Supplier Dropdown */}
							<div className="flex items-center gap-2">
								<label className="text-xs font-semibold text-slate-500 dark:text-[#8f93a7]">
									Supplier:
								</label>
								<div className="relative min-w-[200px]">
									<select
										value={selectedSupplier}
										onChange={(e) => {
											const supp = e.target.value;
											setSelectedSupplier(supp);
											const matchingWOs = workOrders.filter((w) => w.supplier === supp);
											if (matchingWOs.length > 0) {
												setSelectedWO(matchingWOs[0].name);
											} else {
												setSelectedWO("");
											}
										}}
										className="w-full appearance-none px-3.5 py-2 pr-9 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-sm"
									>
										<option value="">-- Select Supplier --</option>
										{isLoadingSuppliers ? (
											<option value="">Loading Suppliers...</option>
										) : (
											suppliersList.map((s) => (
												<option key={s.name} value={s.name}>
													{s.supplier_name ? `${s.supplier_name} (${s.name})` : s.name}
												</option>
											))
										)}
									</select>
									<ChevronDown
										size={14}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
									/>
								</div>
							</div>

							{/* 2. Filtered Work Order Dropdown */}
							<div className="flex items-center gap-2">
								<label className="text-xs font-semibold text-slate-500 dark:text-[#8f93a7]">
									Work Order:
								</label>
								<div className="relative min-w-[200px]">
									<select
										value={selectedWO}
										onChange={(e) => setSelectedWO(e.target.value)}
										disabled={!selectedSupplier || supplierWorkOrders.length === 0}
										className="w-full appearance-none px-3.5 py-2 pr-9 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-sm disabled:opacity-50"
									>
										{!selectedSupplier ? (
											<option value="">Select a Supplier first</option>
										) : supplierWorkOrders.length === 0 ? (
											<option value="">No Work Orders for this Supplier</option>
										) : (
											supplierWorkOrders.map((wo) => (
												<option key={wo.name} value={wo.name}>
													{wo.name} {wo.project ? `(${wo.project})` : ""}
												</option>
											))
										)}
									</select>
									<ChevronDown
										size={14}
										className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
									/>
								</div>
							</div>
						</>
					) : (
						/* Direct Work Order Filter Dropdown */
						<div className="flex items-center gap-2">
							<label className="text-xs font-semibold text-slate-500 dark:text-[#8f93a7]">
								RAB Work Order:
							</label>
							<div className="relative min-w-[220px]">
								<select
									value={selectedWO}
									onChange={(e) => setSelectedWO(e.target.value)}
									className="w-full appearance-none px-3.5 py-2 pr-9 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-600 cursor-pointer shadow-sm"
								>
									{isLoadingWOs ? (
										<option value="">Loading Work Orders...</option>
									) : workOrders.length === 0 ? (
										<option value="">No Work Orders Found</option>
									) : (
										workOrders.map((wo) => (
											<option key={wo.name} value={wo.name}>
												{wo.name} {wo.supplier ? `(${wo.supplier})` : ""}
											</option>
										))
									)}
								</select>
								<ChevronDown
									size={14}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
								/>
							</div>
						</div>
					)}

					{/* Refresh Button */}
					<button
						onClick={() => selectedWO && fetchLedger(selectedWO)}
						disabled={isLoadingReport || !selectedWO}
						className="p-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-[#32344d] transition cursor-pointer"
						title="Refresh Ledger Report"
					>
						<RefreshCw size={15} className={isLoadingReport ? "animate-spin" : ""} />
					</button>

					{/* Print Button */}
					<button
						onClick={() => window.print()}
						className="p-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-[#32344d] transition cursor-pointer"
						title="Print Ledger Report"
					>
						<Printer size={15} />
					</button>
				</div>
			</div>

			{/* WORK ORDER QUICK INFO BAR */}
			{currentWOInfo && (
				<div className="flex flex-wrap items-center justify-between px-5 py-3 bg-slate-50 dark:bg-[#1e1e2d] rounded-xl border border-slate-200 dark:border-[#32344d] text-xs">
					<div className="flex flex-wrap items-center gap-4">
						<span className="flex items-center gap-1.5 text-slate-600 dark:text-[#8f93a7]">
							<FileText size={14} className="text-indigo-500" />
							<span>Work Order:</span>
							<strong className="font-mono text-slate-900 dark:text-slate-100">
								{currentWOInfo.name}
							</strong>
						</span>
						{currentWOInfo.project && (
							<span className="flex items-center gap-1.5 text-slate-600 dark:text-[#8f93a7]">
								<Building2 size={14} className="text-emerald-500" />
								<span>Project:</span>
								<strong className="text-slate-900 dark:text-slate-100">
									{currentWOInfo.project}
								</strong>
							</span>
						)}
						{currentWOInfo.supplier && (
							<span className="flex items-center gap-1.5 text-slate-600 dark:text-[#8f93a7]">
								<span>Contractor / Supplier:</span>
								<strong className="text-slate-900 dark:text-slate-100">
									{currentWOInfo.supplier}
								</strong>
							</span>
						)}
					</div>
					<div className="text-slate-600 dark:text-[#8f93a7]">
						<span>Contract Value: </span>
						<strong className="text-slate-900 dark:text-slate-100 font-bold">
							{formatCurrency(currentWOInfo.contract_value || currentWOInfo.total_boq_amount || 0)}
						</strong>
					</div>
				</div>
			)}

			{/* ERROR MESSAGE */}
			{reportError && (
				<div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-600 dark:text-rose-400 flex items-center gap-2">
					<AlertCircle size={16} />
					<span>{reportError}</span>
				</div>
			)}

			{/* 2. SUMMARY SECTION (Exact Match to Frappe Desk Report Summary Message) */}
			{reportData && (
				<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-5">
					<div className="border-b border-indigo-500/30 pb-3">
						<h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 tracking-wide uppercase">
							RAB Work Order Accounting Flow & Financial Position Summary
						</h3>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
						{/* Card 1: Billing & Invoice */}
						<div className="bg-slate-50/80 dark:bg-[#1e1e2d] p-4 rounded-xl border border-slate-200 dark:border-[#2d2d3f] space-y-2.5">
							<div className="font-bold text-slate-800 dark:text-slate-200 pb-1.5 border-b border-slate-200 dark:border-[#32344d] flex items-center justify-between">
								<span>Billing & Invoice</span>
								<Receipt size={15} className="text-indigo-500" />
							</div>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>Gross Work Billed:</span>
								<strong className="text-slate-900 dark:text-slate-100">
									{formatCurrency(summaryMap["Gross Work Billed"] || 0)}
								</strong>
							</div>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>GST:</span>
								<strong className="text-slate-900 dark:text-slate-100">
									{formatCurrency(summaryMap["GST Amount"] || 0)}
								</strong>
							</div>
							<div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-300 dark:border-[#32344d] text-[13px]">
								<span className="font-semibold text-slate-700 dark:text-slate-300">
									Invoice Value:
								</span>
								<strong className="font-bold text-indigo-600 dark:text-[#7367f0]">
									{formatCurrency(summaryMap["Purchase Invoice Total"] || 0)}
								</strong>
							</div>
						</div>

						{/* Card 2: Deductions & Recoveries */}
						<div className="bg-slate-50/80 dark:bg-[#1e1e2d] p-4 rounded-xl border border-slate-200 dark:border-[#2d2d3f] space-y-2.5">
							<div className="font-bold text-slate-800 dark:text-slate-200 pb-1.5 border-b border-slate-200 dark:border-[#32344d] flex items-center justify-between">
								<span>Deductions & Recoveries</span>
								<CreditCard size={15} className="text-rose-500" />
							</div>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>Total Deductions:</span>
								<span className="font-semibold text-rose-600 dark:text-rose-400">
									-{formatCurrency(summaryMap["Total Deductions"] || 0)}
								</span>
							</div>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>Advance Recovered:</span>
								<span className="font-semibold text-rose-600 dark:text-rose-400">
									-{formatCurrency(summaryMap["Advance Recovered"] || 0)}
								</span>
							</div>
							<div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-300 dark:border-[#32344d] text-[13px]">
								<span className="font-semibold text-slate-700 dark:text-slate-300">
									Net Paid to Contractor:
								</span>
								<strong className="font-bold text-emerald-600 dark:text-[#28c76f]">
									{formatCurrency(summaryMap["Net Paid to Contractor"] || 0)}
								</strong>
							</div>
						</div>

						{/* Card 3: Mobilization / Ad Hoc Advance */}
						<div className="bg-slate-50/80 dark:bg-[#1e1e2d] p-4 rounded-xl border border-slate-200 dark:border-[#2d2d3f] space-y-2.5">
							<div className="font-bold text-slate-800 dark:text-slate-200 pb-1.5 border-b border-slate-200 dark:border-[#32344d] flex items-center justify-between">
								<span>Mobilization / Ad Hoc Advance</span>
								<DollarSign size={15} className="text-amber-500" />
							</div>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>Original Advance Disbursed:</span>
								<strong className="text-slate-900 dark:text-slate-100">
									{formatCurrency(summaryMap["Original Advance Disbursed"] || 0)}
								</strong>
							</div>
							<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
								<span>Recovered to Date:</span>
								<span className="font-semibold text-emerald-600 dark:text-[#28c76f]">
									{formatCurrency(summaryMap["Advance Recovered"] || 0)}
								</span>
							</div>
							<div className="flex justify-between items-center pt-2 border-t border-dashed border-slate-300 dark:border-[#32344d] text-[13px]">
								<span className="font-semibold text-slate-700 dark:text-slate-300">
									Balance Outstanding:
								</span>
								<strong
									className={`font-bold ${
										(summaryMap["Advance Outstanding"] || 0) > 0
											? "text-rose-600 dark:text-rose-400"
											: "text-emerald-600 dark:text-[#28c76f]"
									}`}
								>
									{formatCurrency(summaryMap["Advance Outstanding"] || 0)}
								</strong>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* 3. REPORT SUMMARY KPI STRIP (All 9 metrics from Desk Report Summary) */}
			{reportData?.report_summary && reportData.report_summary.length > 0 && (
				<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
					{reportData.report_summary.map((kpi, idx) => {
						const isRed = kpi.indicator === "Red";
						const isGreen = kpi.indicator === "Green";
						return (
							<div
								key={idx}
								className="bg-white dark:bg-[#232333] p-3.5 rounded-xl border border-slate-200/80 dark:border-[#32344d] shadow-sm flex flex-col justify-between"
							>
								<div className="text-[11px] font-semibold text-slate-500 dark:text-[#8f93a7] truncate">
									{kpi.label}
								</div>
								<div
									className={`text-base font-bold mt-1 truncate ${
										isRed
											? "text-rose-600 dark:text-rose-400"
											: isGreen
											? "text-emerald-600 dark:text-[#28c76f]"
											: "text-slate-900 dark:text-slate-100"
									}`}
								>
									{formatCurrency(kpi.value)}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* 4. EXACT DESK LEDGER TABLE */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl shadow-sm overflow-hidden">
				<div className="p-4 border-b border-slate-200 dark:border-[#32344d] flex items-center justify-between">
					<h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
						Ledger Entries ({reportData?.result?.length || 0} rows)
					</h3>
					<span className="text-xs text-slate-500 dark:text-[#8f93a7]">
						Columns & order match Frappe Desk Query Report exactly
					</span>
				</div>

				<div className="overflow-x-auto">
					<table className="w-full text-left border-collapse text-xs">
						<thead>
							<tr className="bg-slate-50 dark:bg-[#1e1e2d] text-slate-500 dark:text-[#8f93a7] font-semibold border-b border-slate-200 dark:border-[#32344d]">
								<th className="p-3.5 whitespace-nowrap w-[110px]">Posting Date</th>
								<th className="p-3.5 whitespace-nowrap min-w-[220px]">Account</th>
								<th className="p-3.5 whitespace-nowrap text-right w-[130px]">Amount</th>
								<th className="p-3.5 whitespace-nowrap w-[180px]">Type</th>
								<th className="p-3.5 whitespace-nowrap w-[160px]">Voucher No</th>
								<th className="p-3.5 whitespace-nowrap w-[180px]">Source Voucher</th>
								<th className="p-3.5 whitespace-nowrap text-center w-[140px]">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200/70 dark:divide-[#32344d]/70">
							{isLoadingReport ? (
								<tr>
									<td colSpan={7} className="p-12 text-center text-slate-500">
										<div className="flex flex-col items-center justify-center gap-2">
											<RefreshCw size={24} className="animate-spin text-indigo-500" />
											<span>Loading Work Order Ledger...</span>
										</div>
									</td>
								</tr>
							) : !reportData || reportData.result.length === 0 ? (
								<tr>
									<td colSpan={7} className="p-12 text-center text-slate-400">
										No transactions or ledger entries recorded for this Work Order.
									</td>
								</tr>
							) : (
								reportData.result.map((row, index) => {
									// Header row formatting identical to Desk's report formatter:
									// grey background, bold title spanning or inside account cell
									if (row.is_header) {
										const cleanTitle = cleanHeaderText(row.account);
										return (
											<tr
												key={`header-${index}`}
												className="bg-slate-100/90 dark:bg-[#282a42] border-y border-slate-200 dark:border-[#383a54]"
											>
												<td className="p-3 font-semibold text-slate-400 text-xs">
													{/* Section marker */}
												</td>
												<td className="p-3 text-[13px] font-bold text-slate-900 dark:text-slate-100">
													<div className="flex items-center gap-2">
														<span>{cleanTitle}</span>
													</div>
												</td>
												<td className="p-3"></td>
												<td className="p-3"></td>
												<td className="p-3 font-mono text-slate-500 dark:text-[#8f93a7]">
													{row.voucher_no && (
														<button
															onClick={() =>
																handleVoucherClick(row.voucher_no, "RAB Work Order")
															}
															className="hover:text-indigo-600 dark:hover:text-[#7367f0] hover:underline cursor-pointer"
														>
															{row.voucher_no}
														</button>
													)}
												</td>
												<td className="p-3 font-mono">
													{row.source_voucher && (
														<button
															onClick={() =>
																handleVoucherClick(
																	row.source_voucher,
																	row.source_doctype
																)
															}
															className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-[#7367f0] hover:bg-indigo-500/20 transition font-bold flex items-center gap-1 cursor-pointer"
														>
															<span>{row.source_voucher}</span>
															<ExternalLink size={12} />
														</button>
													)}
												</td>
												<td className="p-3 text-center">
													{row.source_voucher && (
														<div className="flex items-center justify-center gap-1.5">
															<span
																className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
																	row.docstatus === 0
																		? "bg-amber-500/15 text-amber-600 dark:text-[#ff9f43] border-amber-500/30"
																		: row.docstatus === 2
																		? "bg-rose-500/15 text-rose-600 border-rose-500/30"
																		: "bg-emerald-500/15 text-emerald-600 dark:text-[#28c76f] border-emerald-500/30"
																}`}
															>
																{row.docstatus === 0 ? "Draft" : row.docstatus === 2 ? "Cancelled" : "Submitted"}
															</span>
															{row.docstatus === 0 && row.source_doctype === "Payment Entry" && (
																<button
																	onClick={() => handleSubmitPE(row.source_voucher)}
																	disabled={submittingPE === row.source_voucher}
																	className="px-2 py-0.5 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
																	title="Submit this draft Payment Entry"
																>
																	<CheckCircle2 size={11} />
																	<span>{submittingPE === row.source_voucher ? "..." : "Submit"}</span>
																</button>
															)}
														</div>
													)}
												</td>
											</tr>
										);
									}

									// Detail GL Row
									const isNegativeAmt = row.amount !== null && row.amount < 0;

									return (
										<tr
											key={`row-${index}`}
											className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/50 transition-colors"
										>
											{/* 1. Posting Date */}
											<td className="p-3.5 whitespace-nowrap text-slate-600 dark:text-[#8f93a7] font-mono">
												{row.posting_date || "-"}
											</td>

											{/* 2. Account */}
											<td className="p-3.5 font-medium text-slate-800 dark:text-slate-200">
												{row.account}
											</td>

											{/* 3. Amount */}
											<td
												className={`p-3.5 whitespace-nowrap text-right font-semibold font-mono ${
													isNegativeAmt
														? "text-rose-600 dark:text-rose-400"
														: "text-slate-900 dark:text-slate-100"
												}`}
											>
												{formatCurrency(row.amount)}
											</td>

											{/* 4. Type */}
											<td className="p-3.5 whitespace-nowrap">
												{row.entry_type ? (
													<span
														className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${getEntryTypeStyle(
															row.entry_type
														)}`}
													>
														{row.entry_type}
													</span>
												) : (
													"-"
												)}
											</td>

											{/* 5. Voucher No */}
											<td className="p-3.5 whitespace-nowrap font-mono text-slate-600 dark:text-[#8f93a7]">
												{row.voucher_no ? (
													<button
														onClick={() =>
															handleVoucherClick(row.voucher_no, "RAB Work Order")
														}
														className="hover:text-indigo-600 dark:hover:text-[#7367f0] hover:underline cursor-pointer flex items-center gap-1"
													>
														<span>{row.voucher_no}</span>
													</button>
												) : (
													"-"
												)}
											</td>

											{/* 6. Source Voucher */}
											<td className="p-3.5 whitespace-nowrap font-mono">
												{row.source_voucher ? (
													<button
														onClick={() =>
															handleVoucherClick(
																row.source_voucher,
																row.source_doctype
															)
														}
														className="text-indigo-600 dark:text-[#7367f0] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
													>
														<span>{row.source_voucher}</span>
														<ExternalLink size={12} className="opacity-70" />
													</button>
												) : (
													"-"
												)}
											</td>

											{/* 7. Status & Action */}
											<td className="p-3.5 whitespace-nowrap text-center">
												<div className="flex items-center justify-center gap-1.5">
													<span
														className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
															row.docstatus === 0
																? "bg-amber-500/15 text-amber-600 dark:text-[#ff9f43] border-amber-500/30"
																: row.docstatus === 2
																? "bg-rose-500/15 text-rose-600 border-rose-500/30"
																: "bg-emerald-500/15 text-emerald-600 dark:text-[#28c76f] border-emerald-500/30"
														}`}
													>
														{row.docstatus === 0 ? "Draft" : row.docstatus === 2 ? "Cancelled" : "Submitted"}
													</span>
													{row.docstatus === 0 && row.source_doctype === "Payment Entry" && row.source_voucher && (
														<button
															onClick={() => handleSubmitPE(row.source_voucher)}
															disabled={submittingPE === row.source_voucher}
															className="px-2 py-0.5 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 text-white rounded text-[10px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
															title="Submit this draft Payment Entry"
														>
															<CheckCircle2 size={11} />
															<span>{submittingPE === row.source_voucher ? "..." : "Submit"}</span>
														</button>
													)}
												</div>
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
	);
}

export { RABWorkOrderLedgerView as RABWorkOrderLedger };
