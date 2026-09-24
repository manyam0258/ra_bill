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
	// Fetch the linked RA Bill so we can show hold_qty / reject_qty per item
	const raBillName: string | undefined = (doc as any)?.ra_bill;
	// frappe-react-sdk skips the fetch when docname is falsy ("")
	const { data: raBillDoc } = useFrappeGetDoc(
		"RA Bill",
		raBillName ?? "",
	);
	const raBillItems: any[] = (raBillDoc as any)?.items ?? [];
	// Build a lookup: item_code → { hold_qty, reject_qty } from RA Bill items
	const raBillItemMap = raBillItems.reduce<Record<string, { hold_qty: number; reject_qty: number }>>((acc, row) => {
		if (row.item_code) {
			acc[row.item_code] = {
				hold_qty: Number(row.hold_qty ?? 0),
				reject_qty: Number(row.reject_qty ?? 0),
			};
		}
		return acc;
	}, {});
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
	const [amountToPayInv, setAmountToPayInv] = useState("");
	const [qtyToPayInv, setQtyToPayInv] = useState("");
	const [pePostingDateInv, setPePostingDateInv] = useState(new Date().toISOString().split("T")[0]);
	const [peRefNoInv, setPeRefNoInv] = useState("");
	const [peRefDateInv, setPeRefDateInv] = useState(new Date().toISOString().split("T")[0]);
	const [isSubmittingPEInv, setIsSubmittingPEInv] = useState(false);
	const [peErrorInv, setPeErrorInv] = useState("");

	// Determine the effective rate to use for qty <-> amount conversion:
	// If the RA Bill's Hold portion is on a single item row, use that row's actual rate.
	// If Hold is spread across multiple rows (rare edge case already noted in the partial-hold-payment feature),
	// use blended average rate = total_hold_value / total_hold_qty (same approach already used for proportional hold_qty reduction).
	const holdRows = raBillItems.filter((r) => Number(r.original_hold_qty || r.hold_qty || 0) > 0);
	let effectiveHoldRate = 0;
	if (holdRows.length === 1) {
		effectiveHoldRate = Number(holdRows[0].rate || 0);
	} else if (holdRows.length > 1) {
		const totalHoldVal = Number((raBillDoc as any)?.total_hold_value || (raBillDoc as any)?.original_total_hold_value || 0);
		const totalHoldQ = Number((raBillDoc as any)?.total_hold_qty || (raBillDoc as any)?.original_total_hold_qty || 0);
		effectiveHoldRate = totalHoldQ > 0 ? totalHoldVal / totalHoldQ : Number(holdRows[0].rate || 0);
	} else if (raBillItems.length > 0) {
		effectiveHoldRate = Number(raBillItems[0].rate || 0);
	}

	const pendingHoldQty = raBillItems.reduce((acc, r) => acc + Number(r.hold_qty ?? 0), 0);

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
			// Only submit the PI — do NOT auto-create a Payment Entry here.
			// The user must click "Make Payment (PE)" to open the dialog and
			// create a Draft PE for review before manually submitting it.
			mutate();
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

		// Calculate default amount to pay:
		// First PE with hold on an RA Bill defaults to immediately payable; subsequent PEs or non-hold bills default to outstanding
		const outstanding = Number(doc?.outstanding_amount ?? 0);
		let defaultAmount = outstanding;
		const hasSubmittedPE = (linkedPEs || []).some((pe: any) => pe.docstatus === 1);
		if (!hasSubmittedPE && raBillDoc) {
			const gross = Number((raBillDoc as any).gross_work_value ?? 0);
			const hold = Number((raBillDoc as any).total_hold_value ?? 0);
			const net = Number((raBillDoc as any).net_payable ?? 0);
			if (gross > 0 && hold > 0 && net > 0) {
				const holdFraction = hold / gross;
				const immPayable = Math.round(Math.max(0, net * (1 - holdFraction)) * 100) / 100;
				defaultAmount = Math.min(immPayable, outstanding);
			}
		}
		setAmountToPayInv(defaultAmount > 0 ? defaultAmount.toString() : (outstanding > 0 ? outstanding.toString() : "0"));
		if (effectiveHoldRate > 0 && defaultAmount > 0) {
			const derivedQty = Math.round((defaultAmount / effectiveHoldRate) * 100) / 100;
			setQtyToPayInv(derivedQty.toString());
		} else {
			setQtyToPayInv("");
		}
		setShowPEDialog(true);
	};

	const handleQtyChangeInv = (qStr: string) => {
		setQtyToPayInv(qStr);
		setPeErrorInv("");
		if (qStr === "" || isNaN(parseFloat(qStr))) {
			setAmountToPayInv("");
			return;
		}
		const q = parseFloat(qStr);
		if (effectiveHoldRate > 0) {
			const calculatedAmt = Math.round(q * effectiveHoldRate * 100) / 100;
			setAmountToPayInv(calculatedAmt.toString());
		}
	};

	const handleAmountChangeInv = (amtStr: string) => {
		setAmountToPayInv(amtStr);
		setPeErrorInv("");
		if (amtStr === "" || isNaN(parseFloat(amtStr))) {
			setQtyToPayInv("");
			return;
		}
		const amt = parseFloat(amtStr);
		if (effectiveHoldRate > 0) {
			const calculatedQty = Math.round((amt / effectiveHoldRate) * 100) / 100;
			setQtyToPayInv(calculatedQty.toString());
		}
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

		// Client-side Amount & Qty to Pay validation
		const parsedAmount = parseFloat(amountToPayInv);
		const parsedQty = parseFloat(qtyToPayInv);
		const outstanding = Number(doc?.outstanding_amount ?? 0);
		const hasSubmittedPE = (linkedPEs || []).some((pe: any) => pe.docstatus === 1);
		const maxAllowedQty = hasSubmittedPE && pendingHoldQty > 0
			? pendingHoldQty
			: (effectiveHoldRate > 0 ? Math.round((outstanding / effectiveHoldRate) * 100) / 100 : 0);

		if (isNaN(parsedAmount) || parsedAmount <= 0) {
			setPeErrorInv("Please enter a valid Amount to Pay greater than 0.");
			return;
		}
		if (parsedAmount > outstanding + 0.005) {
			setPeErrorInv(`Amount to Pay cannot exceed remaining outstanding (${formatCurrency(outstanding)}).`);
			return;
		}
		if (effectiveHoldRate > 0 && !isNaN(parsedQty)) {
			if (parsedQty <= 0) {
				setPeErrorInv("Qty to Pay must be greater than 0.");
				return;
			}
			if (parsedQty > maxAllowedQty + 0.005) {
				setPeErrorInv(`Qty to Pay cannot exceed ${hasSubmittedPE && pendingHoldQty > 0 ? `pending hold qty (${pendingHoldQty})` : `maximum allowed qty (${maxAllowedQty})`}.`);
				return;
			}
		}

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
				custom_amount: parsedAmount,
				// Leave as Draft so user can review before submitting
				auto_submit: false,
			});
			const peId = res.payment_entry || res;
			setShowPEDialog(false);
			fetchLinkedPEs();
			// Navigate to the draft PE so user can review & manually submit
			if (onSelectPaymentEntry) {
				onSelectPaymentEntry(peId);
			}
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

	// Issue 3: Hold-pending state — true when the PI has outstanding balance AND the
	// linked RA Bill has a hold portion (i.e. a partial-payment was made for the
	// immediately-payable fraction and the hold deferred portion is still outstanding).
	const raBillHoldValue = Number((raBillDoc as any)?.total_hold_value ?? 0);
	const isHoldPending = doc.docstatus === 1 && outstandingAmount > 0.005 && raBillHoldValue > 0.005;

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
						<div className="flex items-center gap-2.5 flex-wrap">
							<h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{doc.name}</h2>
							{isHoldPending ? (
								<span className="px-3 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
									<span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500"></span>
									Hold Pending — {formatCurrency(outstandingAmount, doc.currency)} outstanding
								</span>
							) : (
								<span className={`px-3 py-0.5 rounded-full text-xs font-bold ${
									outstandingAmount === 0 || doc.status === "Paid"
										? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
										: doc.status === "Overdue"
											? "bg-rose-500/15 text-rose-600 border border-rose-500/30"
											: "bg-amber-500/15 text-amber-600 border border-amber-500/30"
								}`}>
									{doc.status || (outstandingAmount === 0 ? "Paid" : "Unpaid")}
								</span>
							)}
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
										<th className="p-3.5 text-right">Qty (Approved)</th>
										<th className="p-3.5 text-right">Reject Qty</th>
										<th className="p-3.5 text-right" title="Included within the Approved Qty above — payment deferred pending further approval">Hold Qty ⊂ Approved</th>
										<th className="p-3.5 text-right">Rate</th>
										<th className="p-3.5 text-right">Amount ({doc.currency || "INR"})</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200/80 dark:divide-[#2d2d3f]">
									{doc.items && doc.items.length > 0 ? (
										doc.items.map((it: any, idx: number) => {
											const raRow = raBillItemMap[it.item_code] ?? { hold_qty: 0, reject_qty: 0 };
											return (
											<tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-[#1e1e2d]/70 transition">
												<td className="p-3.5 text-slate-400 font-semibold">{idx + 1}</td>
												<td className="p-3.5 font-bold text-slate-900 dark:text-slate-100">
													<span className="block font-mono text-indigo-600 dark:text-[#7367f0]">{it.item_code}</span>
													<span className="font-normal text-slate-600 dark:text-slate-300">{it.item_name || it.description || "-"}</span>
												</td>
												<td className="p-3.5 text-right font-medium">{it.qty}</td>
												<td className="p-3.5 text-right font-medium">
													{raRow.reject_qty > 0 ? (
														<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 font-semibold">
															{raRow.reject_qty}
														</span>
													) : (
														<span className="text-slate-400">—</span>
													)}
												</td>
												<td className="p-3.5 text-right font-medium">
													{raRow.hold_qty > 0 ? (
														<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold" title="Included in Approved Qty — payment deferred">
															{raRow.hold_qty}
														</span>
													) : (
														<span className="text-slate-400">—</span>
													)}
												</td>
												<td className="p-3.5 text-right font-medium">{formatCurrency(it.rate, doc.currency)}</td>
												<td className="p-3.5 text-right font-bold text-slate-900 dark:text-slate-100">{formatCurrency(it.amount, doc.currency)}</td>
											</tr>
											);
										})
									) : (
										<tr>
											<td colSpan={7} className="p-6 text-center text-slate-400">No items found in this invoice.</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>

						<div className="p-4 bg-slate-50 dark:bg-[#1e1e2d] border-t border-slate-200 dark:border-[#32344d] space-y-2 text-xs">
							<div className="flex justify-between items-center">
								<span className="font-bold text-slate-500 dark:text-[#8f93a7] uppercase">
									Total Quantity (Approved): <strong className="text-slate-900 dark:text-slate-100">{totalQty}</strong>
								</span>
								<span className="font-bold text-slate-800 dark:text-slate-200">
									Net Total ({doc.currency || "INR"}): <strong className="text-base font-black text-indigo-600 dark:text-[#7367f0]">{formatCurrency(netTotal, doc.currency)}</strong>
								</span>
							</div>
							{(() => {
								const holdTotalValue = Number((raBillDoc as any)?.total_hold_value ?? 0);
								const totalHoldQty = raBillItems.reduce((sum, r) => sum + Number(r.hold_qty ?? 0), 0);
								if (totalHoldQty <= 0) return null;
								return (
									<div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs">
										<span className="inline-block w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"></span>
										<span>
											Includes <strong>{formatCurrency(holdTotalValue, doc.currency)}</strong> pending Hold
											({totalHoldQty} qty) — billed but payment deferred.
										</span>
									</div>
								);
							})()}
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

							{/* Qty to Pay and Amount to Pay (Synced together) */}
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
								{/* Qty to Pay */}
								<div>
									<div className="flex items-center justify-between mb-1">
										<label className="text-slate-600 dark:text-[#8f93a7] font-semibold">
											Qty to Pay {pendingHoldQty > 0 ? `(${pendingHoldQty} pending)` : ""} <span className="text-rose-500">*</span>
										</label>
										{effectiveHoldRate > 0 && (
											<span className="text-[11px] text-slate-400">
												Rate: {formatCurrency(effectiveHoldRate)}
											</span>
										)}
									</div>
									<input
										type="number"
										step="0.01"
										min="0.01"
										value={qtyToPayInv}
										onChange={(e) => handleQtyChangeInv(e.target.value)}
										placeholder="0.00"
										className={`w-full px-3 py-2.5 bg-slate-50 dark:bg-[#1e1e2d] border rounded-xl text-slate-800 dark:text-slate-200 font-medium focus:outline-none ${
											(effectiveHoldRate > 0 && parseFloat(qtyToPayInv) > ((linkedPEs || []).some((pe: any) => pe.docstatus === 1) && pendingHoldQty > 0 ? pendingHoldQty : (effectiveHoldRate > 0 ? Math.round((Number(doc?.outstanding_amount ?? 0) / effectiveHoldRate) * 100) / 100 : 0)) + 0.005) || (qtyToPayInv !== "" && parseFloat(qtyToPayInv) <= 0)
												? "border-rose-400 dark:border-rose-500/50"
												: "border-slate-200 dark:border-[#32344d]"
										}`}
									/>
								</div>

								{/* Amount to Pay */}
								<div>
									<div className="flex items-center justify-between mb-1">
										<label className="text-slate-600 dark:text-[#8f93a7] font-semibold">
											Amount to Pay <span className="text-rose-500">*</span>
										</label>
										<span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
											Bal: <span className="font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(Number(doc?.outstanding_amount ?? 0))}</span>
										</span>
									</div>
									<div className="relative">
										<span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-xs">
											₹
										</span>
										<input
											type="number"
											step="0.01"
											min="0.01"
											max={Number(doc?.outstanding_amount ?? 0)}
											value={amountToPayInv}
											onChange={(e) => handleAmountChangeInv(e.target.value)}
											placeholder="0.00"
											className={`w-full pl-7 pr-3 py-2.5 bg-slate-50 dark:bg-[#1e1e2d] border rounded-xl text-slate-800 dark:text-slate-200 font-medium focus:outline-none ${
												parseFloat(amountToPayInv) > Number(doc?.outstanding_amount ?? 0) + 0.005 || (amountToPayInv !== "" && parseFloat(amountToPayInv) <= 0)
													? "border-rose-400 dark:border-rose-500/50"
													: "border-slate-200 dark:border-[#32344d]"
											}`}
										/>
									</div>
								</div>
							</div>

							{parseFloat(amountToPayInv) > Number(doc?.outstanding_amount ?? 0) + 0.005 && (
								<p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
									Amount cannot exceed remaining outstanding balance ({formatCurrency(Number(doc?.outstanding_amount ?? 0))}).
								</p>
							)}
							{effectiveHoldRate > 0 && parseFloat(qtyToPayInv) > ((linkedPEs || []).some((pe: any) => pe.docstatus === 1) && pendingHoldQty > 0 ? pendingHoldQty : (effectiveHoldRate > 0 ? Math.round((Number(doc?.outstanding_amount ?? 0) / effectiveHoldRate) * 100) / 100 : 0)) + 0.005 && (
								<p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
									Qty to Pay cannot exceed {(linkedPEs || []).some((pe: any) => pe.docstatus === 1) && pendingHoldQty > 0 ? `pending hold qty (${pendingHoldQty})` : `maximum allowed qty (${effectiveHoldRate > 0 ? Math.round((Number(doc?.outstanding_amount ?? 0) / effectiveHoldRate) * 100) / 100 : 0})`}.
								</p>
							)}
							{((amountToPayInv !== "" && parseFloat(amountToPayInv) <= 0) || (qtyToPayInv !== "" && parseFloat(qtyToPayInv) <= 0)) && (
								<p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
									Amount and Qty must be greater than 0.
								</p>
							)}
							{!linkedPEs.some((pe: any) => pe.docstatus === 1) && Number((raBillDoc as any)?.total_hold_value ?? 0) > 0 && (
								<p className="mt-1 text-[11px] text-slate-500 dark:text-[#8f93a7]">
									Default is immediately payable. The remaining hold portion ({pendingHoldQty} pending) can be paid in later Payment Entries.
								</p>
							)}

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
								<button
									type="button"
									onClick={handleCreatePaymentEntry}
									disabled={
										isSubmittingPEInv ||
										isNaN(parseFloat(amountToPayInv)) ||
										parseFloat(amountToPayInv) <= 0 ||
										parseFloat(amountToPayInv) > Number(doc?.outstanding_amount ?? 0) + 0.005 ||
										(effectiveHoldRate > 0 && (
											isNaN(parseFloat(qtyToPayInv)) ||
											parseFloat(qtyToPayInv) <= 0 ||
											parseFloat(qtyToPayInv) > ((linkedPEs || []).some((pe: any) => pe.docstatus === 1) && pendingHoldQty > 0 ? pendingHoldQty : (effectiveHoldRate > 0 ? Math.round((Number(doc?.outstanding_amount ?? 0) / effectiveHoldRate) * 100) / 100 : 0)) + 0.005
										))
									}
									className="px-4 py-2 bg-indigo-600 dark:bg-[#7367f0] hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
								>
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
