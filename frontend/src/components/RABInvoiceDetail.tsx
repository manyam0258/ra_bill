import React, { useState, useEffect } from "react";
import { useFrappeGetDoc } from "frappe-react-sdk";
import {
	ArrowLeft,
	Printer,
	ChevronDown,
	CheckSquare,
	Square,
	FileText,
	DollarSign,
	Receipt,
	FileCheck,
	CheckCircle2,
	Coins,
	ArrowRight,
} from "lucide-react";

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
import { callFrappeMethod, parseFrappeError } from "../utils/frappeErrors";

interface RABInvoiceDetailProps {
	invoiceId: string;
	onBack: () => void;
	onSelectPaymentEntry?: (peId: string) => void;
}

export function RABInvoiceDetail({ invoiceId, onBack, onSelectPaymentEntry }: RABInvoiceDetailProps) {
	const { data: doc, isLoading, mutate } = useFrappeGetDoc("Purchase Invoice", invoiceId);
	const [activeSubTab, setActiveSubTab] = useState<"details" | "payments" | "terms" | "more" | "connections">("details");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isCreatingPE, setIsCreatingPE] = useState(false);
	const [linkedPEs, setLinkedPEs] = useState<any[]>([]);

	// ── PE creation dialog state ───────────────────────────────────────
	const [showPEDialog, setShowPEDialog] = useState(false);
	const [mopListInv, setMopListInv] = useState<Array<{ name: string; type: string }>>([]);
	const [selectedMopInv, setSelectedMopInv] = useState("");
	const [mopTypeInv, setMopTypeInv] = useState<"Bank" | "Cash" | "">(" ".trim() as any);
	const [paidFromInv, setPaidFromInv] = useState("");
	const [pePostingDateInv, setPePostingDateInv] = useState(new Date().toISOString().split("T")[0]);
	const [peRefNoInv, setPeRefNoInv] = useState("");
	const [peRefDateInv, setPeRefDateInv] = useState(new Date().toISOString().split("T")[0]);
	const [isSubmittingPEInv, setIsSubmittingPEInv] = useState(false);
	const [peErrorInv, setPeErrorInv] = useState("");

	const fetchLinkedPEs = async () => {
		try {
			const data = await callFrappeMethod("ra_bill.api.get_linked_payment_entries", {
				doctype: "Purchase Invoice",
				name: invoiceId,
			});
			setLinkedPEs(data || []);
		} catch (e) {
			console.error("Failed to fetch linked payment entries", e);
		}
	};

	useEffect(() => {
		if (doc) {
			fetchLinkedPEs();
		}
	}, [doc]);

	const handleSubmitInvoice = async () => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		try {
			await callFrappeMethod("ra_bill.api.submit_document", { doctype: "Purchase Invoice", name: invoiceId });
			mutate();
			try {
				const peRes = await callFrappeMethod("ra_bill.api.create_payment_entry_from_invoice", {
					invoice_name: invoiceId,
					reference_no: `PAY-${invoiceId}`,
					reference_date: new Date().toISOString().split("T")[0],
				});
				const peId = peRes.payment_entry || peRes;
				if (onSelectPaymentEntry) {
					onSelectPaymentEntry(peId);
				}
			} catch (ePE) {
				if (onSelectPaymentEntry && linkedPEs.length > 0) {
					onSelectPaymentEntry(linkedPEs[0].name);
				}
			}
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Submit Invoice Failed");
			alert(parsed.message);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Opens the PE dialog, fetching MoP list dynamically from Frappe
	const handleOpenPEDialog = async () => {
		if (isCreatingPE) return;
		const today = new Date().toISOString().split("T")[0];
		setPePostingDateInv(today);
		setPeRefDateInv(today);
		setPeRefNoInv(`PAY-${invoiceId}`);
		setPeErrorInv("");
		setIsCreatingPE(true);
		try {
			const mops = await callFrappeMethod("frappe.client.get_list", {
				doctype: "Mode of Payment",
				fields: ["name", "type"],
				limit: 50,
			});
			const list: Array<{ name: string; type: string }> = Array.isArray(mops) ? mops : [];
			setMopListInv(list);
			const cashMop = list.find((m) => m.type === "Cash");
			const defaultMop = cashMop || list[0];
			if (defaultMop) {
				setSelectedMopInv(defaultMop.name);
				setMopTypeInv((defaultMop.type as any) || "");
				try {
					const accRes = await callFrappeMethod("ra_bill.api.get_default_payment_account", {
						mode_of_payment: defaultMop.name,
						company: doc?.company || "Tridasa",
					});
					setPaidFromInv(accRes?.account || "");
				} catch (_) {
					setPaidFromInv("");
				}
			} else {
				setSelectedMopInv("");
				setMopTypeInv("");
				setPaidFromInv("");
			}
		} catch (_) {
			setMopListInv([]);
		} finally {
			setIsCreatingPE(false);
		}
		setShowPEDialog(true);
	};

	const handleMopChangeInv = async (mopName: string) => {
		setSelectedMopInv(mopName);
		const mop = mopListInv.find((m) => m.name === mopName);
		setMopTypeInv((mop?.type as any) || "");
		try {
			const accRes = await callFrappeMethod("ra_bill.api.get_default_payment_account", {
				mode_of_payment: mopName,
				company: doc?.company || "Tridasa",
			});
			setPaidFromInv(accRes?.account || "");
		} catch (_) {
			setPaidFromInv("");
		}
	};

	const handleCreatePaymentEntry = async () => {
		if (isSubmittingPEInv || !showPEDialog) return;
		setPeErrorInv("");

		// Client-side Bank validation — mirrors ERPNext validate_reference_details
		if (mopTypeInv === "Bank") {
			if (!peRefNoInv.trim()) {
				setPeErrorInv("Reference No (UTR / Cheque) is mandatory for Bank transactions.");
				return;
			}
			if (!peRefDateInv) {
				setPeErrorInv("Reference Date is mandatory for Bank transactions.");
				return;
			}
		}

		setIsSubmittingPEInv(true);
		try {
			const res = await callFrappeMethod("ra_bill.api.create_payment_entry_from_invoice", {
				invoice_name: invoiceId,
				reference_no: peRefNoInv.trim() || `PAY-${invoiceId}`,
				reference_date: peRefDateInv || new Date().toISOString().split("T")[0],
				...(selectedMopInv ? { mode_of_payment: selectedMopInv } : {}),
				...(paidFromInv ? { paid_from: paidFromInv } : {}),
			});
			const peId = res.payment_entry || res;
			setShowPEDialog(false);
			if (onSelectPaymentEntry) {
				onSelectPaymentEntry(peId);
			}
			fetchLinkedPEs();
		} catch (err: any) {
			const parsed = parseFrappeError(err, "Payment Entry Creation Failed");
			setPeErrorInv(parsed.message);
		} finally {
			setIsSubmittingPEInv(false);
		}
	};


	if (isLoading) {
		return (
			<div className="p-8 space-y-6 animate-pulse">
				<div className="h-16 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
				<div className="h-32 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
				<div className="h-64 bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d]"></div>
			</div>
		);
	}

	if (!doc) {
		return (
			<div className="p-12 text-center bg-white dark:bg-[#232333] rounded-2xl border border-slate-200 dark:border-[#32344d] text-rose-600 dark:text-[#ea5455]">
				RAB Invoice #{invoiceId} not found.
			</div>
		);
	}

	const totalQty = doc.total_qty ?? doc.items?.reduce((acc: number, item: any) => acc + (Number(item.qty) || 0), 0) ?? 0;
	const netTotal = Number(doc.net_total || doc.total || 0);
	const grandTotal = Number(doc.grand_total || doc.rounded_total || 0);
	const outstandingAmount = Number(doc.outstanding_amount ?? (doc.status === "Paid" ? 0 : grandTotal));

	const deductionsList = doc.deductions || doc.ra_bill_deductions || [];
	const totalDeductions = Number(doc.total_ra_deductions || doc.total_deductions || deductionsList.reduce((acc: number, d: any) => acc + Number(d.amount || 0), 0));
	const netPaymentDisplay = Number(doc.net_payment_display || doc.net_payable || (grandTotal - totalDeductions));

	const taxesList = doc.taxes || [];
	const taxesAdded = Number(doc.taxes_and_charges_added || taxesList.reduce((acc: number, t: any) => acc + (t.tax_amount > 0 ? Number(t.tax_amount) : 0), 0));
	const taxesDeducted = Number(doc.taxes_and_charges_deducted || taxesList.reduce((acc: number, t: any) => acc + (t.tax_amount < 0 ? Math.abs(Number(t.tax_amount)) : 0), 0));
	const totalTaxes = Number(doc.total_taxes_and_charges || (taxesAdded - taxesDeducted));

	return (
		<div className="space-y-6 text-slate-800 dark:text-slate-100 transition-colors duration-200 pb-12">

			{/* 1. HEADER & TOP ACTIONS */}
			<div className="flex flex-wrap items-center justify-between bg-white dark:bg-[#232333] p-5 rounded-2xl border border-slate-200/80 dark:border-[#32344d] gap-4 shadow-sm">
				<div className="flex items-center gap-4">
					<button
						onClick={onBack}
						className="p-2.5 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 dark:hover:bg-[#282a42] text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-[#32344d] transition flex items-center gap-2 text-xs font-semibold"
					>
						<ArrowLeft size={16} />
						<span>Back</span>
					</button>
					<div>
						<div className="flex items-center gap-2.5">
							<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{doc.name}</h2>
							<span className={`px-3 py-0.5 rounded-full text-xs font-bold ${outstandingAmount === 0 || doc.status === "Paid"
								? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
								: doc.status === "Overdue"
									? "bg-rose-500/15 text-rose-600 border border-rose-500/30"
									: "bg-amber-500/15 text-amber-600 border border-amber-500/30"
								}`}>
								{doc.status || (outstandingAmount === 0 ? "Paid" : "Unpaid")}
							</span>
						</div>
						<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
							Supplier: <span className="font-bold text-slate-800 dark:text-slate-200">{doc.supplier || "-"}</span>
						</p>
					</div>
				</div>

				{/* Right Action Buttons */}
				<div className="flex flex-wrap items-center gap-2 text-xs">
					{doc.docstatus === 0 && (
						<button
							onClick={handleSubmitInvoice}
							disabled={isSubmitting}
							className="px-4 py-2 bg-emerald-600 dark:bg-[#28c76f] hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
						>
							<CheckCircle2 size={15} />
							<span>{isSubmitting ? "Submitting..." : "Submit Invoice"}</span>
						</button>
					)}

					{doc.docstatus === 1 && (
						<button
							onClick={handleOpenPEDialog}
							disabled={isCreatingPE}
							className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition flex items-center gap-1.5 cursor-pointer"
						>
							<DollarSign size={15} />
							<span>{isCreatingPE ? "Loading..." : "Make Payment (PE)"}</span>
						</button>
					)}

					<button className="p-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-[#32344d]" title="Print">
						<Printer size={15} />
					</button>
				</div>
			</div>

			{/* 2. TABS BAR */}
			<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-2 shadow-sm flex flex-wrap gap-2 text-xs">
				{(["details", "payments", "terms", "more", "connections"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveSubTab(tab)}
						className={`px-4 py-2 rounded-xl font-bold uppercase tracking-wider transition ${activeSubTab === tab
							? "bg-indigo-600 dark:bg-[#7367f0] text-white shadow-xs"
							: "text-slate-600 dark:text-[#8f93a7] hover:bg-slate-100 dark:hover:bg-[#1e1e2d]"
							}`}
					>
						{tab.replace("_", " ")}
					</button>
				))}
			</div>

			{/* PAYMENTS SUBTAB */}
			{activeSubTab === "payments" && (
				<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
					<div className="flex justify-between items-center border-b border-slate-200 dark:border-[#32344d] pb-3">
						<div>
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Linked Payment Entries</h3>
							<p className="text-xs text-slate-500 dark:text-[#8f93a7]">Genuinely linked payment vouchers for this invoice / RA bill chain.</p>
						</div>
						{doc.docstatus === 1 && (
							<button
								onClick={handleOpenPEDialog}
								disabled={isCreatingPE}
								className="px-3.5 py-1.5 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
							>
								<DollarSign size={14} />
								<span>{isCreatingPE ? "Loading..." : "Make Payment"}</span>
							</button>
						)}
					</div>

					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
								<tr>
									<th className="p-3 w-10">No.</th>
									<th className="p-3">Payment Entry</th>
									<th className="p-3">Posting Date</th>
									<th className="p-3">Party</th>
									<th className="p-3 text-right">Amount</th>
									<th className="p-3 text-center">Status</th>
									<th className="p-3 text-center">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
								{linkedPEs && linkedPEs.length > 0 ? (
									linkedPEs.map((pe: any, idx: number) => (
										<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
											<td className="p-3 text-slate-400 font-semibold">{idx + 1}</td>
											<td className="p-3 font-mono font-bold text-indigo-600 dark:text-[#7367f0]">{pe.name}</td>
											<td className="p-3 text-slate-600 dark:text-slate-300">{pe.posting_date}</td>
											<td className="p-3 font-semibold text-slate-800 dark:text-slate-200">{pe.party_name || pe.party}</td>
											<td className="p-3 text-right font-bold text-emerald-600 dark:text-[#28c76f]">
												{formatCurrency(pe.paid_amount || pe.received_amount, doc.currency)}
											</td>
											<td className="p-3 text-center">
												<span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${pe.docstatus === 1 ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
													}`}>
													{pe.docstatus === 1 ? "Submitted" : "Draft"}
												</span>
											</td>
											<td className="p-3 text-center">
												{onSelectPaymentEntry && (
													<button
														onClick={() => onSelectPaymentEntry(pe.name)}
														className="px-3 py-1 bg-indigo-50 dark:bg-[#7367f0]/15 hover:bg-indigo-100 text-indigo-600 dark:text-[#7367f0] font-semibold rounded-lg text-xs transition flex items-center gap-1 mx-auto"
													>
														<span>View</span>
														<ArrowRight size={12} />
													</button>
												)}
											</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan={7} className="p-8 text-center text-slate-400">
											No payment entries linked yet for this invoice.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{activeSubTab === "details" && (
				<div className="space-y-6">
					{/* 3. SECTION 1: BASIC INFORMATION (3-Column Grid) */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">
							Basic Information
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
							{/* Column 1 */}
							<div className="space-y-3">
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Supplier:</span>
									<span className="font-bold text-slate-900 dark:text-slate-100">{doc.supplier || "-"}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Company:</span>
									<span className="font-semibold text-slate-800 dark:text-slate-200">{doc.company || "-"}</span>
								</div>
							</div>

							{/* Column 2 */}
							<div className="space-y-3">
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Posting Date:</span>
									<span className="font-semibold text-slate-800 dark:text-slate-200">{doc.posting_date || "-"}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Posting Time:</span>
									<span className="font-mono text-slate-600 dark:text-slate-300">{doc.posting_time || "-"}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Due Date:</span>
									<span className="font-semibold text-slate-800 dark:text-slate-200">{doc.due_date || doc.posting_date || "-"}</span>
								</div>
							</div>

							{/* Column 3 (Checkboxes) */}
							<div className="space-y-2.5 bg-slate-50 dark:bg-[#1e1e2d] p-4 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<div className="flex items-center gap-2">
									{doc.is_paid ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
									<span className="font-semibold text-slate-800 dark:text-slate-200">Is Paid</span>
								</div>
								<div className="flex items-center gap-2">
									{doc.is_return ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
									<span className="font-semibold text-slate-800 dark:text-slate-200">Is Return (Debit Note)</span>
								</div>
								<div className="flex items-center gap-2">
									{doc.apply_tds !== 0 ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
									<span className="font-semibold text-slate-800 dark:text-slate-200">Apply Tax Withholding Amount</span>
								</div>
								<div className="flex items-center gap-2">
									{doc.is_reverse_charge ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-400" />}
									<span className="font-semibold text-slate-800 dark:text-slate-200">Is Reverse Charge</span>
								</div>
							</div>
						</div>
					</div>

					{/* 4. SECTION 2: DIMENSIONS & REFERENCES */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">
							Accounting Dimensions & References
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
							<div className="bg-slate-50 dark:bg-[#1e1e2d] p-3.5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<span className="text-slate-500 dark:text-[#8f93a7]">Cost Center:</span>
								<p className="font-semibold text-slate-800 dark:text-slate-200 mt-1">{doc.cost_center || "Main - T"}</p>
							</div>
							<div className="bg-slate-50 dark:bg-[#1e1e2d] p-3.5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<span className="text-slate-500 dark:text-[#8f93a7]">Project Link:</span>
								<p className="font-bold text-slate-900 dark:text-slate-100 mt-1">{doc.project || "RISE"}</p>
							</div>
							<div className="bg-slate-50 dark:bg-[#1e1e2d] p-3.5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<span className="text-slate-500 dark:text-[#8f93a7]">RA Bill Link:</span>
								<p className="font-mono font-bold text-indigo-600 dark:text-[#7367f0] mt-1">{doc.ra_bill || "-"}</p>
							</div>
							<div className="bg-slate-50 dark:bg-[#1e1e2d] p-3.5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<span className="text-slate-500 dark:text-[#8f93a7]">Bill No / Ref:</span>
								<p className="font-mono text-slate-800 dark:text-slate-200 mt-1">{doc.bill_no || doc.name}</p>
							</div>
						</div>
					</div>

					{/* 5. SECTION 3: PURCHASE INVOICE ITEMS (Dynamic Loop) */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm space-y-0">
						<div className="p-5 border-b border-slate-200 dark:border-[#32344d] flex justify-between items-center">
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Items Table</h3>
							<span className="text-xs text-slate-500 dark:text-[#8f93a7]">Line Items ({doc.items?.length || 0})</span>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
									<tr>
										<th className="p-3.5 w-10">No.</th>
										<th className="p-3.5">Item Code & Description</th>
										<th className="p-3.5 text-right">Qty</th>
										<th className="p-3.5 text-right">Rate</th>
										<th className="p-3.5 text-right">Amount ({doc.currency || "INR"})</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
									{doc.items && doc.items.length > 0 ? (
										doc.items.map((it: any, idx: number) => (
											<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
												<td className="p-3.5 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3.5 font-bold text-slate-900 dark:text-slate-100">
													<span className="block font-mono text-indigo-600 dark:text-[#7367f0]">{it.item_code}</span>
													<span className="font-normal text-slate-600 dark:text-slate-300">{it.item_name || it.description || "-"}</span>
												</td>
												<td className="p-3.5 text-right font-medium">{it.qty}</td>
												<td className="p-3.5 text-right font-medium">{formatCurrency(it.rate, doc.currency)}</td>
												<td className="p-3.5 text-right font-bold text-slate-900 dark:text-slate-100">{formatCurrency(it.amount, doc.currency)}</td>
											</tr>
										))
									) : (
										<tr>
											<td colSpan={5} className="p-6 text-center text-slate-400">No items found in this invoice.</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						<div className="p-4 bg-slate-50 dark:bg-[#1e1e2d] border-t border-slate-200 dark:border-[#32344d] flex justify-between items-center text-xs">
							<span className="font-bold text-slate-500 dark:text-[#8f93a7] uppercase">
								Total Quantity: <strong className="text-slate-900 dark:text-slate-100">{totalQty}</strong>
							</span>
							<span className="font-bold text-slate-800 dark:text-slate-200">
								Net Total ({doc.currency || "INR"}): <strong className="text-base font-black text-indigo-600 dark:text-[#7367f0]">{formatCurrency(netTotal, doc.currency)}</strong>
							</span>
						</div>
					</div>

					{/* 6. SECTION 4: PURCHASE TAXES AND CHARGES (Dynamic Loop) */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm space-y-0">
						<div className="p-5 border-b border-slate-200 dark:border-[#32344d]">
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Purchase Taxes and Charges</h3>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
									<tr>
										<th className="p-3.5 w-10">No.</th>
										<th className="p-3.5">Type</th>
										<th className="p-3.5">Account Head</th>
										<th className="p-3.5 text-right">Tax Rate %</th>
										<th className="p-3.5 text-right">Amount ({doc.currency || "INR"})</th>
										<th className="p-3.5 text-right">Total ({doc.currency || "INR"})</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
									{taxesList && taxesList.length > 0 ? (
										taxesList.map((t: any, idx: number) => (
											<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
												<td className="p-3.5 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3.5 text-slate-800 dark:text-slate-200">{t.charge_type || "On Net Total"}</td>
												<td className="p-3.5 font-semibold text-slate-900 dark:text-slate-100">{t.account_head || "-"}</td>
												<td className="p-3.5 text-right font-mono">{t.rate !== undefined ? `${t.rate}%` : "-"}</td>
												<td className="p-3.5 text-right font-bold text-slate-900 dark:text-slate-100">{formatCurrency(t.tax_amount, doc.currency)}</td>
												<td className="p-3.5 text-right font-bold text-indigo-600 dark:text-[#7367f0]">{formatCurrency(t.total, doc.currency)}</td>
											</tr>
										))
									) : (
										<tr>
											<td colSpan={6} className="p-6 text-center text-slate-400">No purchase taxes or charges applied.</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</div>

					{/* 7. SECTION 5: RA BILL DEDUCTIONS (Dynamic Loop) */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-4">
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">RA Bill Deductions</h3>
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
							{/* Deductions Table */}
							<div className="lg:col-span-2 overflow-x-auto">
								<table className="w-full text-left text-xs">
									<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
										<tr>
											<th className="p-3 w-10">No.</th>
											<th className="p-3">Deduction Type</th>
											<th className="p-3">Description</th>
											<th className="p-3">Method</th>
											<th className="p-3 text-right">Rate %</th>
											<th className="p-3 text-right">Amount</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200 dark:divide-[#2d2d3f]">
										{deductionsList && deductionsList.length > 0 ? (
											deductionsList.map((d: any, idx: number) => (
												<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
													<td className="p-3 text-slate-400 font-semibold">{idx + 1}</td>
													<td className="p-3 font-bold text-slate-900 dark:text-slate-100">{d.deduction_type}</td>
													<td className="p-3 text-slate-500 dark:text-[#8f93a7]">{d.description || "-"}</td>
													<td className="p-3 text-slate-500">{d.method || d.calculation_method || "Percentage"}</td>
													<td className="p-3 text-right font-mono">{d.rate !== undefined ? `${d.rate}%` : "-"}</td>
													<td className="p-3 text-right font-bold text-rose-600 dark:text-[#ea5455]">-{formatCurrency(d.amount, doc.currency)}</td>
												</tr>
											))
										) : (
											<tr>
												<td colSpan={6} className="p-6 text-center text-slate-400">No RA bill deductions attached.</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>

							{/* Deduction Summaries */}
							<div className="bg-slate-50 dark:bg-[#1e1e2d] p-5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f] space-y-3">
								<h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-[#2d2d3f] pb-2">
									Deduction Totals
								</h4>
								<div className="flex justify-between items-center text-slate-600 dark:text-[#8f93a7]">
									<span>Total RA Deductions:</span>
									<span className="font-bold text-rose-600 dark:text-[#ea5455] text-sm">-{formatCurrency(totalDeductions, doc.currency)}</span>
								</div>
								<div className="border-t border-dashed border-slate-300 dark:border-[#32344d] pt-2 mt-2 flex justify-between items-center">
									<span className="font-bold text-slate-800 dark:text-slate-200">Net Payment (Display):</span>
									<span className="font-black text-emerald-600 dark:text-[#28c76f] text-base">{formatCurrency(netPaymentDisplay, doc.currency)}</span>
								</div>
							</div>
						</div>
					</div>

					{/* 8. SECTION 6: TAXES BREAKDOWN & TOTALS */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl p-6 shadow-sm space-y-6">
						<h3 className="font-bold text-base text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-[#32344d] pb-3">Taxes Summary & Grand Totals</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
							{/* Taxes Breakdown */}
							<div className="space-y-3 bg-slate-50 dark:bg-[#1e1e2d] p-5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Taxes and Charges Added ({doc.currency || "INR"}):</span>
									<span className="font-bold text-slate-900 dark:text-slate-100">{formatCurrency(taxesAdded, doc.currency)}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Taxes and Charges Deducted ({doc.currency || "INR"}):</span>
									<span className="font-bold text-slate-900 dark:text-slate-100">{formatCurrency(taxesDeducted, doc.currency)}</span>
								</div>
								<div className="flex justify-between pt-1">
									<span className="font-bold text-slate-800 dark:text-slate-200">Total Taxes and Charges ({doc.currency || "INR"}):</span>
									<span className="font-bold text-indigo-600 dark:text-[#7367f0]">{formatCurrency(totalTaxes, doc.currency)}</span>
								</div>
							</div>

							{/* Totals Section */}
							<div className="space-y-3 bg-slate-50 dark:bg-[#1e1e2d] p-5 rounded-xl border border-slate-200/70 dark:border-[#2d2d3f]">
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Grand Total ({doc.currency || "INR"}):</span>
									<span className="font-black text-slate-900 dark:text-slate-100 text-sm">{formatCurrency(grandTotal, doc.currency)}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Rounding Adjustment:</span>
									<span className="font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(doc.rounding_adjustment || 0, doc.currency)}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Rounded Total ({doc.currency || "INR"}):</span>
									<span className="font-black text-indigo-600 dark:text-[#7367f0] text-sm">{formatCurrency(doc.rounded_total || grandTotal, doc.currency)}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Total Advance ({doc.currency || "INR"}):</span>
									<span className="font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(doc.total_advance || 0, doc.currency)}</span>
								</div>
								<div className="flex justify-between border-b border-slate-100 dark:border-[#2d2d3f] pb-2">
									<span className="text-slate-500 dark:text-[#8f93a7]">Outstanding Amount ({doc.currency || "INR"}):</span>
									<span className="font-bold text-rose-600 dark:text-[#ea5455] text-sm">{formatCurrency(outstandingAmount, doc.currency)}</span>
								</div>
								{doc.in_words && (
									<div className="pt-1">
										<span className="text-slate-500 dark:text-[#8f93a7]">In Words:</span>
										<p className="font-semibold text-slate-900 dark:text-slate-100 italic mt-0.5">{doc.in_words}</p>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* 9. SECTION 7: TAX BREAKUP TABLE */}
					<div className="bg-white dark:bg-[#232333] border border-slate-200/80 dark:border-[#32344d] rounded-2xl overflow-hidden shadow-sm space-y-0">
						<div className="p-5 border-b border-slate-200 dark:border-[#32344d]">
							<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Tax Breakup Table</h3>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full text-left text-xs">
								<thead className="bg-slate-100 dark:bg-[#1e1e2d] text-slate-600 dark:text-[#8f93a7] uppercase font-bold border-b border-slate-200 dark:border-[#32344d]">
									<tr>
										<th className="p-3.5">HSN/SAC</th>
										<th className="p-3.5 text-right">Taxable Amount</th>
										<th className="p-3.5 text-right">Input CGST @ 9.0%</th>
										<th className="p-3.5 text-right">Input SGST @ 9.0%</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
									{doc.items && doc.items.length > 0 ? (
										doc.items.map((it: any, idx: number) => {
											const taxable = Number(it.amount || 0);
											const cgst = Number(taxable * 0.09);
											const sgst = Number(taxable * 0.09);
											return (
												<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
													<td className="p-3.5 font-mono font-bold text-indigo-600 dark:text-[#7367f0]">{it.gst_hsn_code || it.hsn_sac || "995411"}</td>
													<td className="p-3.5 text-right font-bold text-slate-900 dark:text-slate-100">{formatCurrency(taxable, doc.currency)}</td>
													<td className="p-3.5 text-right font-semibold text-slate-800 dark:text-slate-200">(9.0%) {formatCurrency(cgst, doc.currency)}</td>
													<td className="p-3.5 text-right font-semibold text-slate-800 dark:text-slate-200">(9.0%) {formatCurrency(sgst, doc.currency)}</td>
												</tr>
											);
										})
									) : (
										<tr className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
											<td className="p-3.5 font-mono font-bold text-indigo-600 dark:text-[#7367f0]">995411</td>
											<td className="p-3.5 text-right font-bold text-slate-900 dark:text-slate-100">{formatCurrency(netTotal, doc.currency)}</td>
											<td className="p-3.5 text-right font-semibold text-slate-800 dark:text-slate-200">(9.0%) {formatCurrency(netTotal * 0.09, doc.currency)}</td>
											<td className="p-3.5 text-right font-semibold text-slate-800 dark:text-slate-200">(9.0%) {formatCurrency(netTotal * 0.09, doc.currency)}</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</div>

				</div>
			)}

			{/* ── Make Payment (PE) Modal ── */}
			{showPEDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
					<div className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#32344d] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
						<div className="flex items-center justify-between border-b border-slate-200 dark:border-[#32344d] pb-3">
							<div>
								<h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Create Payment Entry</h3>
								<p className="text-xs text-slate-500 dark:text-[#8f93a7] mt-0.5">
									Invoice: <span className="font-mono font-bold">{invoiceId}</span>
								</p>
							</div>
							<button
								type="button"
								onClick={() => setShowPEDialog(false)}
								className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition"
							>
								<span className="text-lg leading-none">✕</span>
							</button>
						</div>

						<div className="space-y-4 text-xs">
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Mode of Payment <span className="text-rose-500">*</span>
								</label>
								<select
									value={selectedMopInv}
									onChange={(e) => handleMopChangeInv(e.target.value)}
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none"
								>
									{mopListInv.length === 0 && <option value="">Loading...</option>}
									{mopListInv.map((m) => (
										<option key={m.name} value={m.name}>{m.name} ({m.type})</option>
									))}
								</select>
								{mopTypeInv === "Bank" && (
									<p className="mt-1 text-amber-600 dark:text-amber-400 font-semibold">Bank mode — Reference No &amp; Date are mandatory.</p>
								)}
							</div>

							{/* Paid From Account (auto-filled from MoP / company default) */}
							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Paid From Account
								</label>
								<input
									type="text"
									value={paidFromInv}
									onChange={(e) => setPaidFromInv(e.target.value)}
									placeholder="Auto-filled from Mode of Payment"
									className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none"
								/>
							</div>

							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Posting Date <span className="text-rose-500">*</span>
								</label>
								<input type="date" required value={pePostingDateInv} onChange={(e) => setPePostingDateInv(e.target.value)} className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none" />
							</div>

							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Reference No (Cheque / UTR)
									{mopTypeInv === "Bank" && <span className="text-rose-500"> *</span>}
								</label>
								<input
									type="text"
									value={peRefNoInv}
									onChange={(e) => setPeRefNoInv(e.target.value)}
									placeholder="UTR / Cheque / Transaction reference"
									className={`w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none ${mopTypeInv === "Bank" && !peRefNoInv.trim() ? "border-rose-400" : "border-slate-200 dark:border-[#32344d]"
										}`}
								/>
							</div>

							<div>
								<label className="block text-slate-600 dark:text-[#8f93a7] font-semibold mb-1">
									Reference Date
									{mopTypeInv === "Bank" && <span className="text-rose-500"> *</span>}
								</label>
								<input type="date" value={peRefDateInv} onChange={(e) => setPeRefDateInv(e.target.value)} className="w-full p-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-slate-200 dark:border-[#32344d] rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none" />
							</div>

							{peErrorInv && (
								<div className="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-700 dark:text-rose-400 text-xs font-semibold">{peErrorInv}</div>
							)}

							<div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-[#32344d]">
								<button type="button" onClick={() => setShowPEDialog(false)} disabled={isSubmittingPEInv} className="px-4 py-2 bg-slate-100 dark:bg-[#1e1e2d] hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl font-semibold transition cursor-pointer">Cancel</button>
								<button type="button" onClick={handleCreatePaymentEntry} disabled={isSubmittingPEInv} className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
									<DollarSign size={14} />
									<span>{isSubmittingPEInv ? "Creating..." : "Create Payment Entry"}</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
